'use client';
import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import {
  AlertTriangle, Clock, CheckCircle2, PackageX,
  Package, RefreshCw, ShieldAlert, Archive, TrendingDown,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { cn } from '@/lib/utils/cn';
import type { POLine, DashboardFilter, DashboardSummary, MasterItem, StockItem, UrgencyLevel } from '@/types';

interface EnrichedLine extends POLine {
  ocsCode:     string | null;
  stockOnHand: number | null;
  qtyPending:  number;
  urgency:     UrgencyLevel;
  cls:         'pending' | 'partial' | 'fulfilled' | 'not_yet';
}

function classifyLine(p: POLine): EnrichedLine['cls'] {
  if (p.qtyPO === 0) return 'not_yet';
  const pct = (p.totalQtyReceived / p.qtyPO) * 100;
  if (pct === 0 && p.qtyTidakFulfill === p.qtyPO) return 'not_yet';
  if (pct >= 100) return 'fulfilled';
  if (pct > 0)    return 'partial';
  return 'pending';
}

function calcUrgency(
  cls: EnrichedLine['cls'],
  stockOnHand: number | null,
  qtyPending: number,
  leadTime: number,
): UrgencyLevel {
  if (cls !== 'pending' && cls !== 'partial') return null;
  if (stockOnHand !== null) {
    if (stockOnHand < 0)  return 'stock_minus'; // oversell - most urgent
    if (stockOnHand === 0) return 'stock_empty';
    if (qtyPending > 0 && stockOnHand <= qtyPending * 0.5) return 'stock_low';
  }
  if (leadTime > 0) return 'overdue';
  return null;
}

// Lower = more urgent
const URGENCY_ORDER: Record<string, number> = {
  stock_minus: 0,
  stock_empty: 1,
  stock_low:   2,
  overdue:     3,
};

function enrichLines(
  lines:    POLine[],
  sapToOcs: Map<string, string>,
  stockMap: Map<string, number>,
): EnrichedLine[] {
  return lines.map(l => {
    const cls        = classifyLine(l);
    const qtyPending = Math.max(0, l.qtyPO - l.totalQtyReceived);
    const ocsCode    = sapToOcs.get(l.sapCode) ?? null;
    const stockOnHand = ocsCode !== null
      ? (stockMap.has(ocsCode) ? stockMap.get(ocsCode)! : null)
      : null;
    const urgency = calcUrgency(cls, stockOnHand, qtyPending, l.leadTimePOOutstanding ?? 0);
    return { ...l, cls, ocsCode, stockOnHand, qtyPending, urgency };
  });
}

const CARDS = [
  { key: 'all',       label: 'Total Open PO', icon: Package,       color: 'blue'   },
  { key: 'urgent',    label: 'Urgent',         icon: AlertTriangle, color: 'red'    },
  { key: 'pending',   label: 'Pending',        icon: Clock,         color: 'amber'  },
  { key: 'partial',   label: 'Partial',        icon: PackageX,      color: 'orange' },
  { key: 'fulfilled', label: 'Fulfilled',      icon: CheckCircle2,  color: 'green'  },
  { key: 'not_yet',   label: 'Not Yet',        icon: PackageX,      color: 'slate'  },
] as const;

const COLOR_MAP: Record<string, string> = {
  blue:   'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300',
  red:    'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
  amber:  'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
  orange: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300',
  green:  'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
  slate:  'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300',
};

function UrgencyBadge({ reason }: { reason: UrgencyLevel }) {
  if (!reason) return null;
  if (reason === 'stock_minus') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300">
        <TrendingDown size={11} /> Oversell
      </span>
    );
  }
  if (reason === 'stock_empty') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">
        <Archive size={11} /> Stok Kosong
      </span>
    );
  }
  if (reason === 'stock_low') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
        <ShieldAlert size={11} /> Stok Rendah
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
      <Clock size={11} /> Overdue
    </span>
  );
}

function StockCell({ line }: { line: EnrichedLine }) {
  if (line.stockOnHand === null) {
    return <span className="text-muted text-xs">-</span>;
  }
  const isMinus = line.stockOnHand < 0;
  const isEmpty = line.stockOnHand === 0;
  const isLow   = !isMinus && !isEmpty && line.qtyPending > 0 && line.stockOnHand <= line.qtyPending * 0.5;
  let cls = 'text-green-600 dark:text-green-400';
  if (isMinus) cls = 'text-purple-700 dark:text-purple-400';
  else if (isEmpty) cls = 'text-red-600 dark:text-red-400';
  else if (isLow)   cls = 'text-orange-600 dark:text-orange-400';
  return <span className={cn('font-semibold', cls)}>{line.stockOnHand.toLocaleString()}</span>;
}

function rowBgFor(urgency: UrgencyLevel): string {
  if (urgency === 'stock_minus') return 'bg-purple-50/50 dark:bg-purple-900/10';
  if (urgency === 'stock_empty') return 'bg-red-50/40 dark:bg-red-900/10';
  if (urgency === 'stock_low')   return 'bg-orange-50/40 dark:bg-orange-900/10';
  return '';
}

export default function DashboardPage() {
  const [lines,    setLines]    = useState<EnrichedLine[]>([]);
  const [filter,   setFilter]   = useState<DashboardFilter>('urgent');
  const [loading,  setLoading]  = useState(true);
  const [hasStock, setHasStock] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [poRes, masterSnap, stockSnap] = await Promise.all([
        fetch('/api/po').then(r => r.json()),
        getDocs(collection(db, 'master_items')),
        getDocs(collection(db, 'stock')),
      ]);

      const poLines: POLine[] = Array.isArray(poRes) ? poRes : [];

      const sapToOcs = new Map<string, string>();
      masterSnap.docs.forEach(d => {
        const m = d.data() as MasterItem;
        if (m.sap1) sapToOcs.set(m.sap1.trim(), m.ocsCode.trim());
        if (m.sap2) sapToOcs.set(m.sap2.trim(), m.ocsCode.trim());
      });

      const stockMap = new Map<string, number>();
      stockSnap.docs.forEach(d => {
        const s = d.data() as StockItem;
        stockMap.set(s.ocsCode.trim(), Number(s.qtyOnHand));
      });

      setHasStock(stockMap.size > 0);
      setLines(enrichLines(poLines, sapToOcs, stockMap));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const summary: DashboardSummary = {
    totalOpenPO:    lines.length,
    urgentCount:    lines.filter(l => l.urgency !== null).length,
    pendingCount:   lines.filter(l => l.cls === 'pending').length,
    partialCount:   lines.filter(l => l.cls === 'partial').length,
    fulfilledCount: lines.filter(l => l.cls === 'fulfilled').length,
    notYetCount:    lines.filter(l => l.cls === 'not_yet').length,
  };

  const countFor = (key: string): number => {
    if (key === 'all')       return summary.totalOpenPO;
    if (key === 'urgent')    return summary.urgentCount;
    if (key === 'pending')   return summary.pendingCount;
    if (key === 'partial')   return summary.partialCount;
    if (key === 'fulfilled') return summary.fulfilledCount;
    if (key === 'not_yet')   return summary.notYetCount;
    return 0;
  };

  const visibleLines = lines
    .filter(l => {
      if (filter === 'all')       return true;
      if (filter === 'urgent')    return l.urgency !== null;
      if (filter === 'fulfilled') return l.cls === 'fulfilled';
      if (filter === 'not_yet')   return l.cls === 'not_yet';
      return l.cls === filter;
    })
    .sort((a, b) => {
      if (filter !== 'urgent') return 0;
      const sa = a.urgency ? (URGENCY_ORDER[a.urgency] ?? 9) : 9;
      const sb = b.urgency ? (URGENCY_ORDER[b.urgency] ?? 9) : 9;
      if (sa !== sb) return sa - sb;
      return b.qtyPending - a.qtyPending;
    });

  const oversellCount   = visibleLines.filter(l => l.urgency === 'stock_minus').length;
  const emptyStockCount = visibleLines.filter(l => l.urgency === 'stock_empty').length;

  const TH  = ({ children }: { children: React.ReactNode }) => (
    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{children}</th>
  );
  const THR = ({ children }: { children: React.ReactNode }) => (
    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{children}</th>
  );

  return (
    <AppShell>
      <div className="space-y-6">

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-[rgb(var(--text))]">Dashboard</h1>
          <div className="flex items-center gap-3">
            {!hasStock && !loading && (
              <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-2 py-1 rounded-lg">
                Belum ada data stock - urgent hanya berdasarkan lead time
              </span>
            )}
            <button onClick={fetchAll}
              className="flex items-center gap-1.5 text-sm text-muted hover:text-[rgb(var(--text))] transition-colors">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {CARDS.map(({ key, label, icon: Icon, color }) => {
            const count  = countFor(key);
            const active = filter === key;
            return (
              <button key={key} onClick={() => setFilter(key as DashboardFilter)}
                className={cn(
                  'flex flex-col items-start p-4 rounded-xl border transition-all text-left',
                  active
                    ? COLOR_MAP[color] + ' ring-2 ring-offset-1 ring-current/30'
                    : 'bg-[rgb(var(--surface))] border-[rgb(var(--border))] hover:border-current',
                )}>
                <Icon size={20} className="mb-2 opacity-70" />
                <div className="text-2xl font-bold">{loading ? '-' : count}</div>
                <div className="text-xs font-medium mt-0.5 opacity-80">{label}</div>
              </button>
            );
          })}
        </div>

        <div className="bg-[rgb(var(--surface))] rounded-xl border border-[rgb(var(--border))] overflow-hidden">
          <div className="px-4 py-3 border-b border-[rgb(var(--border))] flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[rgb(var(--text))]">
              {CARDS.find(c => c.key === filter)?.label ?? filter}
            </span>
            <span className="text-xs text-muted">({visibleLines.length} item)</span>
            {filter === 'urgent' && (
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {oversellCount > 0 && (
                  <span className="text-xs text-purple-700 dark:text-purple-400 font-medium flex items-center gap-1">
                    <TrendingDown size={12}/> {oversellCount} oversell
                  </span>
                )}
                {emptyStockCount > 0 && (
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                    <Archive size={12}/> {emptyStockCount} stok kosong
                  </span>
                )}
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-brand-600 border-t-transparent" />
            </div>
          ) : visibleLines.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted">Tidak ada data.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    {filter === 'urgent' ? (
                      <>
                        <TH>No PO</TH><TH>Tgl PO</TH><TH>OCS Code</TH>
                        <TH>Nama Produk</TH><TH>SAP Code</TH>
                        <THR>QTY PO</THR><THR>QTY Pending</THR>
                        <THR>Stok On Hand</THR><TH>Alasan</TH><TH>Status</TH>
                      </>
                    ) : (
                      <>
                        <TH>No PO</TH><TH>Tgl PO</TH><TH>OCS Code</TH>
                        <TH>SKU</TH><TH>SAP Code</TH>
                        <THR>QTY PO</THR><THR>QTY Pending</THR>
                        <TH>% Received</TH><TH>Lead Time</TH><TH>Status</TH>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]">
                  {visibleLines.slice(0, 100).map((l, i) => {
                    const pct = l.qtyPO > 0 ? Math.round((l.totalQtyReceived / l.qtyPO) * 100) : 0;
                    const bg  = rowBgFor(l.urgency);

                    const clsLabel = l.cls === 'fulfilled' ? 'Fulfilled'
                      : l.cls === 'partial' ? 'Partial'
                      : l.cls === 'not_yet' ? 'Not Yet' : 'Pending';
                    const clsBadge = l.cls === 'fulfilled'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : l.cls === 'partial'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : l.cls === 'not_yet'
                      ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                      : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';

                    const ocsTd = (
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-brand-600 dark:text-brand-400">
                        {l.ocsCode ?? <span className="text-muted font-normal">-</span>}
                      </td>
                    );
                    const statusTd = (
                      <td className="px-4 py-2.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', clsBadge)}>
                          {clsLabel}
                        </span>
                      </td>
                    );

                    if (filter === 'urgent') {
                      return (
                        <tr key={i} className={cn('hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors', bg)}>
                          <td className="px-4 py-2.5 font-medium whitespace-nowrap">{l.noPO}</td>
                          <td className="px-4 py-2.5 text-muted whitespace-nowrap">{l.date}</td>
                          {ocsTd}
                          <td className="px-4 py-2.5 max-w-[200px] truncate" title={l.sku}>{l.sku}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-muted">{l.sapCode}</td>
                          <td className="px-4 py-2.5 text-right">{l.qtyPO.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right font-bold text-red-600 dark:text-red-400">
                            {l.qtyPending.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right"><StockCell line={l} /></td>
                          <td className="px-4 py-2.5"><UrgencyBadge reason={l.urgency} /></td>
                          {statusTd}
                        </tr>
                      );
                    }

                    return (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium">{l.noPO}</td>
                        <td className="px-4 py-2.5 text-muted">{l.date}</td>
                        {ocsTd}
                        <td className="px-4 py-2.5 max-w-[200px] truncate">{l.sku}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted">{l.sapCode}</td>
                        <td className="px-4 py-2.5 text-right">{(l.qtyPO ?? 0).toLocaleString()}</td>
                        <td className={cn('px-4 py-2.5 text-right font-semibold', l.qtyPending > 0 ? 'text-red-500' : 'text-green-600')}>
                          {l.qtyPending.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 min-w-[48px]">
                              <div
                                className={cn('h-1.5 rounded-full', pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-red-400')}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted w-8">{pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {(l.leadTimePOOutstanding ?? 0) > 0
                            ? <span className="text-xs font-medium text-red-500">{l.leadTimePOOutstanding}h</span>
                            : <span className="text-muted">-</span>}
                        </td>
                        {statusTd}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visibleLines.length > 100 && (
                <p className="text-center text-xs text-muted py-3">
                  Menampilkan 100 dari {visibleLines.length} item
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
