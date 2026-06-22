'use client';
import { useState, useEffect, useCallback } from 'react';
import { Search, Download, RefreshCw, Package } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { MonitorItem } from '@/types';

export default function MonitorPage() {
  const [items,    setItems]    = useState<MonitorItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/monitor');
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

  const exportCSV = () => {
    const headers = ['No PO','Tgl PO','SAP Code','OCS Code','Nama Produk','QTY PO','QTY Pending','% Diterima','Kedatangan Terakhir','Remark'];
    const rows = filtered.map(i => [
      i.noPO, i.date, i.sapCode, i.ocsCode, i.skuName,
      i.qtyPO, i.qtyPending,
      `${i.pctFulfill}%`,
      i.lastArrival ?? '',
      i.remarkPO ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `pending_po_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPending = filtered.reduce((s, i) => s + i.qtyPending, 0);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
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
            <button onClick={exportCSV} disabled={filtered.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
              <Download size={15}/> Export CSV
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-500 mb-1">Total PO Pending</p>
            <p className="text-2xl font-black text-slate-800 dark:text-white">{filtered.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-500 mb-1">Total QTY Pending</p>
            <p className="text-2xl font-black text-red-600 dark:text-red-400">{totalPending.toLocaleString()}</p>
            <p className="text-xs text-slate-400">PC</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-500 mb-1">Belum ada pengiriman</p>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400">
              {filtered.filter(i => i.qtyReceived === 0).length}
            </p>
            <p className="text-xs text-slate-400">item</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari No PO, SAP Code, OCS Code, atau nama produk…"
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
                      'No PO', 'Tgl PO', 'SAP Code', 'OCS Code', 'Nama Produk',
                      'QTY PO', 'Sudah Diterima', 'QTY Pending', '% Diterima',
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
                    const pct = item.pctFulfill;
                    const isPartial = item.qtyReceived > 0;
                    return (
                      <tr key={i} className={cn('hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors',
                        !isPartial ? 'bg-red-50/40 dark:bg-red-900/5' : '')}>
                        <td className="px-4 py-3 font-medium text-slate-800 dark:text-white">{item.noPO}</td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{item.date}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{item.sapCode}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-300">{item.ocsCode}</td>
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
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{item.lastArrival ?? '—'}</td>
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
        </p>
      </main>
    </div>
  );
}
