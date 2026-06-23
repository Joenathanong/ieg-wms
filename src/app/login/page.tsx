'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Warehouse, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '@/lib/firebase/client';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

const SHIFTS = ['Shift 1', 'Shift 2', 'Shift 3', 'Non Shift'];

function LoginForm() {
  const { appUser } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const shiftChange = params.get('reason') === 'shift_change';

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [shift,    setShift]    = useState('Shift 1');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => { if (appUser) router.replace('/dashboard'); }, [appUser, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));

      if (!snap.exists()) throw new Error('Akun tidak ditemukan di sistem. Hubungi admin.');
      const userData = snap.data();
      // active field: boolean false = nonaktif; undefined/missing = dianggap aktif
      if (userData.active === false) throw new Error('Akun tidak aktif. Hubungi admin.');

      // Cache shift logout times from Firestore
      const shiftSnap = await getDoc(doc(db, 'settings', 'shifts'));
      if (shiftSnap.exists()) {
        const times = (shiftSnap.data().shifts as {logoutTime:string}[])
          .map(s => s.logoutTime);
        localStorage.setItem('shift_logout_times', JSON.stringify(times));
      }

      // Store current shift in session
      localStorage.setItem('current_shift', shift);

      // Create server-side session cookie
      const idToken = await cred.user.getIdToken();
      const sessionRes = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (!sessionRes.ok) {
        const errData = await sessionRes.json().catch(() => ({}));
        throw new Error(errData.error ?? 'Gagal membuat sesi. Periksa konfigurasi Firebase Admin.');
      }

      // Full page reload agar cookie wms_session pasti tersimpan sebelum middleware dicek
      window.location.href = '/dashboard';
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login gagal';
      toast.error(msg.includes('auth/') ? 'Email atau password salah.' : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[rgb(var(--bg))] p-4">
      {/* Theme toggle – top right */}
      <div className="fixed top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-brand-600 p-3 rounded-2xl mb-3">
            <Warehouse size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[rgb(var(--text))]">WMS IEG</h1>
          <p className="text-sm text-muted mt-1">Warehouse Management System</p>
          {shiftChange && (
            <div className="mt-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-xs text-amber-700 dark:text-amber-300 text-center">
              Sesi berakhir karena pergantian shift. Silakan login kembali.
            </div>
          )}
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[rgb(var(--text))] mb-1">Email</label>
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--text))] focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
              placeholder="nama@perusahaan.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[rgb(var(--text))] mb-1">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'} required value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 pr-10 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--text))] focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
                {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[rgb(var(--text))] mb-1">Shift Saat Ini</label>
            <select value={shift} onChange={e => setShift(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--text))] focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm">
              {SHIFTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm transition-colors disabled:opacity-60">
            {loading ? 'Memproses…' : 'Login'}
          </button>
        </form>

        <p className="text-center text-xs text-muted mt-6">
          Hubungi admin jika tidak dapat login.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
