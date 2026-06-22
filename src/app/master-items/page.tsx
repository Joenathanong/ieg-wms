'use client';
import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Plus, Search, Pencil, Trash2, X, Save } from 'lucide-react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { cn } from '@/lib/utils/cn';
import toast from 'react-hot-toast';
import type { MasterItem } from '@/types';

const EMPTY: Omit<MasterItem,'id'|'createdAt'|'updatedAt'> = {
  ocsCode: '', sap1: '', sap2: '', name: '', category: '', active: true,
};

export default function MasterItemsPage() {
  const [items,    setItems]    = useState<MasterItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState<MasterItem | null>(null);
  const [form,     setForm]     = useState({ ...EMPTY });
  const [saving,   setSaving]   = useState(false);

  const fetchItems = async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'master_items'));
    setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as MasterItem)));
    setLoading(false);
  };

  useEffect(() => { fetchItems(); }, []);

  const openNew = () => { setEditing(null); setForm({ ...EMPTY }); setShowForm(true); };
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

  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    return !q || i.ocsCode.toLowerCase().includes(q) || i.sap1.includes(q) || (i.sap2 ?? '').includes(q) || i.name.toLowerCase().includes(q);
  });

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-[rgb(var(--text))]">Master Item</h1>
          <button onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium">
            <Plus size={15} /> Tambah Item
          </button>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari OCS Code, SAP, atau nama…"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>

        {/* Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-[rgb(var(--bg))] rounded-2xl border border-[rgb(var(--border))] w-full max-w-md shadow-2xl">
              <div className="flex items-center justify-between p-5 border-b border-[rgb(var(--border))]">
                <h2 className="font-semibold">{editing ? 'Edit Item' : 'Tambah Item'}</h2>
                <button onClick={() => setShowForm(false)}><X size={18}/></button>
              </div>
              <div className="p-5 space-y-3">
                {[
                  { label:'OCS Code *', key:'ocsCode', ph:'FYNE-EXTRAIT-AMBER-WOOD' },
                  { label:'SAP Code 1 *', key:'sap1', ph:'1207050305' },
                  { label:'SAP Code 2 (opsional)', key:'sap2', ph:'1227050305' },
                  { label:'Nama Produk *', key:'name', ph:'Fyne Extrait de Parfum Amberwood' },
                  { label:'Kategori', key:'category', ph:'Parfum' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">{f.label}</label>
                    <input value={(form as Record<string,string>)[f.key]} onChange={e => setForm(prev => ({...prev, [f.key]: e.target.value}))}
                      placeholder={f.ph}
                      className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                  </div>
                ))}
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={e => setForm(p=>({...p,active:e.target.checked}))} className="rounded" />
                  Aktif
                </label>
              </div>
              <div className="flex gap-3 p-5 border-t border-[rgb(var(--border))]">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-lg border border-[rgb(var(--border))] text-sm hover:bg-slate-50 dark:hover:bg-slate-800">Batal</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  <Save size={14}/> {saving ? 'Menyimpan…' : 'Simpan'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-[rgb(var(--surface))] rounded-xl border border-[rgb(var(--border))] overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-7 w-7 border-2 border-brand-600 border-t-transparent" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>{['OCS Code','SAP Code 1','SAP Code 2','Nama Produk','Kategori','Status','Aksi'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]">
                  {filtered.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-2.5 font-mono text-xs font-medium">{item.ocsCode}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{item.sap1}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted">{item.sap2 || '—'}</td>
                      <td className="px-4 py-2.5 max-w-[200px] truncate">{item.name}</td>
                      <td className="px-4 py-2.5 text-muted">{item.category || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', item.active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-slate-100 text-slate-500')}>
                          {item.active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(item)} className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600"><Pencil size={14}/></button>
                          <button onClick={() => handleDelete(item)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"><Trash2 size={14}/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <div className="text-center py-10 text-sm text-muted">Belum ada data master item.</div>}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
