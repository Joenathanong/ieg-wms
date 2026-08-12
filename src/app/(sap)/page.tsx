import Link from 'next/link';
import {
  Boxes,
  Grid3x3,
  PackageCheck,
  AlertTriangle,
  FileClock,
  ChevronRight,
  Folder,
  FolderOpen,
  ListTodo,
} from 'lucide-react';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { TCODES, canAccessTcode } from '@/lib/tcodes';

export const dynamic = 'force-dynamic';

async function loadKpi() {
  try {
    const [materials, bins, emptyBins, blockedBins, imAgg, docsToday, lowStock, openTr] = await Promise.all([
      prisma.material.count(),
      prisma.storageBin.count(),
      prisma.storageBin.count({ where: { status: 'EMPTY' } }),
      prisma.storageBin.count({ where: { status: 'BLOCKED' } }),
      prisma.stockIM.aggregate({ _sum: { total_qty: true } }),
      prisma.migoLog.count({
        where: { doc_date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      }),
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM materials m
        LEFT JOIN stock_im s ON s.material_code = m.material_code
        WHERE COALESCE(s.total_qty, 0) < m.min_safety_stock AND m.min_safety_stock > 0
      `,
      prisma.transferReq.count({ where: { status: { in: ['OPEN', 'PARTIAL'] } } }),
    ]);
    return {
      online: true,
      materials,
      bins,
      emptyBins,
      blockedBins,
      totalQty: imAgg._sum.total_qty ?? 0,
      docsToday,
      lowStock: Number(lowStock?.[0]?.count ?? 0),
      openTr,
    };
  } catch {
    return null;
  }
}

function Tile({
  label,
  value,
  sub,
  Icon,
  accent = '#367BF5',
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  Icon: typeof Boxes;
  accent?: string;
  href?: string;
}) {
  const inner = (
    <div className="sap-panel p-3 flex items-start gap-3 hover:border-sap-blue/60 transition-colors h-full">
      <div
        className="w-9 h-9 rounded-[3px] flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${accent}22`, border: `1px solid ${accent}55` }}
      >
        <Icon size={17} style={{ color: accent }} />
      </div>
      <div className="min-w-0">
        <p className="text-xxs uppercase tracking-[0.1em] text-sap-muted">{label}</p>
        <p className="font-mono text-lg leading-tight tabular-nums">{value}</p>
        {sub && <p className="text-xxs text-sap-muted/70 truncate">{sub}</p>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function EasyAccess() {
  const session = await getSession();
  const kpi = await loadKpi();

  const groups: { title: string; key: string }[] = [
    { title: 'Transactions (IM)', key: 'TRANSACTION' },
    { title: 'Warehouse (WM)', key: 'WAREHOUSE' },
    { title: 'Reports', key: 'REPORT' },
    { title: 'Master Data', key: 'MASTER' },
    { title: 'PDT Terminal', key: 'PDT' },
    { title: 'Administration', key: 'SYSTEM' },
  ];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="sap-panel px-4 py-3 flex items-center gap-3">
        <Boxes size={22} className="text-sap-blue" />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">SAP Easy Access — WMS Lightweight</h1>
          <p className="text-2xs text-sap-muted font-mono truncate">
            User {session?.username} · {session?.name} · Role {session?.role} ·{' '}
            {new Date().toLocaleDateString('id-ID', { dateStyle: 'full' })}
          </p>
        </div>
      </div>

      {!kpi && (
        <div className="sap-panel px-4 py-3 border-sap-errborder bg-sap-errbg text-2xs text-sap-errtext flex items-center gap-2">
          <AlertTriangle size={15} />
          Database belum terhubung. Isi <span className="font-mono">DATABASE_URL</span> di file{' '}
          <span className="font-mono">.env</span> lalu jalankan{' '}
          <span className="font-mono">npx prisma db push</span>.
        </div>
      )}

      {/* KPI */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
          <Tile label="Total Stock (IM)" value={kpi.totalQty.toLocaleString('de-DE')} Icon={PackageCheck} href="/mb52" />
          <Tile label="Material Master" value={kpi.materials} Icon={Boxes} accent="#8B5CF6" href="/mm01" />
          <Tile label="Storage Bins" value={kpi.bins} sub={`${kpi.blockedBins} blocked`} Icon={Grid3x3} accent="#14B8A6" href="/ls01n" />
          <Tile label="Empty Bins" value={kpi.emptyBins} Icon={Folder} accent="#94A3B8" href="/ls04" />
          <Tile
            label="Open Transfer Req."
            value={kpi.openTr}
            sub="menunggu put-away / picking"
            Icon={ListTodo}
            accent={kpi.openTr > 0 ? '#E9A23B' : '#3FA45B'}
            href="/lb10"
          />
          <Tile label="Docs Today" value={kpi.docsToday} Icon={FileClock} accent="#367BF5" href="/mb51" />
          <Tile
            label="Below Safety Stock"
            value={kpi.lowStock}
            Icon={AlertTriangle}
            accent={kpi.lowStock > 0 ? '#E9A23B' : '#3FA45B'}
            href="/mb52?onlyBelowSafety=1"
          />
        </div>
      )}

      {/* Menu tree ala SAP Easy Access */}
      <div className="sap-panel">
        <div className="sap-panel-title">
          <FolderOpen size={13} className="text-sap-blue" />
          Favorites / Menu
        </div>
        <div className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1">
          {groups.map((g) => {
            const items = TCODES.filter(
              (t) =>
                t.group === g.key &&
                canAccessTcode(t, session?.role ?? 'VIEWER', session?.pdt ?? false, session?.tcodes ?? null)
            ).filter(
              (t) =>
                ![
                  'SESSION_MANAGER', 'MM02', 'LS02N',
                  'ZRF01', 'ZRF02', 'ZRF03', 'ZRF04', 'ZRF05', 'ZRF06', 'ZRF07', 'ZRF08',
                ].includes(t.code)
            );
            if (items.length === 0) return null;
            return (
              <div key={g.key} className="mb-2">
                <div className="flex items-center gap-1.5 py-1 text-2xs text-sap-muted uppercase tracking-[0.1em]">
                  <FolderOpen size={12} className="text-sap-blue/70" />
                  {g.title}
                </div>
                <ul className="pl-4 border-l border-sap-border/70">
                  {items.map((t) => (
                    <li key={t.code}>
                      <Link
                        href={t.path}
                        className="flex items-center gap-1.5 py-[3px] text-2xs text-sap-text/90 hover:text-sap-blue"
                      >
                        <ChevronRight size={11} className="text-sap-muted/60" />
                        <span className="font-mono text-sap-blue/90 w-[74px] shrink-0">{t.code}</span>
                        <span className="truncate text-sap-muted">{t.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xxs text-sap-muted/60 font-mono px-1">
        Tip: gunakan Command Field di pojok kiri atas — ketik T-Code (mis. <b>MIGO</b>, <b>LX02</b>,{' '}
        <b>ZUPLOAD</b>) lalu tekan Enter. Shortcut fokus: Ctrl + /
      </p>
    </div>
  );
}
