import { Lock } from 'lucide-react';
import prisma from '@/lib/prisma';
import { getSetting, isTrue, PDT_MODULE_SETTING } from '@/lib/settings';

/**
 * Guard per T-Code PDT.
 * Modul bisa dinyalakan/dimatikan ADMIN di ZSET tanpa perlu login ulang,
 * karena pemeriksaannya dilakukan di server saat halaman dirender.
 */
export async function PdtModuleGuard({
  code,
  title,
  children,
}: {
  code: keyof typeof PDT_MODULE_SETTING | string;
  title: string;
  children: React.ReactNode;
}) {
  const key = PDT_MODULE_SETTING[code];
  let enabled = true;
  let masterOn = true;

  try {
    masterOn = await isTrue(prisma, 'PDT_ENABLED');
    enabled = key ? (await getSetting(prisma, key)) === '1' : true;
  } catch {
    // database belum siap — biarkan halaman tampil dan gagal di level API
    return <>{children}</>;
  }

  if (!masterOn || !enabled) {
    return (
      <div className="mx-auto w-full max-w-[520px] sap-panel overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 bg-sap-titlebar border-b border-sap-border">
          <span className="font-mono text-sap-blue text-sm">{code}</span>
          <span className="text-sap-border">|</span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="p-4 flex items-start gap-3">
          <Lock size={20} className="text-sap-errtext shrink-0 mt-0.5" />
          <div className="text-2xs leading-relaxed">
            <p className="text-sap-errtext font-semibold mb-1">Transaction is locked</p>
            <p className="text-sap-muted">
              {!masterOn
                ? 'Seluruh modul PDT sedang dinonaktifkan oleh administrator.'
                : `T-Code ${code} sedang dinonaktifkan oleh administrator.`}{' '}
              Hubungi admin untuk mengaktifkannya kembali lewat transaksi <b className="text-sap-blue">ZSET</b>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
