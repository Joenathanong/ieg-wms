'use client';

/**
 * Grafik dashboard opname.
 *
 * Digambar sendiri dengan div dan SVG, bukan pustaka chart. Yang dibutuhkan
 * layar ini hanya perbandingan panjang dan satu garis waktu — menambah pustaka
 * grafik untuk itu tidak sepadan dengan ukurannya, dan hasilnya justru sulit
 * disamakan dengan gaya SAP di seluruh aplikasi.
 *
 * PALET. Warna diambil dari token tema sehingga ikut menyesuaikan saat tema
 * terang/gelap diganti. Susunannya sudah diuji dengan alat pemeriksa palet:
 *
 *  - Versi pertama memakai EMPAT warna untuk komposisi (biru, hijau, kuning,
 *    abu). Gagal — hijau pucat dan kuning pucat pada tema gelap hanya berjarak
 *    ΔE 13, di bawah ambang 15, artinya sulit dibedakan bahkan oleh pembaca
 *    dengan penglihatan warna normal, apalagi yang buta warna.
 *  - Komposisi karena itu dirampingkan menjadi TIGA: selesai, belum sepakat,
 *    belum dihitung. Susunan biru/kuning/abu lolos pemeriksaan pemisahan buta
 *    warna (ΔE 17,5) maupun penglihatan normal (ΔE 20) di kedua tema.
 *
 * Dua peringatan yang sengaja tidak diperbaiki: abu-abu memang "terbaca abu",
 * dan itu justru yang diinginkan untuk slot "belum dihitung"; serta rentang
 * kecerahan yang dinilai terhadap permukaan gelap standar, sedangkan permukaan
 * aplikasi ini lebih terang — kontras terhadap permukaan sesungguhnya lolos.
 */

import { useId, useState } from 'react';

/* ------------------------------------------------------------------ */
/* Bar horizontal — perbandingan "sudah berapa dari target"            */
/* ------------------------------------------------------------------ */

export function Bar({
  value,
  max,
  label,
  right,
  tone = 'blue',
}: {
  value: number;
  max: number;
  label: string;
  right?: string;
  tone?: 'blue' | 'ok' | 'warn' | 'err';
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const fill =
    tone === 'ok'
      ? 'bg-sap-oktext'
      : tone === 'warn'
        ? 'bg-sap-warntext'
        : tone === 'err'
          ? 'bg-sap-errtext'
          : 'bg-sap-blue';
  return (
    <div className="space-y-1" title={`${label} — ${value} dari ${max} (${pct}%)`}>
      <div className="flex items-baseline justify-between gap-2 text-2xs">
        <span className="truncate">{label}</span>
        <span className="font-mono text-sap-muted shrink-0">{right ?? `${pct}%`}</span>
      </div>
      <div className="h-[10px] rounded-sap bg-sap-neutralbg border border-sap-border overflow-hidden">
        <div className={`h-full rounded-r-sap ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Komposisi status baris — bar bertumpuk, 3 segmen                    */
/* ------------------------------------------------------------------ */

export function Composition({
  done,
  unresolved,
  notCounted,
}: {
  done: number;
  unresolved: number;
  notCounted: number;
}) {
  const total = done + unresolved + notCounted;
  if (total === 0) return <p className="text-xxs text-sap-muted">Belum ada baris untuk dinilai.</p>;
  const seg = [
    { key: 'done', label: 'Sudah final', n: done, cls: 'bg-sap-blue' },
    { key: 'unres', label: 'Belum sepakat', n: unresolved, cls: 'bg-sap-warntext' },
    { key: 'not', label: 'Belum dihitung', n: notCounted, cls: 'bg-sap-muted' },
  ].filter((s) => s.n > 0);

  return (
    <div className="space-y-2">
      {/* gap 2px antar segmen supaya batasnya terbaca tanpa mengandalkan warna */}
      <div className="flex gap-[2px] h-[14px]">
        {seg.map((s) => (
          <div
            key={s.key}
            className={`${s.cls} first:rounded-l-sappanel last:rounded-r-sappanel`}
            style={{ width: `${(s.n / total) * 100}%` }}
            title={`${s.label}: ${s.n} baris (${Math.round((s.n / total) * 100)}%)`}
          />
        ))}
      </div>
      {/* Legenda selalu ada: identitas tidak boleh bergantung warna saja. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xxs">
        {seg.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`w-[9px] h-[9px] rounded-sap ${s.cls}`} />
            <span className="text-sap-muted">
              {s.label} · <span className="font-mono text-sap-text">{s.n}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Progres harian — area + garis                                       */
/* ------------------------------------------------------------------ */

export function DailyChart({ data }: { data: { day: string; counted: number }[] }) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return <p className="text-xxs text-sap-muted">Belum ada rak yang selesai dihitung.</p>;
  }
  if (data.length === 1) {
    // Satu titik bukan tren — angka tunggal lebih jujur daripada garis palsu.
    return (
      <div className="text-2xs">
        <span className="font-mono text-lg text-sap-blue">{data[0].counted}</span>{' '}
        <span className="text-sap-muted">rak selesai pada {data[0].day}</span>
      </div>
    );
  }

  const W = 560;
  const H = 120;
  const P = { t: 8, r: 8, b: 20, l: 30 };
  const max = Math.max(...data.map((d) => d.counted), 1);
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (data.length - 1);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.counted)}`).join(' ');
  const area = `${line} L${x(data.length - 1)},${H - P.b} L${x(0)},${H - P.b} Z`;

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[120px]"
        role="img"
        aria-label={`Rak selesai per hari, ${data.length} hari`}
      >
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--sap-blue-rgb))" stopOpacity="0.28" />
            <stop offset="100%" stopColor="rgb(var(--sap-blue-rgb))" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* garis bantu recessive */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={P.l}
            x2={W - P.r}
            y1={y(max * f)}
            y2={y(max * f)}
            stroke="rgb(var(--sap-border-rgb))"
            strokeWidth="1"
          />
        ))}
        <text x="2" y={y(max) + 4} fontSize="9" fill="rgb(var(--sap-muted-rgb))">
          {max}
        </text>

        <path d={area} fill={`url(#g${gid})`} />
        <path d={line} fill="none" stroke="rgb(var(--sap-blue-rgb))" strokeWidth="2" />

        {data.map((d, i) => (
          <g key={d.day}>
            <circle
              cx={x(i)}
              cy={y(d.counted)}
              r={hover === i ? 5 : 3.5}
              fill="rgb(var(--sap-blue-rgb))"
              stroke="rgb(var(--sap-panel-rgb))"
              strokeWidth="2"
            />
            {/* target sentuh jauh lebih besar daripada titiknya */}
            <rect
              x={x(i) - 14}
              y={0}
              width={28}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}

        {/* label tanggal hanya di ujung — bukan di setiap titik */}
        <text x={P.l} y={H - 6} fontSize="9" fill="rgb(var(--sap-muted-rgb))">
          {data[0].day.slice(5)}
        </text>
        <text
          x={W - P.r}
          y={H - 6}
          fontSize="9"
          textAnchor="end"
          fill="rgb(var(--sap-muted-rgb))"
        >
          {data[data.length - 1].day.slice(5)}
        </text>
      </svg>
      <p className="text-xxs text-sap-muted font-mono h-[14px]">
        {hover !== null ? `${data[hover].day} · ${data[hover].counted} rak` : ''}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Histogram sebaran besaran selisih                                   */
/* ------------------------------------------------------------------ */

export function Histogram({ data }: { data: { label: string; n: number }[] }) {
  const max = Math.max(...data.map((d) => d.n), 1);
  const total = data.reduce((a, d) => a + d.n, 0);
  if (total === 0) return <p className="text-xxs text-sap-muted">Belum ada baris berselisih.</p>;
  return (
    <div className="flex items-end gap-[2px] h-[110px]">
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <span className="text-xxs font-mono text-sap-text">{d.n || ''}</span>
          <div
            className="w-full bg-sap-blue rounded-t-sap"
            style={{ height: `${Math.max(2, (d.n / max) * 74)}px` }}
            title={`${d.label} unit: ${d.n} baris`}
          />
          <span className="text-xxs text-sap-muted truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
