'use client';
import { useState, useEffect, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Upload, Search, RefreshCw, AlertTriangle, Download, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import toast from 'react-hot-toast';
import type { StockItem } from '@/types';
import { buildStockTemplate } from '@/lib/utils/excel';

export default function StockPage() {
  const [items,     setItems]     = useState<StockItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search,    setSearch]    = useState('');
  const [lastUpload,setLastUpload]= useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchStock = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'stock'));
      const data = snap.docs.map(d => d.data() as StockItem);
      setItems(data.sort((a, b) => a.ocsCode.localeCompare(b.ocsCode, 'id')));
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
      const res  = await fetch('/api/stock/upload', { method: 'POST', body: form });
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

  const downloadTemplate = () => {
    try {
      const b64  = buildStockTemplate();
      const blob = new Blob(
        [Uint8Array.from(atob(b64), c => c.charCodeAt(0))],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      );
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'template_stock.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Gagal membuat template');
    }
  };

  const filtered = items.filter(item => {
    const q = search.toLowerCase();
    return !q
      || item.ocsCode.toLowerCase().includes(q)
      || item.skuName.toLowerCase().includes(q)
      || (item.sapCode ?? '').toLowerCase().includes(q);
  });

  const hasSapCode    = items.some(i => i.sapCode);
  const hasUnderRes   = items.some(i => i.isUnderReserve && i.isUnderReserve !== 'Tidak');
  const negativeStock = items.filter(i => i.qtyOnHand < 0);
  const emptyStock    = items.filter(i => i.qtyOnHand === 0);
  const underReserve  = items.filter(i => i.isUnderReserve === 'Ya');

  return (
    <AppShell>
      <div className="space-y-4">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[rgb(var(--text))]">Stock Monitoring</h1>
            <p className="text-xs text-muted mt-0.5">
              {lastUpload
                ? `Upload terakhir: ${new Date(lastUpload).toLocaleString('id-ID')}`
                : 'Belum ada data. Upload file dari OCS.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={fetchStock}
              className="p-2 rounded-lg hover:bg-[rgb(var(--surface))] text-muted" title="Refresh">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={downloadTemplate}
              className="flex items-center gap-2 px-3 py-2 border border-[rgb(var(--border))] hover:bg-[rgb(var(--surface))] rounded-lg text-sm font-medium text-[rgb(var(--text))] transition-colors">
              <FileSpreadsheet size={15} className="text-green-600"/> Template
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleUpload} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60">
              <Upload size={15} /> {uploading ? 'Uploading…' : 'Upload Stock'}
            </button>
          </div>
        </div>

        {/* Upload guide */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-xs text-blue-700 dark:text-blue-400 space-y-1">
          <p className="font-semibold flex items-center gap-1.5"><Download size={12}/> Format Upload</p>
          <p>Upload langsung file <b>Stock View</b> dari OCS (12 kolom: SKU, Sku Name, Sap Code, Category, Qty Rack, Qty Sap, Qty On Hand, Qty On Order, Available Qty, Reserve Qty, Is Under Reserve, Status).</p>
          <p>Atau download <button onClick={downloadTemplate} className="underline font-medium cursor-pointer">template di sini</button>, isi datanya, lalu upload.</p>
        </div>

        {/* Alert cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {negativeStock.length > 0 && (
            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-3 flex items-start gap-3">
              <AlertTriangle size={16} className="text-purple-500 mt-0.5 shrink-0"/>
              <div>
                <p className="text-sm font-semibold text-purple-700 dark:text-purple-400">
                  {negativeStock.length} item stok minus (oversell)
                </p>
                <p className="text-xs text-purple-600 dark:text-purple-500 mt-0.5">
                  {negativeStock.slice(0,3).map(i=>i.ocsCode).join(', ')}{negativeStock.length>3?` +${negativeStock.length-3} lainnya`:''}
                </p>
              </div>
            </div>
          )}
          {emptyStock.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 flex items-start gap-3">
              <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0"/>
              <div>
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                  {emptyStock.length} item stok kosong
                </p>
                <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
                  {emptyStock.slice(0,3).map(i=>i.ocsCode).join(', ')}{emptyStock.length>3?` +${emptyStock.length-3} lainnya`:''}
                </p>
              </div>
            </div>
          )}
          {underReserve.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-3">
              <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0"/>
              <div>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                  {underReserve.length} item under reserve
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                  {underReserve.slice(0,3).map(i=>i.ocsCode).join(', ')}{underReserve.length>3?` +${underReserve.length-3} lainnya`:''}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari OCS Code, SAP Code, atau nama produk…"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>

        {/* Summary */}
        <p className="text-xs text-muted">{filtered.length} dari {items.length} item</p>

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
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">OCS Code</th>
                    {hasSapCode && <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">SAP Code</th>}
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">Nama Produk</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">Qty Rack</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">Qty SAP</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">On Hand</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">On Order</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">Available</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">Reserve</th>
                    {hasUnderRes && <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">Under Res.</th>}
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]">
                  {filtered.map((item, i) => {
                    const isMinus  = item.qtyOnHand < 0;
                    const isEmpty  = item.qtyOnHand === 0;
                    const isUnder  = item.isUnderReserve === 'Ya';
                    const rowCls   = isMinus  ? 'bg-purple-50/60 dark:bg-purple-900/10'
                                   : isEmpty  ? 'bg-red-50/40 dark:bg-red-900/5'
                                   : isUnder  ? 'bg-amber-50/40 dark:bg-amber-900/5'
                                   : '';
                    const onHandCls = isMinus  ? 'text-purple-700 dark:text-purple-400'
                                    : isEmpty  ? 'text-red-600 dark:text-red-400'
                                    : 'text-green-700 dark:text-green-400';
                    return (
                      <tr key={i} className={cn('hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors', rowCls)}>
                        <td className="px-4 py-2.5 font-mono text-xs font-medium text-blue-700 dark:text-blue-400 whitespace-nowrap">{item.ocsCode}</td>
                        {hasSapCode && <td className="px-4 py-2.5 font-mono text-xs text-muted whitespace-nowrap">{item.sapCode || '—'}</td>}
                        <td className="px-4 py-2.5 max-w-[260px] truncate" title={item.skuName}>{item.skuName}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{item.qtyRack.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{item.qtySap.toLocaleString()}</td>
                        <td className={cn('px-4 py-2.5 text-right font-bold tabular-nums', onHandCls)}>
                          {item.qtyOnHand.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right text-blue-600 dark:text-blue-400 tabular-nums">{item.qtyOnOrder.toLocaleString()}</td>
                        <td className={cn('px-4 py-2.5 text-right font-semibold tabular-nums',
                          item.availableQty <= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')}>
                          {item.availableQty.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted">{item.reserveQty.toLocaleString()}</td>
                        {hasUnderRes && (
                          <td className="px-4 py-2.5 text-center">
                            {isUnder
                              ? <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Ya</span>
                              : <span className="text-xs text-muted">—</span>
                            }
                          </td>
                        )}
                        <td className="px-4 py-2.5">
                          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap',
                            item.status === 'Aktif'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400')}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && !loading && (
                <div className="text-center py-10 text-sm text-muted">
                  {items.length === 0
                    ? 'Belum ada data stock. Upload file Stock View dari OCS.'
                    : 'Tidak ada hasil pencarian.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
