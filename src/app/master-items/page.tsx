'use client';
import { useState, useEffect, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import {
  Plus, Search, Pencil, Trash2, X, Save,
  Upload, FileDown, CheckCircle2, AlertCircle, RefreshCw,
} from 'lucide-react';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { cn } from '@/lib/utils/cn';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import type { MasterItem } from '@/types';

/* ─── constants ─────────────────────────────────────────── */
const EMPTY: Omit<MasterItem, 'id' | 'createdAt' | 'updatedAt'> = {
  ocsCode: '', sap1: '', sap2: '', name: '', category: '', active: true,
};

const TEMPLATE_HEADERS = ['OCS Code *', 'SAP Code 1 *', 'SAP Code 2', 'Nama Produk *', 'Kategori', 'Status (Aktif/Nonaktif)'];

/* ─── helpers ───────────────────────────────────────────── */
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

/* ─── types ─────────────────────────────────────────────── */
interface UploadRow {
  ocsCode: string; sap1: string; sap2: string;
  name: string; category: string; active: boolean;
}

interface UploadResult {
  status: 'added' | 'updated' | 'error';
  ocsCode: string;
  name: string;
  prevUpdatedAt?: string; // for 'updated'
  error?: string;         // for 'error'
}

/* ═══════════════════════════════════════════════════════════
   PAGE
══════════════════════════════════════════════════════════════ */
export default function MasterItemsPage() {
  const [items,      setItems]      = useState<MasterItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState<MasterItem | null>(null);
  const [form,       setForm]       = useState({ ...EMPTY });
  const [saving,     setSaving]     = useState(false);

  // upload states
  const [showUpload,    setShowUpload]    = useState(false);
  const [uploadFile,    setUploadFile]    = useState<File | null>(null);
  const [uploading,     setUploading]     = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── fetch ─────────────────────────────────────────────── */
  const fetchItems = async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'master_items'));
    setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as MasterItem)));
    setLoading(false);
  };

  useEffect(() => { fetchItems(); }, []);

  /* ── single-item form ──────────────────────────────────── */
  const openNew  = () => { setEditing(null); setForm({ ...EMPTY }); setShowForm(true); };
  const openEdit = (item: MasterItem) => {
    setEditing(item);
    setForm({ ocsCode: item.ocsCode, sap1: item.sap1, sap2: item.sap2 ?? '', name: item.name, category: item.category ?? '', active: item.active });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.ocsCode || !form.sap1 || !form.name) { toast.error('OCS Code, SAP1, dan Nama wajib diisi'); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (editing) {
        await updateDoc(doc(db, 'master_items', editing.id), { ...form, updatedAt: now });
        toast.success('Item diperbarui');
      } else {
        await addDoc(collection(db, 'master_items'), { ...form, createdAt: now, updatedAt: now });
        toast.success('Item ditambahkan');
      }
      setShowForm(false);
      await fetchItems();
    } catch { toast.error('Gagal menyimpan'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (item: MasterItem) => {
    if (!confirm(`Hapus "${item.name}"?`)) return;
    await deleteDoc(doc(db, 'master_items', item.id));
    toast.success('Item dihapus');
    setItems(prev => prev.filter(i => i.id !== item.id));
  };

  /* ── download template ─────────────────────────────────── */
  const downloadTemplate = () => {
    const example: Record<string, string>[] = [
      {
        'OCS Code *':             'FYNE-EXTRAIT-AMBER-WOOD',
        'SAP Code 1 *':           '1207050305',
        'SAP Code 2':             '1227050305',
        'Nama Produk *':          'Fyne Extrait de Parfum Amberwood',
        'Kategori':               'Parfum',
        'Status (Aktif/Nonaktif)':'Aktif',
      },
      {
        'OCS Code *':             'HANASUI-BRIGHTENING-SERUM',
        'SAP Code 1 *':           '1208010203',
        'SAP Code 2':             '',
        'Nama Produk *':          'Hanasui Brightening Serum',
        'Kategori':               'Skincare',
        'Status (Aktif/Nonaktif)':'Aktif',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(example, { header: TEMPLATE_HEADERS });

    // column widths
    ws['!cols'] = [
      { wch: 30 }, { wch: 16 }, { wch: 16 },
      { wch: 40 }, { wch: 16 }, { wch: 22 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master Item');
    XLSX.writeFile(wb, 'template_master_item.xlsx');
  };

  /* ── parse uploaded xlsx ───────────────────────────────── */
  const parseXlsx = (file: File): Promise<UploadRow[]> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const wb   = XLSX.read(data, { type: 'array' });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
          const parsed: UploadRow[] = rows.map(r => ({
            ocsCode:  String(r['OCS Code *']              ?? r['OCS Code']              ?? '').trim(),
            sap1:     String(r['SAP Code 1 *']            ?? r['SAP Code 1']            ?? '').trim(),
            sap2:     String(r['SAP Code 2']              ?? '').trim(),
            name:     String(r['Nama Produk *']           ?? r['Nama Produk']           ?? '').trim(),
            category: String(r['Kategori']                ?? '').trim(),
            active:   String(r['Status (Aktif/Nonaktif)'] ?? 'Aktif').trim().toLowerCase() !== 'nonaktif',
          }));
          resolve(parsed.filter(r => r.ocsCode && r.sap1 && r.name));
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });

  /* ── bulk upload to Firestore ──────────────────────────── */
  const handleBulkUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);

    try {
      const rows   = await parseXlsx(uploadFile);
      if (rows.length === 0) { toast.error('Tidak ada data valid di file'); setUploading(false); return; }

      // build lookup map: ocsCode → existing Firestore doc
      const snap    = await getDocs(collection(db, 'master_items'));
      const existing = new Map<string, MasterItem>();
      snap.docs.forEach(d => {
        const data = d.data() as Omit<MasterItem, 'id'>;
        existing.set(data.ocsCode.toLowerCase(), { id: d.id, ...data });
      });

      const results: UploadResult[] = [];
      const now = new Date().toISOString();

      for (const row of rows) {
        const key   = row.ocsCode.toLowerCase();
        const match = existing.get(key);

        try {
          if (match) {
            // UPDATE — replace existing, remember old updatedAt
            await updateDoc(doc(db, 'master_items', match.id), {
              ...row,
              createdAt: match.createdAt,
              updatedAt: now,
            });
            results.push({
              status: 'updated',
              ocsCode: row.ocsCode,
              name: row.name,
              prevUpdatedAt: match.updatedAt,
            });
          } else {
            // ADD — new document
            await addDoc(collection(db, 'master_items'), {
              ...row,
              createdAt: now,
              updatedAt: now,
            });
            results.push({ status: 'added', ocsCode: row.ocsCode, name: row.name });
          }
        } catch (err: unknown) {
          results.push({
            status: 'error',
            ocsCode: row.ocsCode,
            name: row.name,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      setUploadResults(results);
      await fetchItems();

    } catch { toast.error('Gagal membaca file. Pastikan format .xlsx benar.'); }
    finally { setUploading(false); }
  };

  /* ── open upload modal / reset ─────────────────────────── */
  const openUpload = () => {
    setUploadFile(null);
    setUploadResults(null);
    setShowUpload(true);
  };
  const closeUpload = () => {
    setShowUpload(false);
    setUploadFile(null);
    setUploadResults(null);
  };

  /* ── filter ────────────────────────────────────────────── */
  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    return !q
      || i.ocsCode.toLowerCase().includes(q)
      || i.sap1.includes(q)
      || (i.sap2 ?? '').includes(q)
      || i.name.toLowerCase().includes(q);
  });

  const addedCount   = uploadResults?.filter(r => r.status === 'added').length   ?? 0;
  const updatedCount = uploadResults?.filter(r => r.status === 'updated').length ?? 0;
  const errorCount   = uploadResults?.filter(r => r.status === 'error').length   ?? 0;

  /* ═══════════════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════════════ */
  return (
    <AppShell>
      <div className="space-y-4">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-[rgb(var(--text))]">Master Item</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={downloadTemplate}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-sm hover:bg-slate-50 dark:hover:bg-slate-800 text-[rgb(var(--text))]">
              <FileDown size={15} className="text-green-600" /> Template
            </button>
            <button onClick={openUpload}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-sm hover:bg-blue-100 dark:hover:bg-blue-900/40">
              <Upload size={15} /> Upload Excel
            </button>
            <button onClick={openNew}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium">
              <Plus size={15} /> Tambah Item
            </button>
          </div>
        </div>

        {/* ── Search ── */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari OCS Code, SAP, atau nama…"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>

        {/* ══════════════════════════════════════════════════
            MODAL — Single-item form
        ══════════════════════════════════════════════════ */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-[rgb(var(--bg))] rounded-2xl border border-[rgb(var(--border))] w-full max-w-md shadow-2xl">
              <div className="flex items-center justify-between p-5 border-b border-[rgb(var(--border))]">
                <h2 className="font-semibold">{editing ? 'Edit Item' : 'Tambah Item'}</h2>
                <button onClick={() => setShowForm(false)}><X size={18}/></button>
              </div>
              <div className="p-5 space-y-3">
                {[
                  { label:'OCS Code *',              key:'ocsCode',  ph:'FYNE-EXTRAIT-AMBER-WOOD' },
                  { label:'SAP Code 1 *',             key:'sap1',     ph:'1207050305' },
                  { label:'SAP Code 2 (opsional)',    key:'sap2',     ph:'1227050305' },
                  { label:'Nama Produk *',            key:'name',     ph:'Fyne Extrait de Parfum Amberwood' },
                  { label:'Kategori',                 key:'category', ph:'Parfum' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">{f.label}</label>
                    <input
                      value={(form as unknown as Record<string, string>)[f.key]}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.ph}
                      className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                ))}
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.active}
                    onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} className="rounded" />
                  Aktif
                </label>
              </div>
              <div className="flex gap-3 p-5 border-t border-[rgb(var(--border))]">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-2 rounded-lg border border-[rgb(var(--border))] text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                  Batal
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  <Save size={14}/> {saving ? 'Menyimpan…' : 'Simpan'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════
            MODAL — Bulk Upload
        ══════════════════════════════════════════════════ */}
        {showUpload && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-[rgb(var(--bg))] rounded-2xl border border-[rgb(var(--border))] w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">

              {/* header */}
              <div className="flex items-center justify-between p-5 border-b border-[rgb(var(--border))] shrink-0">
                <div>
                  <h2 className="font-semibold text-[rgb(var(--text))]">Upload Master Item (Excel)</h2>
                  <p className="text-xs text-muted mt-0.5">
                    Gunakan template agar kolom sesuai. Item dengan OCS Code sama akan diganti (replace).
                  </p>
                </div>
                <button onClick={closeUpload}><X size={18}/></button>
              </div>

              {/* body */}
              <div className="p-5 space-y-4 overflow-y-auto flex-1">

                {/* hasil upload */}
                {uploadResults ? (
                  <div className="space-y-3">
                    {/* summary chips */}
                    <div className="flex gap-3 flex-wrap">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 rounded-lg text-green-700 dark:text-green-400 text-sm font-medium">
                        <CheckCircle2 size={14}/> {addedCount} ditambahkan
                      </div>
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-700 dark:text-blue-400 text-sm font-medium">
                        <RefreshCw size={14}/> {updatedCount} diperbarui
                      </div>
                      {errorCount > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-400 text-sm font-medium">
                          <AlertCircle size={14}/> {errorCount} gagal
                        </div>
                      )}
                    </div>

                    {/* detail list */}
                    <div className="rounded-xl border border-[rgb(var(--border))] overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800/50">
                          <tr>
                            {['OCS Code', 'Nama Produk', 'Status', 'Info'].map(h => (
                              <th key={h} className="text-left px-3 py-2 font-semibold text-muted uppercase tracking-wide">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[rgb(var(--border))]">
                          {uploadResults.map((r, i) => (
                            <tr key={i} className={cn(
                              r.status === 'added'   ? 'bg-green-50/50 dark:bg-green-900/10' :
                              r.status === 'updated' ? 'bg-blue-50/50 dark:bg-blue-900/10'   :
                                                       'bg-red-50/50 dark:bg-red-900/10'
                            )}>
                              <td className="px-3 py-2 font-mono">{r.ocsCode}</td>
                              <td className="px-3 py-2 max-w-[140px] truncate">{r.name}</td>
                              <td className="px-3 py-2">
                                <span className={cn('px-2 py-0.5 rounded-full font-medium text-xs',
                                  r.status === 'added'   ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
                                  r.status === 'updated' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'    :
                                                           'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                                )}>
                                  {r.status === 'added' ? 'Baru' : r.status === 'updated' ? 'Diperbarui' : 'Gagal'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-muted">
                                {r.status === 'updated' && r.prevUpdatedAt
                                  ? <>Sebelumnya: <span className="font-medium text-[rgb(var(--text))]">{fmtDate(r.prevUpdatedAt)}</span></>
                                  : r.status === 'error'
                                  ? <span className="text-red-500">{r.error}</span>
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  /* file picker */
                  <>
                    <div
                      onClick={() => fileRef.current?.click()}
                      className={cn(
                        'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                        uploadFile
                          ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-[rgb(var(--border))] hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10'
                      )}>
                      <Upload size={32} className={cn('mx-auto mb-3', uploadFile ? 'text-blue-500' : 'text-muted')} />
                      {uploadFile ? (
                        <>
                          <p className="font-medium text-blue-700 dark:text-blue-300">{uploadFile.name}</p>
                          <p className="text-xs text-muted mt-1">{(uploadFile.size / 1024).toFixed(1)} KB · Klik untuk ganti file</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-[rgb(var(--text))]">Klik untuk pilih file Excel</p>
                          <p className="text-xs text-muted mt-1">Format .xlsx · Max 5 MB</p>
                        </>
                      )}
                      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                        onChange={e => setUploadFile(e.target.files?.[0] ?? null)} />
                    </div>

                    {/* tips */}
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                      <p className="font-semibold">📋 Format kolom yang diperlukan:</p>
                      <p>OCS Code *, SAP Code 1 *, SAP Code 2, Nama Produk *, Kategori, Status (Aktif/Nonaktif)</p>
                      <p className="mt-1">Kolom bertanda * wajib diisi. Status default = Aktif jika kosong.</p>
                      <p>Item dengan <strong>OCS Code sama</strong> akan otomatis <strong>di-replace</strong>.</p>
                    </div>
                  </>
                )}
              </div>

              {/* footer */}
              <div className="flex gap-3 p-5 border-t border-[rgb(var(--border))] shrink-0">
                {uploadResults ? (
                  <button onClick={closeUpload}
                    className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium">
                    Selesai
                  </button>
                ) : (
                  <>
                    <button onClick={closeUpload}
                      className="flex-1 py-2 rounded-lg border border-[rgb(var(--border))] text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                      Batal
                    </button>
                    <button onClick={handleBulkUpload} disabled={!uploadFile || uploading}
                      className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                      {uploading
                        ? <><RefreshCw size={14} className="animate-spin"/> Mengupload…</>
                        : <><Upload size={14}/> Upload Sekarang</>}
                    </button>
                  </>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ── Table ── */}
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
                    {['OCS Code', 'SAP Code 1', 'SAP Code 2', 'Nama Produk', 'Kategori', 'Terakhir Diubah', 'Status', 'Aksi'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]">
                  {filtered.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-2.5 font-mono text-xs font-medium">{item.ocsCode}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{item.sap1}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted">{item.sap2 || '—'}</td>
                      <td className="px-4 py-2.5 max-w-[200px] truncate">{item.name}</td>
                      <td className="px-4 py-2.5 text-muted">{item.category || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">
                        {item.updatedAt ? fmtDate(item.updatedAt) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                          item.active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400')}>
                          {item.active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(item)}
                            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600">
                            <Pencil size={14}/>
                          </button>
                          <button onClick={() => handleDelete(item)}
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">
                            <Trash2 size={14}/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="text-center py-10 text-sm text-muted">Belum ada data master item.</div>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-muted">{filtered.length} dari {items.length} item</p>
      </div>
    </AppShell>
  );
}
