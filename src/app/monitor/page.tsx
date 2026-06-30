'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Search, Download, RefreshCw, Package, Archive, ShieldAlert, TrendingDown,
  ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight,
  SlidersHorizontal, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { MonitorItem } from '@/types';
import * as XLSX from 'xlsx';

// ---- Types ----------------------------------------------------------------

type ColKey =
  | 'noPO' | 'date' | 'ocsCode' | 'skuName'
  | 'qtyPO' | 'qtyReceived' | 'qtyPending' | 'pctFulfill'
  | 'stockOnHand' | 'urgency' | 'lastArrival' | 'status';

type SortDir = 'asc' | 'desc';

interface ColDef {
  key: ColKey;
  label: string;
  align: 'left' | 'right' | 'center';
  stockOnly?: boolean;
}

const ALL_COLS: ColDef[] = [
  { key: 'noPO',        label: 'No PO',        align: 'left'   },
  { key: 'date',        label: 'Tgl PO',        align: 'left'   },
  { key: 'ocsCode',     label: 'OCS Code',      align: 'left'   },
  { key: 'skuName',     label: 'Nama Produk',   align: 'left'   },
  { key: 'qtyPO',       label: 'QTY PO',        align: 'right'  },
  { key: 'qtyReceived', label: 'Diterima',       align: 'right'  },
  { key: 'qtyPending',  label: 'Pending',        align: 'right'  },
  { key: 'pctFulfill',  label: '% Terima',       align: 'right'  },
  { key: 'stockOnHand', label: 'Stok',           align: 'right', stockOnly: true },
  { key: 'urgency',     label: 'Urgensi',        align: 'left',  stockOnly: true },
  { key: 'lastArrival', label: 'Tiba Terakhir',  align: 'left'   },
  { key: 'status',      label: 'Status',         align: 'center' },
];

const URGENCY_ORDER: Record<string, number> = {
  stock_minus: 0, stock_empty: 1, stock_low: 2, overdue: 3,
};

const PAGE_SIZES = [10, 25, 50, 100];

type UrgencyFilter = 'all' | 'po' | 'qty' | 'stock_minus' | 'stock_empty' | 'stock_low';

// ---- Sort helpers ----------------------------------------------------------

function getValue(item: MonitorItem, key: ColKey): string | number | null {
  switch (key) {
    case 'status':   return item.qtyReceived > 0 ? 1 : 0;
    case 'urgency':  return item.urgency ? (URGENCY_ORDER[item.urgency] ?? 9) : 9;
    case 'noPO':     return String(item.noPO);
    case 'date':     return item.date;
    case 'ocsCode':  return item.ocsCode;
    case 'skuName':  return item.skuName;
    case 'lastArrival': return item.lastArrival ?? '';
    default:         return (item as unknown as Record<string, number>)[key] ?? 0;
  }
}

function sortItems(items: MonitorItem[], key: ColKey, dir: SortDir): MonitorItem[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = getValue(a, key);
    const vb = getValue(b, key);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
    return String(va ?? '').localeCompare(String(vb ?? ''), 'id') * mul;
  });
}

// ---- Urgency cell ----------------------------------------------------------

function UrgencyBadge({ urgency }: { urgency: MonitorItem['urgency'] }) {
  if (urgency === 'stock_minus') return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 whitespace-nowrap">
      <TrendingDown size={10}/> Oversell
    </span>
  );
  if (urgency === 'stock_empty') return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 whitespace-nowrap">
      <Archive size={10}/> Stok Kosong
    </span>
  );
  if (urgency === 'stock_low') return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 whitespace-nowrap">
      <ShieldAlert size={10}/> Stok Rendah
    </span>
  );
  return <span className="text-slate-400 text-xs">-</span>;
}

// ---- Context menu ----------------------------------------------------------

interface ContextMenuState {
  x: number;
  y: number;
  colKey: ColKey;
}

// ---- Main page -------------------------------------------------------------

export default function MonitorPage() {
  const [items,      setItems]      = useState<MonitorItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [lastFetch,  setLastFetch]  = useState<Date | null>(null);
  const [sortKey,    setSortKey]    = useState<ColKey | null>(null);
  const [sortDir,    setSortDir]    = useState<SortDir>('asc');
  const [hiddenCols, setHiddenCols] = useState<Set<ColKey>>(new Set());
  const [page,       setPage]       = useState(1);
  const [pageSize,   setPageSize]   = useState(25);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showColPanel, setShowColPanel] = useState(false);
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');
  const colPanelRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/monitor');
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
      setLastFetch(new Date());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Close context menu / col panel on outside click
  useEffect(() => {
    const handler = () => {
      setContextMenu(null);
      setShowColPanel(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Derive visible columns
  const hasStockData = items.some(i => i.stockOnHand !== null);
  const visibleCols = useMemo(() =>
    ALL_COLS.filter(c => {
      if (c.stockOnly && !hasStockData) return false;
      return !hiddenCols.has(c.key);
    }), [hasStockData, hiddenCols]);

  // Filter + sort + paginate
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let base = items;
    if (urgencyFilter === 'stock_minus') base = base.filter(i => i.urgency === 'stock_minus');
    else if (urgencyFilter === 'stock_empty') base = base.filter(i => i.urgency === 'stock_empty');
    else if (urgencyFilter === 'stock_low')   base = base.filter(i => i.urgency === 'stock_low');
    if (q) base = base.filter(i =>
      String(i.noPO).includes(q) ||
      i.sapCode.toLowerCase().includes(q) ||
      i.ocsCode.toLowerCase().includes(q) ||
      i.skuName.toLowerCase().includes(q)
    );
    return sortKey ? sortItems(base, sortKey, sortDir) : base;
  }, [items, search, sortKey, sortDir, urgencyFilter]);

  // Reset to page 1 when filter/sort changes
  useEffect(() => { setPage(1); }, [search, sortKey, sortDir, pageSize, urgencyFilter]);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage    = Math.min(page, totalPages);
  const pageStart   = (safePage - 1) * pageSize;
  const pageEnd     = Math.min(pageStart + pageSize, filtered.length);
  const pageItems   = filtered.slice(pageStart, pageEnd);

  // Summary
  const totalPending    = filtered.reduce((s, i) => s + i.qtyPending, 0);
  const stockMinusCount = filtered.filter(i => i.urgency === 'stock_minus').length;
  const stockEmptyCount = filtered.filter(i => i.urgency === 'stock_empty').length;
  const stockLowCount   = filtered.filter(i => i.urgency === 'stock_low').length;

  // Column toggle sort
  const handleSort = (key: ColKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  // Right-click column header
  const handleContextMenu = (e: React.MouseEvent, key: ColKey) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, colKey: key });
    setShowColPanel(false);
  };

  const hideCol = (key: ColKey) => {
    setHiddenCols(prev => {
      const next = new Set(Array.from(prev));
      next.add(key);
      return next;
    });
    setContextMenu(null);
  };

  const showAllCols = () => {
    setHiddenCols(new Set());
    setContextMenu(null);
    setShowColPanel(false);
  };

  // Excel export
  const urgencyLabel = (u: MonitorItem['urgency']) => {
    if (u === 'stock_minus') return 'Oversell (Stok Minus)';
    if (u === 'stock_empty') return 'Stok Kosong';
    if (u === 'stock_low')   return 'Stok Rendah';
    if (u === 'overdue')     return 'Overdue';
    return '-';
  };

  const exportExcel = () => {
    const rows = filtered.map(i => ({
      'No PO':              i.noPO,
      'Tgl PO':             i.date,
      'SAP Code':           i.sapCode,
      'OCS Code':           i.ocsCode,
      'Nama Produk':        i.skuName,
      'QTY PO':             i.qtyPO,
      'QTY Diterima':       i.qtyReceived,
      'QTY Pending':        i.qtyPending,
      '% Diterima':         `${i.pctFulfill}%`,
      'Stok On Hand':       i.stockOnHand ?? '-',
      'Urgensi':            urgencyLabel(i.urgency),
      'Tiba Terakhir':      i.lastArrival ?? '',
      'Remark':             i.remarkPO ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const colWidths = Object.keys(rows[0] ?? {}).map(k => ({
      wch: Math.max(k.length, ...rows.map(r => String((r as Record<string,unknown>)[k] ?? '').length)) + 2,
    }));
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pending PO');
    XLSX.writeFile(wb, `pending_po_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  // Row bg color
  const rowBg = (item: MonitorItem) => {
    if (item.urgency === 'stock_minus') return 'bg-purple-50/70 dark:bg-purple-900/15';
    if (item.urgency === 'stock_empty') return 'bg-red-50/60 dark:bg-red-900/10';
    if (item.urgency === 'stock_low')   return 'bg-orange-50/60 dark:bg-orange-900/10';
    if (item.qtyReceived === 0)         return 'bg-slate-50/60 dark:bg-slate-800/20';
    return '';
  };

  // Render a cell value
  const renderCell = (item: MonitorItem, key: ColKey) => {
    const isMinus = item.urgency === 'stock_minus';
    const isEmpty = item.urgency === 'stock_empty';
    const isLow   = item.urgency === 'stock_low';
    const pct     = item.pctFulfill;

    switch (key) {
      case 'noPO':     return <span className="font-semibold text-slate-800 dark:text-white">{item.noPO}</span>;
      case 'date':     return <span className="text-slate-500 whitespace-nowrap">{item.date}</span>;
      case 'ocsCode':  return <span className="font-mono text-xs text-blue-700 dark:text-blue-400">{item.ocsCode}</span>;
      case 'skuName':  return <span className="text-slate-700 dark:text-slate-300">{item.skuName}</span>;
      case 'qtyPO':    return <span className="tabular-nums">{item.qtyPO.toLocaleString()}</span>;
      case 'qtyReceived': return <span className="tabular-nums text-green-700 dark:text-green-400 font-medium">{item.qtyReceived.toLocaleString()}</span>;
      case 'qtyPending':  return <span className="tabular-nums font-bold text-red-600 dark:text-red-400">{item.qtyPending.toLocaleString()}</span>;
      case 'pctFulfill': return (
        <div className="flex items-center gap-1.5 justify-end">
          <div className="w-14 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 shrink-0">
            <div className={cn('h-1.5 rounded-full transition-all', pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-red-400')}
              style={{ width: `${Math.min(pct, 100)}%` }}/>
          </div>
          <span className="text-xs text-slate-500 tabular-nums w-8 text-right">{pct}%</span>
        </div>
      );
      case 'stockOnHand': {
        if (item.stockOnHand === null) return <span className="text-slate-400 text-xs">—</span>;
        const cls = isMinus ? 'text-purple-700 dark:text-purple-400'
          : isEmpty ? 'text-red-600 dark:text-red-400'
          : isLow   ? 'text-orange-600 dark:text-orange-400'
          : 'text-green-600 dark:text-green-400';
        return <span className={cn('font-semibold tabular-nums', cls)}>{item.stockOnHand.toLocaleString()}</span>;
      }
      case 'urgency': return <UrgencyBadge urgency={item.urgency}/>;
      case 'lastArrival': return <span className="text-slate-500 whitespace-nowrap text-xs">{item.lastArrival ?? '—'}</span>;
      case 'status': {
        const isPartial = item.qtyReceived > 0;
        return (
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap',
            !isPartial
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400')}>
            {!isPartial ? 'Belum Terima' : 'Partial'}
          </span>
        );
      }
      default: return null;
    }
  };

  // Sort icon
  const SortIcon = ({ col }: { col: ColKey }) => {
    if (sortKey !== col) return <ChevronsUpDown size={12} className="opacity-30"/>;
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="text-blue-600"/>
      : <ChevronDown size={12} className="text-blue-600"/>;
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">

      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-screen-2xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Package size={18} className="text-blue-600 shrink-0"/>
              <h1 className="text-base font-bold text-slate-800 dark:text-white">Monitor Pending PO</h1>
              <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 px-2 py-0.5 rounded-full font-medium">PUBLIC</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              PT. INOVASI EKA GEMILANG · PO belum sepenuhnya diterima
              {lastFetch && ` · ${lastFetch.toLocaleTimeString('id-ID')}`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={fetchData}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500" title="Refresh">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''}/>
            </button>

            {/* Column visibility panel */}
            <div className="relative" ref={colPanelRef}>
              <button
                onClick={e => { e.stopPropagation(); setShowColPanel(v => !v); setContextMenu(null); }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                  hiddenCols.size > 0
                    ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-400'
                    : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                )}>
                <SlidersHorizontal size={13}/>
                Kolom
                {hiddenCols.size > 0 && <span className="bg-blue-600 text-white rounded-full px-1 text-xs">{hiddenCols.size}</span>}
              </button>

              {showColPanel && (
                <div
                  onClick={e => e.stopPropagation()}
                  className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-3 min-w-[180px]">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Tampilkan Kolom</p>
                  <div className="space-y-1">
                    {ALL_COLS.filter(c => !c.stockOnly || hasStockData).map(col => (
                      <label key={col.key} className="flex items-center gap-2 cursor-pointer py-0.5 group">
                        <input type="checkbox"
                          checked={!hiddenCols.has(col.key)}
                          onChange={e => {
                            setHiddenCols(prev => {
                              const next = new Set(Array.from(prev));
                              if (e.target.checked) next.delete(col.key); else next.add(col.key);
                              return next;
                            });
                          }}
                          className="rounded border-slate-300 text-blue-600"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-blue-600 transition-colors">
                          {col.label}
                        </span>
                      </label>
                    ))}
                  </div>
                  {hiddenCols.size > 0 && (
                    <button onClick={showAllCols}
                      className="mt-2 w-full text-xs text-blue-600 hover:underline flex items-center justify-center gap-1">
                      <Eye size={11}/> Tampilkan semua
                    </button>
                  )}
                </div>
              )}
            </div>

            <button onClick={exportExcel} disabled={filtered.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors">
              <Download size={13}/> Export Excel
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 py-4 space-y-3">

        {/* Summary cards — clickable to filter */}
        {(() => {
          type CardDef = { key: UrgencyFilter; label: string; value: number | string; color: string; sub: string; icon?: React.ElementType };
          const cards: CardDef[] = [
            { key: 'po',  label: 'PO Pending',  value: items.length, color: 'blue', sub: 'item' },
            { key: 'qty', label: 'QTY Pending', value: items.reduce((s,i)=>s+i.qtyPending,0).toLocaleString(), color: 'red', sub: 'PC' },
            ...(hasStockData ? [
              { key: 'stock_minus' as UrgencyFilter, label: 'Oversell',    value: stockMinusCount, color: 'purple', sub: 'stok minus',   icon: TrendingDown },
              { key: 'stock_empty' as UrgencyFilter, label: 'Stok Kosong', value: stockEmptyCount, color: 'red',    sub: 'item',         icon: Archive },
              { key: 'stock_low'   as UrgencyFilter, label: 'Stok Rendah', value: stockLowCount,   color: 'orange', sub: '\u226450% pending', icon: ShieldAlert },
            ] : []),
          ];
          const baseCard = 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700';
          const activeColors: Record<string, string> = {
            blue:   'bg-blue-50 dark:bg-blue-900/20 border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800',
            red:    'bg-red-50 dark:bg-red-900/20 border-red-500 ring-2 ring-red-200 dark:ring-red-800',
            purple: 'bg-purple-50 dark:bg-purple-900/20 border-purple-500 ring-2 ring-purple-200 dark:ring-purple-800',
            orange: 'bg-orange-50 dark:bg-orange-900/20 border-orange-500 ring-2 ring-orange-200 dark:ring-orange-800',
          };
          const textColors: Record<string, string> = {
            blue: 'text-blue-700 dark:text-blue-400', red: 'text-red-600 dark:text-red-400',
            purple: 'text-purple-700 dark:text-purple-400', orange: 'text-orange-600 dark:text-orange-400',
          };
          return (
            <div className={cn('grid gap-2', hasStockData ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2')}>
              {cards.map((c) => {
                const isActive = urgencyFilter === c.key;
                const Icon = c.icon;
                return (
                  <button
                    key={c.key}
                    onClick={() => setUrgencyFilter(prev => prev === c.key ? 'all' : c.key)}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all hover:shadow-md',
                      isActive ? activeColors[c.color] : baseCard
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-slate-500">{c.label}</p>
                      {Icon && <Icon size={13} className={cn('shrink-0', textColors[c.color])}/>}
                    </div>
                    <p className={cn('text-xl font-black', textColors[c.color])}>{c.value}</p>
                    <p className="text-xs text-slate-400">{c.sub}</p>
                    {isActive && <p className={cn('text-xs mt-0.5 font-medium', textColors[c.color])}>\u2713 filter aktif</p>}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Legend + Search row */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {hasStockData && (
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <span className="text-slate-500 font-medium hidden sm:inline">Prioritas:</span>
              {[
                { cls: 'bg-purple-100 text-purple-700', icon: TrendingDown, label: 'Oversell' },
                { cls: 'bg-red-100 text-red-700',       icon: Archive,      label: 'Stok Kosong' },
                { cls: 'bg-orange-100 text-orange-700', icon: ShieldAlert,  label: 'Stok Rendah' },
              ].map(({ cls, icon: Icon, label }) => (
                <span key={label} className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium', cls)}>
                  <Icon size={10}/> {label}
                </span>
              ))}
            </div>
          )}

          <div className="relative flex-1 sm:max-w-xs ml-auto">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Cari No PO, kode, nama..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-white placeholder-slate-400"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"/>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
                    {visibleCols.map((col, ci) => (
                      <th
                        key={col.key}
                        onContextMenu={e => handleContextMenu(e, col.key)}
                        onClick={() => handleSort(col.key)}
                        className={cn(
                          'px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none',
                          'hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors',
                          sortKey === col.key && 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
                          col.align === 'right'  && 'text-right',
                          col.align === 'center' && 'text-center',
                          ci === 0 && 'sticky left-0 z-10 bg-slate-50 dark:bg-slate-900/60',
                        )}
                        title="Klik untuk sort · Klik kanan untuk hide"
                      >
                        <div className={cn('flex items-center gap-1',
                          col.align === 'right'  && 'justify-end',
                          col.align === 'center' && 'justify-center',
                        )}>
                          {col.align === 'right' && <SortIcon col={col.key}/>}
                          {col.label}
                          {col.align !== 'right' && <SortIcon col={col.key}/>}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={visibleCols.length} className="py-16 text-center text-slate-400">
                        <Package size={36} className="mx-auto mb-3 opacity-30"/>
                        <p className="text-sm">{search ? 'Tidak ada hasil.' : 'Semua PO sudah terpenuhi.'}</p>
                      </td>
                    </tr>
                  ) : pageItems.map((item, ri) => (
                    <tr key={ri} className={cn('hover:bg-blue-50/30 dark:hover:bg-slate-700/20 transition-colors', rowBg(item))}>
                      {visibleCols.map((col, ci) => (
                        <td
                          key={col.key}
                          className={cn(
                            'px-3 py-2',
                            col.align === 'right'  && 'text-right',
                            col.align === 'center' && 'text-center',
                            col.key === 'skuName'  && 'max-w-[200px] truncate',
                            ci === 0 && 'sticky left-0 z-10 bg-inherit',
                          )}
                          title={col.key === 'skuName' ? item.skuName : undefined}
                        >
                          {renderCell(item, col.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && filtered.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Tampilkan</span>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                  onClick={e => e.stopPropagation()}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                >
                  {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / halaman</option>)}
                </select>
                <span className="hidden sm:inline">
                  · {pageStart + 1}–{pageEnd} dari {filtered.length} item
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)} disabled={safePage === 1}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-medium disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-400">
                  «
                </button>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-medium disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-400 flex items-center gap-0.5">
                  <ChevronLeft size={13}/> Prev
                </button>

                <div className="flex items-center gap-1 mx-1">
                  {(() => {
                    const pages: (number | '...')[] = [];
                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) pages.push(i);
                    } else {
                      pages.push(1);
                      if (safePage > 3) pages.push('...');
                      for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i++) pages.push(i);
                      if (safePage < totalPages - 2) pages.push('...');
                      pages.push(totalPages);
                    }
                    return pages.map((p, i) => p === '...'
                      ? <span key={`e${i}`} className="px-1 text-xs text-slate-400">…</span>
                      : (
                        <button key={p} onClick={() => setPage(p as number)}
                          className={cn(
                            'w-7 h-7 rounded-lg text-xs font-medium transition-colors',
                            safePage === p
                              ? 'bg-blue-600 text-white'
                              : 'border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                          )}>
                          {p}
                        </button>
                      )
                    );
                  })()}
                </div>

                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-medium disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-400 flex items-center gap-0.5">
                  Next <ChevronRight size={13}/>
                </button>
                <button
                  onClick={() => setPage(totalPages)} disabled={safePage === totalPages}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-xs font-medium disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-400">
                  »
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400 text-center pb-2">
          {filtered.length} item · refresh otomatis ~2 menit
          {hiddenCols.size > 0 && (
            <button onClick={showAllCols} className="ml-2 text-blue-500 hover:underline inline-flex items-center gap-1">
              <Eye size={11}/> tampilkan {hiddenCols.size} kolom tersembunyi
            </button>
          )}
        </p>
      </main>

      {/* Context menu (right-click on header) */}
      {contextMenu && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[180px] text-sm">
          <div className="px-3 py-1.5 text-xs text-slate-400 font-medium border-b border-slate-100 dark:border-slate-700">
            {ALL_COLS.find(c => c.key === contextMenu.colKey)?.label}
          </div>
          <button
            onClick={() => hideCol(contextMenu.colKey)}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            Sembunyikan kolom ini
          </button>
          {hiddenCols.size > 0 && (
            <button
              onClick={showAllCols}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-blue-600 dark:text-blue-400 transition-colors flex items-center gap-2">
              <Eye size={13}/>
              Tampilkan semua kolom
            </button>
          )}
          <button
            onClick={() => { handleSort(contextMenu.colKey); setContextMenu(null); }}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors flex items-center gap-2">
            <ChevronsUpDown size={13}/>
            Sort kolom ini
          </button>
        </div>
      )}
    </div>
  );
}
