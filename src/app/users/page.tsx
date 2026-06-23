'use client';
import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Plus, Pencil, X, Save, UserCheck, UserX } from 'lucide-react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils/cn';
import type { AppUser, UserRole } from '@/types';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'admin',            label: 'Admin' },
  { value: 'supervisor',       label: 'Supervisor' },
  { value: 'operator_inbound', label: 'Operator Inbound' },
];

const EMPTY = { name: '', email: '', role: 'operator_inbound' as UserRole, active: true };

export default function UsersPage() {
  const [users,    setUsers]    = useState<AppUser[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState<AppUser | null>(null);
  const [form,     setForm]     = useState({ ...EMPTY });
  const [password, setPassword] = useState('');
  const [saving,   setSaving]   = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    const snap = await getDocs(collection(db, 'users'));
    setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)));
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const openNew  = () => { setEditing(null); setForm({ ...EMPTY }); setPassword(''); setShowForm(true); };
  const openEdit = (u: AppUser) => { setEditing(u); setForm({ name:u.name, email:u.email, role:u.role, active:u.active }); setPassword(''); setShowForm(true); };

  const handleSave = async () => {
    if (!form.name || !form.email) { toast.error('Nama dan email wajib diisi'); return; }
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db, 'users', editing.uid), { ...form });
        toast.success('User diperbarui');
      } else {
        // Create via server action (needs Firebase Admin to create auth user)
        if (!password || password.length < 6) { toast.error('Password minimal 6 karakter'); setSaving(false); return; }
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        toast.success('User dibuat');
      }
      setShowForm(false);
      await fetchUsers();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan');
    } finally { setSaving(false); }
  };

  const toggleActive = async (u: AppUser) => {
    await updateDoc(doc(db, 'users', u.uid), { active: !u.active });
    setUsers(prev => prev.map(x => x.uid === u.uid ? { ...x, active: !u.active } : x));
    toast.success(`User ${!u.active ? 'diaktifkan' : 'dinonaktifkan'}`);
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-[rgb(var(--text))]">User Management</h1>
          <button onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium">
            <Plus size={15}/> Tambah User
          </button>
        </div>

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-[rgb(var(--bg))] rounded-2xl border border-[rgb(var(--border))] w-full max-w-md shadow-2xl">
              <div className="flex items-center justify-between p-5 border-b border-[rgb(var(--border))]">
                <h2 className="font-semibold">{editing ? 'Edit User' : 'Tambah User'}</h2>
                <button onClick={() => setShowForm(false)}><X size={18}/></button>
              </div>
              <div className="p-5 space-y-3">
                {[{label:'Nama Lengkap *',key:'name',ph:'John Doe',type:'text'},{label:'Email *',key:'email',ph:'john@perusahaan.com',type:'email'}].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">{f.label}</label>
                    <input type={f.type} value={(form as unknown as Record<string,string>)[f.key]} onChange={e => setForm(p=>({...p,[f.key]:e.target.value}))}
                      placeholder={f.ph} disabled={!!editing && f.key==='email'}
                      className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50" />
                  </div>
                ))}
                {!editing && (
                  <div>
                    <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">Password *</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 6 karakter"
                      className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">Role *</label>
                  <select value={form.role} onChange={e => setForm(p=>({...p,role:e.target.value as UserRole}))}
                    className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={e => setForm(p=>({...p,active:e.target.checked}))} />
                  Aktif
                </label>
              </div>
              <div className="flex gap-3 p-5 border-t border-[rgb(var(--border))]">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-lg border border-[rgb(var(--border))] text-sm">Batal</button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  <Save size={14}/> {saving ? 'Menyimpan…' : 'Simpan'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-[rgb(var(--surface))] rounded-xl border border-[rgb(var(--border))] overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-7 w-7 border-2 border-brand-600 border-t-transparent"/></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/50">
                  <tr>{['Nama','Email','Role','Status','Aksi'].map(h=>(
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wide">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border))]">
                  {users.map(u => (
                    <tr key={u.uid} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-2.5 font-medium">{u.name}</td>
                      <td className="px-4 py-2.5 text-muted">{u.email}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">
                          {ROLES.find(r=>r.value===u.role)?.label ?? u.role}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                          u.active?'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400':'bg-slate-100 text-slate-500')}>
                          {u.active?'Aktif':'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <button onClick={()=>openEdit(u)} className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600"><Pencil size={14}/></button>
                          <button onClick={()=>toggleActive(u)} className={cn('p-1.5 rounded-lg', u.active?'hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-500':'hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600')}>
                            {u.active?<UserX size={14}/>:<UserCheck size={14}/>}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length===0&&<div className="text-center py-10 text-sm text-muted">Belum ada user.</div>}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
