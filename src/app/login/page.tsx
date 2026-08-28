'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Boxes, KeyRound, User, Loader2, ShieldAlert, Building2 } from 'lucide-react';
import { post } from '@/lib/client';
import { IS_PROD_SYSTEM, SAP_CLIENT, SAP_ENV, SAP_SYSTEM } from '@/lib/system';

/** Keterangan jenis lingkungan untuk client yang dikenal sistem ini. */
const ENV_LABEL = IS_PROD_SYSTEM ? 'PRODUCTION' : SAP_ENV === 'QAS' ? 'QUALITY' : 'DEVELOPMENT';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();

  /**
   * Client (mandant) diisi lebih dulu dengan client yang memang dilayani
   * deployment ini — 300 untuk production, 100 untuk development.
   *
   * Field ini bukan pengaman: pemisahan data yang sebenarnya terjadi di level
   * DATABASE, bukan di sini. Gunanya menahan kekeliruan manusia. Operator yang
   * terbiasa mengetik 300 akan langsung ditolak bila ternyata sedang membuka
   * alamat sistem latihan, alih-alih baru sadar setelah memposting dokumen ke
   * sistem yang keliru.
   */
  const [client, setClient] = useState(SAP_CLIENT);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [caps, setCaps] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const clientOk = client.trim() === SAP_CLIENT;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');

    if (!clientOk) {
      setErr(
        `Client ${client.trim() || '—'} tidak tersedia. Sistem ${SAP_SYSTEM} pada alamat ini hanya melayani client ${SAP_CLIENT}.`
      );
      return;
    }

    setBusy(true);
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
    <form onSubmit={submit} className="w-full sap-panel shadow-sap">
      <div className="sap-panel-title">
        <KeyRound size={13} className="text-sap-blue" />
        <span>SAP Logon</span>
        <span
          className={`ml-auto sap-badge ${
            IS_PROD_SYSTEM
              ? 'border-sap-infoborder bg-sap-infobg text-sap-infotext'
              : 'border-sap-warnborder bg-sap-warnbg text-sap-warntext'
          }`}
        >
          {IS_PROD_SYSTEM ? SAP_SYSTEM : 'NON-PRODUCTION'}
        </span>
      </div>

      <div className="p-5 space-y-3.5">
        <div>
          <label className="sap-field-label sap-required">Client</label>
          <div className="relative">
            <Building2 size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-sap-muted" />
            <input
              className="sap-field pl-7 pr-[104px] font-mono tracking-[0.15em] !text-base sm:!text-2xs"
              value={client}
              onChange={(e) => setClient(e.target.value.replace(/\D/g, '').slice(0, 3))}
              inputMode="numeric"
              autoComplete="off"
              required
            />
            <span
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 sap-badge pointer-events-none ${
                clientOk
                  ? 'border-sap-okborder bg-sap-okbg text-sap-oktext'
                  : 'border-sap-errborder bg-sap-errbg text-sap-errtext'
              }`}
            >
              {clientOk ? ENV_LABEL : 'TIDAK DIKENAL'}
            </span>
          </div>
        </div>

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
              // Caps Lock mudah tertinggal menyala karena field User memang
              // huruf besar semua — penyebab paling sering "password salah".
              onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
              onKeyDown={(e) => setCaps(e.getModifierState('CapsLock'))}
              autoComplete="current-password"
              required
            />
          </div>
          {caps && (
            <p className="mt-1 text-xxs text-sap-warntext">Caps Lock sedang menyala.</p>
          )}
        </div>

        {err && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-sap border border-sap-errborder bg-sap-errbg text-2xs text-sap-errtext">
            <ShieldAlert size={14} className="shrink-0 mt-[1px]" />
            <span>{err}</span>
          </div>
        )}

        <button
          type="submit"
          className="sap-btn sap-btn-primary w-full justify-center !py-2.5 !text-2xs tracking-wide"
          disabled={busy}
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          {busy ? 'Menghubungkan…' : 'Log On'}
        </button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="relative min-h-[100dvh] w-full flex flex-col items-center justify-center bg-sap-bg px-4 py-8 overflow-hidden">
      {/* Latar dekoratif. Memakai warna aksen dengan opasitas rendah supaya
          ikut berubah sendiri saat tema terang/gelap diganti. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-32 w-[440px] h-[440px] rounded-full bg-sap-blue/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-32 w-[480px] h-[480px] rounded-full bg-sap-blue/[0.07] blur-3xl"
      />

      <div className="relative w-full max-w-[380px]">
        <div className="flex items-center gap-3 mb-4">
          <div className="shrink-0 w-11 h-11 rounded-sap border border-sap-blue/30 bg-sap-blue/10 flex items-center justify-center">
            <Boxes size={22} className="text-sap-blue" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-wide leading-tight">WMS LITE</h1>
            <p className="text-2xs text-sap-muted truncate">Warehouse Management System</p>
          </div>
        </div>

        <Suspense
          fallback={
            <div className="w-full h-[340px] sap-panel flex items-center justify-center">
              <Loader2 className="animate-spin text-sap-muted" />
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
