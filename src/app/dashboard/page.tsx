'use client';
import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AlertTriangle, Clock, CheckCircle2, PackageX, Package, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { POLine, DashboardFilter, DashboardSummary } from '@/types';

function classifyLine(p: POLine) {
  const pct = p.qtyPO > 0 ? (p.totalQtyReceived / p.qtyPO) * 100 : 0;
  if (p.qtyPO === 0) return 'not_yet';
  if (pct === 0 && p.qtyTidakFulfill === p.qtyPO) return 'not_yet';
  if (pct >= 100) return 'fulfilled';
  if (pct > 0)    return 'partial';
  return 'pending';
}

function isUrgent(p: POLine): boolean {
  const cls = classifyLine(p);
  return (cls === 'pending' || cls === 'partial') && (p.leadTimePOOutstanding ?? 0) > 0;
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
  blue:   'bg-blue-50 dark:bg-blue-900/20   border-blue-200 dark:border-blue-800   text-blue-700 dark:text-blue-300',
  red:    'bg-red-50 dark:bg-red-900/20     border-red-200 dark:border-red-800     text-red-700 dark:text-red-300',
  amber:  'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
  orange: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300',
  green:  'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300',
  slate:  'bg-slate-50 dark:bg-slate-800/40  border-slate-200 dark:border-slate-700  text-slate-700 dark:text-slate-300',
};

export default function DashboardPage() {
  const [lines,   setLines]   = useState<POLine[]>([]);
  const [filter,  setFilter]  = useState<DashboardFilter>('urgent');
  const [loading, setLoading] = useState(true);

  const fetchPO = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/po');
      const data = await res.json();
      setLines(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPO(); }, [fetchPO]);

  const summary: DashboardSummary = {
    totalOpenPO: lines.length,
    pendingCount:   lines.filter(l => classifyLine(l) === 'pending').length,
    partialCount:   lines.filter(l => classifyLine(l) === 'partial').length,
    fulfilledCount: lines.filter(l => classifyLine(l) === 'fulfilled').length,
    notYetCount:    lines.filter(l => classifyLine(l) === 'not_yet').length,
    urgentCount:    lines.filter(isUrgent).length,
  };

  const countFor = (key: string) => {
    if (key === 'all')       return summary.totalOpenPO;
    if (key === 'urgent')    return summary.urgentCount;
    if (key === 'pending')   return summary.pendingCount;
    if (key === 'partial')   return summary.partialCount;
    if (key === 'fulfilled') return summary.fulfilledCount;
    if (key === 'not_yet')   return summary.notYetCount;
    return 0;
  };

  const filteredLines = lines.filter(l => {
    if (filter === 'all')       return true;
    if (filter === 'urgent')    return isUrgent(l);
    if (filter === 'fulfilled') return classifyLine(l) === 'fulfilled';
    if (filter === 'not_yet')   return classifyLine(l) === 'not_yet';
    return classifyLine(l) === filter;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-[rgb(var(--text))]">Dashboard</h1>
          <button onClick={fetchPO} className="flex items-center gap-1.5 text-sm text-muted hover:text-[rgb(var(--text))] transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {CARDS.map(({ key, label, icon: Icon, color }) => {
            const count = countFor(key);
            const active = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key as DashboardFilter)}
                className={cn(
                  'flex flex-col items-start p-4 rounded-xl border transition-all text-left',
                  active ? COLOR_MAP[color] + ' ring-2 ring-offset-1 ring-current/30' : 'bg-[rgb(var(--surface))] border-[rgb(var(--border))] hover:border-current',
                  !active && 'hover:' + COLOR_MAP[color].split(' ')[0]
                )}
              >
                <Icon size={20} className="mb-2 opacity-70" />
                <div className="text-2xl font-bold">{loading ? '—' : count}</div>
                <div className="text-xs font-medium mt-0.5 opacity-80">{label}</div>
              </button>
            );
          })}
        </div>

        {/* Data list */}
        <div className="bg-[rgb(var(--surface))] rounded-xl border border-[rgb(var(--border))] overflow-hidden">
          <div className="px-4 py-3 border-b border-[rgb(var(--border))] flex items-center gap-2">
            <span className="text-sm font-semibold text-[rgb(var(--text))]">
              {CARDS.find(c => c.key === filter)?.label ?? filter}
            </span>
            <span className="text-xs text-muted">({filteredLines.length} item)</span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-brand-600 border-t-transparent" />
            </div>
          ) : filteredLines.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted">Tidak ada data.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    {['No PO','Tgl PO','SKU','SAP Code','QTY PO','QTY Pending','% Received','Lead Time','Status'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]">
                  {filteredLines.slice(0, 50).map((l, i) => {
                    const cls = classifyLine(l);
                    const pending = l.qtyPO - l.totalQtyReceived;
                    const pct = l.qtyPO > 0 ? Math.round((l.totalQtyReceived / l.qtyPO) * 100) : 0;
                    return (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-2.5 font-medium">{l.noPO}</td>
                        <td className="px-4 py-2.5 text-muted">{l.date}</td>
                        <td className="px-4 py-2.5 max-w-[200px] truncate">{l.sku}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{l.sapCode}</td>
                        <td className="px-4 py-2.5 text-right">{l.qtyPO.toLocaleString()}</td>
                        <td className={cn('px-4 py-2.5 text-right font-semibold', pending > 0 ? 'text-red-500' : 'text-green-600')}>
                          {pending.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 min-w-[48px]">
                              <div className={cn('h-1.5 rounded-full', pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-red-400')} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            <span className="text-xs text-muted w-8">{pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {(l.leadTimePOOutstanding ?? 0) > 0
                            ? <span className="text-xs font-medium text-red-500">{l.leadTimePOOutstanding}h</span>
                            : <span className="text-muted">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                            cls === 'fulfilled' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            cls === 'partial'   ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            cls === 'not_yet'   ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400' :
                                                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          )}>
                            {cls === 'fulfilled' ? 'Fulfilled' : cls === 'partial' ? 'Partial' : cls === 'not_yet' ? 'Not Yet' : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
