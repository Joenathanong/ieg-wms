'use client';
import { useState, useEffect, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Upload, Search, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import toast from 'react-hot-toast';
import type { StockItem } from '@/types';

export default function StockPage() {
  const [items,    setItems]    = useState<StockItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [uploading,setUploading]= useState(false);
  const [search,   setSearch]   = useState('');
  const [lastUpload, setLastUpload] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchStock = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'stock'));
      const data = snap.docs.map(d => d.data() as StockItem);
      setItems(data);
      if (data.length > 0) setLastUpload(data[0].uploadedAt);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchStock(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) { toast.error('Format file harus .xlsx atau .xls'); return; }

    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/stock/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.count} item berhasil diupload.`);
      await fetchStock();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload gagal');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const filtered = items.filter(item => {
    const q = search.toLowerCase();
    return !q || item.ocsCode.toLowerCase().includes(q) || item.skuName.toLowerCase().includes(q);
  });

  // Low stock: available < 1000 (threshold dapat disesuaikan)
  const lowStock = items.filter(i => i.availableQty < 1000 && i.qtyOnHand > 0);

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[rgb(var(--text))]">Stock Monitoring</h1>
            {lastUpload && <p className="text-xs text-muted mt-0.5">Last upload: {new Date(lastUpload).toLocaleString('id-ID')}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchStock} className="flex items-center gap-1.5 text-sm text-muted hover:text-[rgb(var(--text))]">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60">
              <Upload size={15} /> {uploading ? 'Uploading…' : 'Upload Stock'}
            </button>
          </div>
        </div>

        {/* Low stock alert */}
        {lowStock.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                {lowStock.length} item dengan stok rendah (&lt; 1.000 available)
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                {lowStock.slice(0,5).map(i=>i.ocsCode).join(', ')}{lowStock.length > 5 ? ` +${lowStock.length-5} lainnya` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari OCS Code atau nama produk…"
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
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>
                    {['OCS Code','Nama Produk','Qty Rack','Qty SAP','Qty On Hand','On Order','Available','Reserve','Status'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]">
                  {filtered.map((item, i) => (
                    <tr key={i} className={cn('hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors',
                      item.availableQty < 1000 ? 'bg-amber-50/50 dark:bg-amber-900/10' : '')}>
                      <td className="px-4 py-2.5 font-mono text-xs font-medium">{item.ocsCode}</td>
                      <td className="px-4 py-2.5 max-w-[250px] truncate" title={item.skuName}>{item.skuName}</td>
                      <td className="px-4 py-2.5 text-right">{item.qtyRack.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right">{item.qtySap.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{item.qtyOnHand.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-blue-600 dark:text-blue-400">{item.qtyOnOrder.toLocaleString()}</td>
                      <td className={cn('px-4 py-2.5 text-right font-bold', item.availableQty < 1000 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400')}>
                        {item.availableQty.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right">{item.reserveQty.toLocaleString()}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                          item.status === 'Aktif' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-slate-100 text-slate-500')}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && !loading && (
                <div className="text-center py-10 text-sm text-muted">
                  {items.length === 0 ? 'Belum ada data stock. Upload file Excel dari SAP/WMS.' : 'Tidak ada hasil pencarian.'}
                </div>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-muted">{filtered.length} dari {items.length} item.</p>
      </div>
    </AppShell>
  );
}
