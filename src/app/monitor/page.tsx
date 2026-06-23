'use client';
import { useState, useEffect, useCallback } from 'react';
import { Search, Download, RefreshCw, Package, Archive, ShieldAlert, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { MonitorItem } from '@/types';
import * as XLSX from 'xlsx';

export default function MonitorPage() {
  const [items,     setItems]     = useState<MonitorItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

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

  const filtered = items.filter(item => {
    const q = search.toLowerCase();
    return !q
      || item.sapCode.includes(q)
      || item.ocsCode.toLowerCase().includes(q)
      || item.skuName.toLowerCase().includes(q)
      || String(item.noPO).includes(q);
  });

  const urgencyLabel = (u: MonitorItem['urgency']): string => {
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
      'QTY Sudah Diterima': i.qtyReceived,
      'QTY Pending':        i.qtyPending,
      '% Diterima':         `${i.pctFulfill}%`,
      'Stok On Hand':       i.stockOnHand ?? '-',
      'Urgensi':            urgencyLabel(i.urgency),
      'Kedatangan Terakhir':i.lastArrival ?? '',
      'Remark':             i.remarkPO ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const colWidths = Object.keys(rows[0] ?? {}).map(k => ({
      wch: Math.max(k.length, ...rows.map(r => String((r as Record<string, unknown>)[k] ?? '').length)) + 2,
    }));
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pending PO');
    XLSX.writeFile(wb, `pending_po_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const totalPending      = filtered.reduce((s, i) => s + i.qtyPending, 0);
  const stockMinusCount   = filtered.filter(i => i.urgency === 'stock_minus').length;
  const stockEmptyCount   = filtered.filter(i => i.urgency === 'stock_empty').length;
  const stockLowCount     = filtered.filter(i => i.urgency === 'stock_low').length;
  const hasStockData      = items.some(i => i.stockOnHand !== null);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-4 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Package size={20} className="text-blue-600"/>
              <h1 className="text-lg font-bold text-slate-800 dark:text-white">Monitor Pending PO</h1>
              <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 px-2 py-0.5 rounded-full font-medium">PUBLIC</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              PT EJI Group · PO yang sudah dibuat namun belum sepenuhnya diterima
              {lastFetch && ` · Update: ${lastFetch.toLocaleTimeString('id-ID')}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchData} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500" title="Refresh">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>
            </button>
            <button onClick={exportExcel} disabled={filtered.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
              <Download size={15}/> Export Excel
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 space-y-4">

        {/* Summary cards - 5 cols when stock available, 2 otherwise */}
        <div className={cn('grid gap-3', hasStockData ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2')}>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-500 mb-1">Total PO Pending</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">{filtered.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-500 mb-1">Total QTY Pending</p>
            <p className="text-2xl font-black text-red-600 dark:text-red-400">{totalPending.toLocaleString()}</p>
            <p className="text-xs text-slate-400">PC</p>
          </div>

          {hasStockData && (
            <>
              {/* Oversell / Stock Minus */}
              <div className={cn(
                'rounded-xl border p-4',
                stockMinusCount > 0
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              )}>
                <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                  <TrendingDown size={11} className={stockMinusCount > 0 ? 'text-purple-500' : ''}/>
                  Oversell
                </p>
                <p className={cn('text-2xl font-black', stockMinusCount > 0 ? 'text-purple-700 dark:text-purple-400' : 'text-slate-800 dark:text-white')}>
                  {stockMinusCount}
                </p>
                <p className="text-xs text-slate-400">stok minus</p>
              </div>

              {/* Stok Kosong */}
              <div className={cn(
                'rounded-xl border p-4',
                stockEmptyCount > 0
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              )}>
                <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                  <Archive size={11} className={stockEmptyCount > 0 ? 'text-red-500' : ''}/>
                  Stok Kosong
                </p>
                <p className={cn('text-2xl font-black', stockEmptyCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-white')}>
                  {stockEmptyCount}
                </p>
                <p className="text-xs text-slate-400">item</p>
              </div>

              {/* Stok Rendah */}
              <div className={cn(
                'rounded-xl border p-4',
                stockLowCount > 0
                  ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
              )}>
                <p className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                  <ShieldAlert size={11} className={stockLowCount > 0 ? 'text-orange-500' : ''}/>
                  Stok Rendah
                </p>
                <p className={cn('text-2xl font-black', stockLowCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-800 dark:text-white')}>
                  {stockLowCount}
                </p>
                <p className="text-xs text-slate-400">stok &le; 50% pending</p>
              </div>
            </>
          )}
        </div>

        {/* Legend */}
        {hasStockData && (
          <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
            <span className="font-medium">Urutan prioritas:</span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 font-medium">
              <TrendingDown size={10}/> Oversell
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">
              <Archive size={10}/> Stok Kosong
            </span>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 font-medium">
              <ShieldAlert size={10}/> Stok Rendah
            </span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
              PO Lainnya
            </span>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari No PO, SAP Code, OCS Code, atau nama produk..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-800 dark:text-white placeholder-slate-400"
          />
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"/>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/50 sticky top-0">
                  <tr>
                    {[
                      'No PO', 'Tgl PO', 'OCS Code', 'Nama Produk',
                      'QTY PO', 'Sudah Diterima', 'QTY Pending', '% Diterima',
                      ...(hasStockData ? ['Stok On Hand', 'Urgensi'] : []),
                      'Kedatangan Terakhir', 'Status',
                    ].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {filtered.map((item, i) => {
                    const pct       = item.pctFulfill;
                    const isPartial = item.qtyReceived > 0;
                    const isMinus   = item.urgency === 'stock_minus';
                    const isEmpty   = item.urgency === 'stock_empty';
                    const isLow     = item.urgency === 'stock_low';

                    // Row background — most urgent gets darkest/distinctive color
                    let rowBg = !isPartial ? 'bg-red-50/40 dark:bg-red-900/5' : '';
                    if (isMinus)      rowBg = 'bg-purple-50/70 dark:bg-purple-900/15';
                    else if (isEmpty) rowBg = 'bg-red-50/60 dark:bg-red-900/10';
                    else if (isLow)   rowBg = 'bg-orange-50/60 dark:bg-orange-900/10';

                    // Stock On Hand color
                    let stockCls = 'text-green-600 dark:text-green-400';
                    if (isMinus)      stockCls = 'text-purple-700 dark:text-purple-400';
                    else if (isEmpty) stockCls = 'text-red-600 dark:text-red-400';
                    else if (isLow)   stockCls = 'text-orange-600 dark:text-orange-400';

                    return (
                      <tr key={i} className={cn('hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors', rowBg)}>
                        <td className="px-4 py-3 font-medium text-slate-800 dark:text-white whitespace-nowrap">{item.noPO}</td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{item.date}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">{item.ocsCode}</td>
                        <td className="px-4 py-3 max-w-[220px] truncate text-slate-700 dark:text-slate-300" title={item.skuName}>{item.skuName}</td>
                        <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-300">{item.qtyPO.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right text-green-700 dark:text-green-400 font-medium">{item.qtyReceived.toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-600 dark:text-red-400">{item.qtyPending.toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
                              <div className={cn('h-1.5 rounded-full', pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-red-400')}
                                style={{ width: `${Math.min(pct, 100)}%` }}/>
                            </div>
                            <span className="text-xs text-slate-500 whitespace-nowrap">{pct}%</span>
                          </div>
                        </td>

                        {hasStockData && (
                          <>
                            <td className="px-4 py-3 text-right">
                              {item.stockOnHand === null
                                ? <span className="text-slate-400 text-xs">-</span>
                                : <span className={cn('font-semibold', stockCls)}>
                                    {item.stockOnHand.toLocaleString()}
                                  </span>
                              }
                            </td>
                            <td className="px-4 py-3">
                              {isMinus ? (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                                  <TrendingDown size={10}/> Oversell
                                </span>
                              ) : isEmpty ? (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                  <Archive size={10}/> Stok Kosong
                                </span>
                              ) : isLow ? (
                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                                  <ShieldAlert size={10}/> Stok Rendah
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs">-</span>
                              )}
                            </td>
                          </>
                        )}

                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{item.lastArrival ?? '-'}</td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap',
                            !isPartial
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400')}>
                            {!isPartial ? 'Belum Terima' : 'Partial'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="text-center py-16 text-slate-400">
                  <Package size={40} className="mx-auto mb-3 opacity-30"/>
                  <p className="text-sm">{search ? 'Tidak ada hasil untuk pencarian ini.' : 'Semua PO sudah terpenuhi.'}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400 text-center">
          Menampilkan {filtered.length} dari {items.length} item · Data diperbarui setiap ~2 menit
          {!hasStockData && ' · Upload stock untuk melihat urgensi stok'}
        </p>
      </main>
    </div>
  );
}
