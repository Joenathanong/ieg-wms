import Link from 'next/link';
import { PackagePlus, PackageMinus, PackageCheck, ArrowLeftRight, ClipboardList, Search, Smartphone, Lock, Layers } from 'lucide-react';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getSettings, PDT_MODULE_SETTING } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const MENU = [
  { code: 'ZRF01', label: 'Goods Receipt', desc: 'Terima barang (101) ke GR zone', href: '/zrf/gr', Icon: PackagePlus },
  { code: 'ZRF02', label: 'Put-away', desc: 'Simpan dari GR zone ke rak', href: '/zrf/putaway', Icon: PackageCheck },
  { code: 'ZRF03', label: 'Picking', desc: 'Ambil dari rak untuk pengeluaran', href: '/zrf/pick', Icon: PackageCheck },
  { code: 'ZRF04', label: 'Bin Transfer', desc: 'Pindah antar rak (301)', href: '/zrf/transfer', Icon: ArrowLeftRight },
  { code: 'ZRF08', label: 'Replenishment', desc: 'Isi ulang fix bin — list FEFO (301)', href: '/zrf/replenish', Icon: Layers },
  { code: 'ZRF05', label: 'Stock Count', desc: 'Input hasil stock opname', href: '/zrf/count', Icon: ClipboardList },
  { code: 'ZRF07', label: 'Goods Issue', desc: 'Keluarkan barang dari transit-out (201)', href: '/zrf/gi', Icon: PackageMinus },
  { code: 'ZRF06', label: 'Inquiry', desc: 'Cek isi rak / lokasi material', href: '/zrf/inquiry', Icon: Search },
];

async function loadSettings() {
  try {
    return await getSettings(prisma);
  } catch {
    return null;
  }
}

async function loadCounts() {
  try {
    const [putaway, pick, piDocs] = await Promise.all([
      prisma.transferReq.count({ where: { tr_type: 'PUTAWAY', status: { in: ['OPEN', 'PARTIAL'] } } }),
      prisma.transferReq.count({ where: { tr_type: 'PICK', status: { in: ['OPEN', 'PARTIAL'] } } }),
      prisma.physInvDoc.count({ where: { status: { in: ['FROZEN', 'COUNTED'] } } }),
    ]);
    return { putaway, pick, piDocs };
  } catch {
    return null;
  }
}

export default async function ZrfMenu() {
  const counts = await loadCounts();
  const settings = await loadSettings();
  const session = await getSession();

  // pembatasan per user dari role otorisasi (PFCG):
  // hanya T-Code ZRF yang tercantum di role yang ditampilkan.
  const menu = MENU.filter(
    (m) =>
      !session?.tcodes ||
      session.role === 'ADMIN' ||
      session.tcodes.includes(m.code)
  );

  const isOn = (code: string) => {
    if (!settings) return true;
    if (settings.PDT_ENABLED !== '1') return false;
    const key = PDT_MODULE_SETTING[code];
    return key ? settings[key] === '1' : true;
  };

  const badge = (code: string) => {
    if (!counts) return null;
    if (code === 'ZRF02' && counts.putaway > 0) return counts.putaway;
    if (code === 'ZRF03' && counts.pick > 0) return counts.pick;
    if (code === 'ZRF05' && counts.piDocs > 0) return counts.piDocs;
    return null;
  };

  return (
    <div className="mx-auto w-full max-w-[520px] space-y-3">
      <div className="sap-panel px-3 py-3 flex items-center gap-2.5">
        <Smartphone size={20} className="text-sap-blue" />
        <div>
          <h1 className="text-sm font-semibold">ZRF — PDT Terminal</h1>
          <p className="text-xxs text-sap-muted font-mono">Menu operator gudang</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {menu.map((m) => {
          const n = badge(m.code);
          const on = isOn(m.code);

          const inner = (
            <>
              <div
                className={`w-10 h-10 rounded-[3px] flex items-center justify-center shrink-0 border
                  ${on ? 'bg-sap-blue/15 border-sap-blue/40' : 'bg-sap-neutralbg border-sap-border'}`}
              >
                <m.Icon size={19} className={on ? 'text-sap-blue' : 'text-sap-muted'} />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${on ? '' : 'text-sap-muted'}`}>
                  <span className={`font-mono mr-2 ${on ? 'text-sap-blue' : 'text-sap-muted'}`}>{m.code}</span>
                  {m.label}
                </p>
                <p className="text-xxs text-sap-muted truncate">{on ? m.desc : 'Dinonaktifkan administrator (ZSET)'}</p>
              </div>
              {on && n !== null && (
                <span className="shrink-0 min-w-[26px] text-center px-2 py-1 rounded-full bg-sap-warntext/20 border border-sap-warnborder text-sap-warntext text-2xs font-mono font-bold">
                  {n}
                </span>
              )}
              {!on && <Lock size={16} className="text-sap-muted shrink-0" />}
            </>
          );

          return on ? (
            <Link
              key={m.code}
              href={m.href}
              className="sap-panel flex items-center gap-3 px-3 py-3 hover:border-sap-blue/60 transition-colors"
            >
              {inner}
            </Link>
          ) : (
            <div
              key={m.code}
              className="sap-panel flex items-center gap-3 px-3 py-3 opacity-60 cursor-not-allowed"
            >
              {inner}
            </div>
          );
        })}
      </div>

      <p className="text-xxs text-sap-muted/60 text-center">
        Semua posting dari layar ini ditandai <b>via PDT</b> di riwayat dokumen (MB51).
      </p>
    </div>
  );
}
