'use client';
import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Save, Plus, Trash2 } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import toast from 'react-hot-toast';
import type { ShiftSettings } from '@/types';

const DEFAULT_SETTINGS: ShiftSettings = {
  numShifts: 2,
  shifts: [
    { name: 'Shift 1', logoutTime: '15:30' },
    { name: 'Shift 2', logoutTime: '23:00' },
  ],
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<ShiftSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'shifts'));
        if (snap.exists()) setSettings(snap.data() as ShiftSettings);
      } catch { /* use defaults */ }
      finally { setLoading(false); }
    };
    fetchSettings();
  }, []);

  const updateShiftName = (i: number, value: string) =>
    setSettings(s => ({ ...s, shifts: s.shifts.map((sh, idx) => idx === i ? { ...sh, name: value } : sh) }));

  const updateShiftTime = (i: number, value: string) =>
    setSettings(s => ({ ...s, shifts: s.shifts.map((sh, idx) => idx === i ? { ...sh, logoutTime: value } : sh) }));

  const addShift = () => {
    if (settings.shifts.length >= 4) { toast.error('Maksimal 4 shift'); return; }
    setSettings(s => ({
      ...s,
      numShifts: s.numShifts + 1,
      shifts: [...s.shifts, { name: `Shift ${s.shifts.length + 1}`, logoutTime: '07:00' }],
    }));
  };

  const removeShift = (i: number) => {
    if (settings.shifts.length <= 1) { toast.error('Minimal 1 shift'); return; }
    setSettings(s => ({ ...s, numShifts: s.numShifts - 1, shifts: s.shifts.filter((_, idx) => idx !== i) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = { ...settings, numShifts: settings.shifts.length };
      await setDoc(doc(db, 'settings', 'shifts'), data);
      // Update localStorage for all clients (they'll pick it up on next login)
      localStorage.setItem('shift_logout_times', JSON.stringify(data.shifts.map((s: { logoutTime: string }) => s.logoutTime)));
      toast.success('Pengaturan shift disimpan');
    } catch { toast.error('Gagal menyimpan'); }
    finally { setSaving(false); }
  };

  return (
    <AppShell>
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="text-xl font-bold text-[rgb(var(--text))]">Pengaturan</h1>

        <div className="bg-[rgb(var(--surface))] rounded-2xl border border-[rgb(var(--border))] overflow-hidden">
          <div className="p-5 border-b border-[rgb(var(--border))]">
            <h2 className="font-semibold text-[rgb(var(--text))]">Konfigurasi Shift</h2>
            <p className="text-xs text-muted mt-1">
              Atur jumlah shift dan waktu auto-logout untuk Operator Inbound. Waktu auto-logout akan memaksa logout pada jam yang ditentukan.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-brand-600 border-t-transparent"/>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <div className="space-y-3">
                {settings.shifts.map((shift, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-muted mb-1">Nama Shift {i+1}</label>
                      <input value={shift.name} onChange={e => updateShiftName(i, e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    </div>
                    <div className="w-36">
                      <label className="block text-xs font-medium text-muted mb-1">Jam Auto-Logout</label>
                      <input type="time" value={shift.logoutTime} onChange={e => updateShiftTime(i, e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                    </div>
                    <button onClick={() => removeShift(i)}
                      className="mt-5 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 hover:text-red-600">
                      <Trash2 size={16}/>
                    </button>
                  </div>
                ))}
              </div>

              <button onClick={addShift}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[rgb(var(--border))] text-sm text-muted hover:border-brand-400 hover:text-brand-600 transition-colors w-full justify-center">
                <Plus size={14}/> Tambah Shift
              </button>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
                <p className="text-xs text-blue-700 dark:text-blue-400">
                  <b>Info:</b> Operator Inbound akan otomatis logout pada jam yang ditentukan. User Admin dan Supervisor tidak terpengaruh auto-logout. Perubahan berlaku pada sesi login berikutnya.
                </p>
              </div>
            </div>
          )}

          <div className="p-5 border-t border-[rgb(var(--border))]">
            <button onClick={handleSave} disabled={saving || loading}
              className="flex items-center gap-2 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-60">
              <Save size={15}/> {saving ? 'Menyimpan…' : 'Simpan Perubahan'}
            </button>
          </div>
        </div>

        {/* Shift preview */}
        <div className="bg-[rgb(var(--surface))] rounded-2xl border border-[rgb(var(--border))] p-5">
          <h2 className="font-semibold text-[rgb(var(--text))] mb-3">Preview Jadwal Shift</h2>
          <div className="space-y-2">
            {settings.shifts.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="text-xs bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 px-2.5 py-1 rounded-full font-mono">
                  Auto-logout {s.logoutTime} WIB
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
