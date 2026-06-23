'use client';
import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Search, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { POLine } from '@/types';

type Filter = 'all' | 'pending' | 'partial' | 'fulfilled' | 'not_yet';

export default function OpenPOPage() {
  const [lines,   setLines]   = useState<POLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState<Filter>('all');
  const [expanded, setExpanded] = useState<number | null>(null);

  const fetchPO = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/po');
      const data = await res.json();
      setLines(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPO(); }, [fetchPO]);

  function classify(p: POLine): Filter {
    const pct = p.qtyPO > 0 ? (p.totalQtyReceived / p.qtyPO) * 100 : 0;
    if (pct >= 100) return 'fulfilled';
    if (pct > 0)    return 'partial';
    if (p.qtyTidakFulfill === p.qtyPO) return 'not_yet';
    return 'pending';
  }

  const filtered = lines.filter(l => {
    const matchFilter = filter === 'all' || classify(l) === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || l.sku.toLowerCase().includes(q) || l.sapCode.includes(q) || String(l.noPO).includes(q);
    return matchFilter && matchSearch;
  });

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all',       label: 'Semua' },
    { key: 'pending',   label: 'Pending' },
    { key: 'partial',   label: 'Partial' },
    { key: 'not_yet',   label: 'Not Yet' },
    { key: 'fulfilled', label: 'Fulfilled' },
  ];

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-[rgb(var(--text))]">Open PO Monitoring</h1>
          <button onClick={fetchPO} className="flex items-center gap-1.5 text-sm text-muted hover:text-[rgb(var(--text))]">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                filter === f.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-[rgb(var(--surface))] border border-[rgb(var(--border))] text-[rgb(var(--text))] hover:border-brand-400')}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari SKU, SAP Code, atau No PO…"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>

        {/* Table */}
        <div className="bg-[rgb(var(--surface))] rounded-xl border border-[rgb(var(--border))] overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-7 w-7 border-2 border-brand-600 border-t-transparent" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0">
                  <tr>
                    {['','No PO','Tgl PO','SKU','SAP','QTY PO','QTY Fulfill','% PO','Total Received','% Received','Status','Remark'].map((h,i) => (
                      <th key={i} className="text-left px-3 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]">
                  {filtered.map((l, i) => {
                    const cls = classify(l);
                    const pct = l.qtyPO > 0 ? Math.round((l.totalQtyReceived / l.qtyPO) * 100) : 0;
                    const isExpanded = expanded === i;
                    return (
                      <>
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                          onClick={() => setExpanded(isExpanded ? null : i)}>
                          <td className="px-3 py-2.5 text-muted">
                            {isExpanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                          </td>
                          <td className="px-3 py-2.5 font-medium">{l.noPO}</td>
                          <td className="px-3 py-2.5 text-muted whitespace-nowrap">{l.date}</td>
                          <td className="px-3 py-2.5 max-w-[180px] truncate" title={l.sku}>{l.sku}</td>
                          <td className="px-3 py-2.5 font-mono text-xs">{l.sapCode}</td>
                          <td className="px-3 py-2.5 text-right">{(l.qtyPO ?? 0).toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-right">{(l.qtyFulfill ?? 0).toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-right">{l.persentasePO}</td>
                          <td className="px-3 py-2.5 text-right font-semibold">{(l.totalQtyReceived ?? 0).toLocaleString()}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <div className="w-12 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
                                <div className={cn('h-1.5 rounded-full', pct>=100?'bg-green-500':pct>0?'bg-amber-500':'bg-red-400')} style={{width:`${Math.min(pct,100)}%`}}/>
                              </div>
                              <span className="text-xs text-muted">{pct}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                              cls==='fulfilled'?'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400':
                              cls==='partial'  ?'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400':
                              cls==='not_yet'  ?'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400':
                                                'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400')}>
                              {cls}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted">{l.remarkReceived}</td>
                        </tr>
                        {isExpanded && (
                          <tr key={`exp-${i}`} className="bg-slate-50 dark:bg-slate-800/30">
                            <td colSpan={12} className="px-6 py-4">
                              <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">Data GR (10 slot terakhir)</p>
                              <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                                {l.received.map((r, ri) => (
                                  <div key={ri} className={cn('text-xs p-2 rounded-lg border text-center',
                                    r.qty != null ? 'border-green-300 bg-green-50 dark:bg-green-900/20 dark:border-green-800' : 'border-dashed border-[rgb(var(--border))]')}>
                                    <div className="font-semibold">{ri+1}</div>
                                    <div className="font-bold text-green-700 dark:text-green-400">{r.qty != null ? r.qty.toLocaleString() : '—'}</div>
                                    <div className="text-muted">{r.arrivalDate ?? ''}</div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && !loading && (
                <div className="text-center py-10 text-sm text-muted">Tidak ada data.</div>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-muted">{filtered.length} dari {lines.length} item ditampilkan.</p>
      </div>
    </AppShell>
  );
}
