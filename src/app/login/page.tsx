'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Boxes, KeyRound, User, Loader2, ShieldAlert } from 'lucide-react';
import { post } from '@/lib/client';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const r = await post('/api/auth/login', { username, password });
    setBusy(false);
    if (!r.ok) {
      setErr(r.message);
      return;
    }
    const next = sp.get('next') || '/';
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="w-full max-w-[360px] sap-panel shadow-sap">
      <div className="sap-panel-title">
        <KeyRound size={13} className="text-sap-blue" />
        SAP Logon — Client 100
      </div>

      <div className="p-5 space-y-3">
        <div>
          <label className="sap-field-label sap-required">User</label>
          <div className="relative">
            <User size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-sap-muted" />
            <input
              className="sap-field pl-7 uppercase !text-base sm:!text-2xs"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="characters"
              autoComplete="username"
              autoFocus
              required
            />
          </div>
        </div>

        <div>
          <label className="sap-field-label sap-required">Password</label>
          <div className="relative">
            <KeyRound size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-sap-muted" />
            <input
              type="password"
              className="sap-field pl-7 !text-base sm:!text-2xs"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
        </div>

        {err && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-[2px] border border-sap-errborder bg-sap-errbg text-2xs text-sap-errtext">
            <ShieldAlert size={14} className="shrink-0 mt-[1px]" />
            <span>{err}</span>
          </div>
        )}

        <button type="submit" className="sap-btn sap-btn-primary w-full justify-center !py-2" disabled={busy}>
          {busy && <Loader2 size={13} className="animate-spin" />}
          Log On
        </button>

        <p className="text-xxs text-sap-muted/70 leading-relaxed pt-1">
          Login pertama kali: user <span className="font-mono text-sap-blue">ADMIN</span> / password{' '}
          <span className="font-mono text-sap-blue">admin123</span> dibuat otomatis. Segera ubah password
          melalui transaksi SU01.
        </p>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-sap-bg px-4 py-6">
      <div className="flex items-center gap-2 mb-5">
        <Boxes size={26} className="text-sap-blue" />
        <div>
          <h1 className="text-base font-semibold tracking-wide">WMS LITE</h1>
          <p className="text-2xs text-sap-muted font-mono">Warehouse Management — S/4HANA Style</p>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="w-full max-w-[360px] h-[280px] sap-panel flex items-center justify-center">
            <Loader2 className="animate-spin text-sap-muted" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>

      <p className="mt-6 text-xxs text-sap-muted/60 font-mono text-center px-2">
        SAP GUI Theme — Quartz Dark / Morning Horizon · Next.js + Prisma + PostgreSQL
      </p>
    </div>
  );
}
