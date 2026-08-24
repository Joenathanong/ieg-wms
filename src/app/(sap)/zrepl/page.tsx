'use client';

/**
 * ZREPL — Mass Replenishment (desktop, ADMIN).
 *
 * Memindahkan beberapa material sekaligus dari racking ke pick bin dalam satu
 * dokumen. Bedanya dengan LT10 (mass bin transfer biasa):
 *
 *  - bin TUJUAN tidak diketik, melainkan diambil dari Fix Bin material (MM01);
 *  - batch dipilih lewat batch determination FEFO, dan batch+rak yang sudah
 *    dipakai di line lain tidak ditawarkan lagi;
 *  - qty yang melebihi isi satu rak otomatis dipecah menjadi line baru,
 *    supaya petugas tidak perlu menghitung sendiri sisa yang harus diambil
 *    dari rak lain;
 *  - posting didahului simulasi yang melaporkan SELURUH masalah sekaligus.
 *
 * Posting akhirnya tetap lewat /api/transfer (movement 301) — satu transaksi
 * untuk semua line, sehingga tidak mungkin separuh dokumen masuk.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Layers3,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Search,
  MapPin,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  Split,
  PackageSearch,
  X,
} from 'lucide-react';
import { Panel, Input, Button, Toolbar } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMaterialCatalog } from '@/lib/catalog';
import { ConfirmDialog } from '@/components/sap/Confirm';
import {
  BatchDetermination,
  quantKey,
  type BatchProposal,
} from '@/components/sap/BatchDetermination';
import { api, post, qs, fmtDate } from '@/lib/client';

/** Replenishment berjalan di Gudang Besar: racking dan pick bin sama-sama BESAR. */
const ZONE_GROUP = 'BESAR';

interface Line {
  key: string;
  material_code: string;
  qty: string;
  batch_number: string;
  source_bin: string;
  target_bin: string;
  /** stok pada batch+rak terpilih, dipakai untuk memecah line otomatis */
  available: number;
  exp_date: string | null;
  /** true bila tujuan diketik sendiri karena material tidak punya Fix Bin */
  manualTarget: boolean;
}

/** Satu baris stok hasil pencarian bebas. */
interface PickedQuant {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  batch_number: string;
  bin_code: string;
  exp_date: string | null;
  qty: number;
}

interface CheckResult {
  line: number;
  material_code: string;
  batch_number: string;
  source_bin: string;
  target_bin: string;
  qty: number;
  available: number;
  status: 'OK' | 'ERROR';
  message?: string;
}

/**
 * Kotak cari material dengan saran.
 *
 * Dua hal yang membuatnya tidak sesederhana <input list="...">:
 *
 * 1. <datalist> bawaan browser menyaring berbeda-beda — sebagian hanya
 *    mencocokkan `value` (kode material) dan mengabaikan deskripsi, sehingga
 *    mengetik "sabun" tidak memunculkan apa pun. Pencocokan di sini dikerjakan
 *    sendiri terhadap kode MAUPUN deskripsi.
 *
 * 2. Daftar sarannya dirender lewat PORTAL dengan posisi fixed, bukan sebagai
 *    elemen absolute di dalam sel tabel. Tabel line item dibungkus
 *    `overflow-x-auto`, dan wadah dengan overflow memotong apa pun yang keluar
 *    dari batasnya — daftar saran tetap muncul tetapi terpangkas setinggi satu
 *    baris tabel, sehingga tampak seolah tidak ada saran sama sekali.
 */
function MaterialPicker({
  value,
  materials,
  onPick,
}: {
  value: string;
  materials: { material_code: string; description: string; uom: string }[];
  onPick: (code: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const term = value.trim().toUpperCase();
  const hits = useMemo(() => {
    if (!term) return [];
    return materials
      .filter(
        (m) =>
          m.material_code.toUpperCase().includes(term) ||
          m.description.toUpperCase().includes(term)
      )
      .slice(0, 8);
  }, [materials, term]);

  // Satu-satunya kecocokan yang sudah persis sama tidak perlu ditawarkan lagi.
  const settled = hits.length === 1 && hits[0].material_code.toUpperCase() === term;
  const show = open && hits.length > 0 && !settled;

  const place = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 260) });
  }, []);

  useEffect(() => {
    if (!show) return;
    place();
    // Posisi ikut menyesuaikan saat halaman digulir atau jendela diubah,
    // karena posisi fixed tidak ikut bergerak sendiri bersama tabelnya.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [show, place]);

  return (
    <div ref={boxRef} className="relative">
      <Input
        className="uppercase !py-[3px]"
        placeholder="kode / nama barang"
        value={value}
        onChange={(e) => {
          onPick(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Ditunda sesaat supaya klik pada daftar saran sempat terproses
        // sebelum daftarnya ditutup oleh blur.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {show &&
        rect &&
        createPortal(
          <div
            style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width }}
            className="z-[95] max-h-[240px] overflow-auto sap-panel shadow-sap"
          >
            {hits.map((m) => (
              <button
                key={m.material_code}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(m.material_code);
                  setOpen(false);
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-sap-hover border-b border-sap-border/50 last:border-0"
              >
                <p className="font-mono text-2xs text-sap-blue">{m.material_code}</p>
                <p className="text-xxs text-sap-muted truncate">
                  {m.description} · {m.uom}
                </p>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

/**
 * Pencari stok bebas — boleh dimulai dari rak, batch, atau material.
 *
 * Batch determination menuntut material diisi lebih dulu, dan itu tidak selalu
 * cocok dengan kenyataan di lapangan: petugas sering berdiri di depan rak dan
 * tahu nomor raknya, bukan kode materialnya. Layar ini membalik urutannya —
 * apa pun yang diketahui lebih dulu bisa dipakai sebagai titik masuk, dan
 * sekali dipilih, keempat kolom line terisi sekaligus.
 */
function QuantPicker({
  open,
  initial,
  onPick,
  onClose,
}: {
  open: boolean;
  initial: { material: string; batch: string; bin: string };
  onPick: (q: PickedQuant) => void;
  onClose: () => void;
}) {
  const [material, setMaterial] = useState(initial.material);
  const [batch, setBatch] = useState(initial.batch);
  const [bin, setBin] = useState(initial.bin);
  const [rows, setRows] = useState<PickedQuant[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const search = useCallback(
    async (f: { material: string; batch: string; bin: string }) => {
      const m = f.material.trim().toUpperCase();
      const b = f.batch.trim().toUpperCase();
      const bn = f.bin.trim().toUpperCase();
      if (!m && !b && !bn) {
        setRows([]);
        setMsg('Isi salah satu: rak, batch, atau material.');
        return;
      }
      setLoading(true);
      setMsg('');
      const r = await api<PickedQuant[]>(
        '/api/stock/quants' +
          qs({ bin: bn, batch: b, q: m, exclInterim: 1, zoneGroup: ZONE_GROUP })
      );
      setLoading(false);
      if (!r.ok) {
        setRows([]);
        setMsg(r.message);
        return;
      }
      const list = r.data ?? [];
      setRows(list);
      if (list.length === 0) setMsg('Tidak ada stok Gudang Besar untuk kriteria ini.');
    },
    []
  );

  // Setiap kali dibuka, isian disamakan dengan line-nya lalu langsung dicari
  // bila sudah ada petunjuk — supaya operator tidak perlu menekan Cari dua kali.
  useEffect(() => {
    if (!open) return;
    setMaterial(initial.material);
    setBatch(initial.batch);
    setBin(initial.bin);
    setRows([]);
    setMsg('');
    if (initial.material || initial.batch || initial.bin) void search(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const go = () => void search({ material, batch, bin });

  return (
    <div data-modal className="fixed inset-0 z-[88] flex items-center justify-center p-3">
      <button type="button" aria-label="Tutup" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-[820px] max-h-[85dvh] flex flex-col sap-panel shadow-sap">
        <div className="sap-panel-title">
          <PackageSearch size={13} className="text-sap-blue" />
          <span>Cari stok — mulai dari rak, batch, atau material</span>
          <button type="button" onClick={onClose} aria-label="Tutup" className="ml-auto sap-btn sap-btn-ghost !px-1.5 !py-1">
            <X size={14} />
          </button>
        </div>

        <div className="p-3 grid grid-cols-1 sm:grid-cols-4 gap-2 border-b border-sap-border">
          <Input
            className="uppercase"
            placeholder="Rak"
            value={bin}
            onChange={(e) => setBin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          />
          <Input
            className="uppercase"
            placeholder="Batch"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          />
          <Input
            className="uppercase"
            placeholder="Kode / nama barang"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && go()}
          />
          <Button variant="primary" onClick={go} loading={loading} className="justify-center">
            <Search size={13} /> Cari
          </Button>
        </div>

        <div className="p-3 overflow-auto">
          {msg && (
            <div className="rounded-[3px] border border-sap-warnborder bg-sap-warnbg text-sap-warntext px-3 py-2 text-2xs">
              {msg}
            </div>
          )}
          {rows.length > 0 && (
            <table className="sap-grid">
              <thead>
                <tr>
                  <th className="w-[150px]">Material</th>
                  <th>Deskripsi</th>
                  <th className="w-[140px]">Batch</th>
                  <th className="w-[130px]">Rak</th>
                  <th className="w-[110px]">Exp. Date</th>
                  <th className="w-[90px] text-right">Qty</th>
                  <th className="w-[80px]"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id}>
                    <td className="font-mono text-sap-blue">{q.material_code}</td>
                    <td className="text-sap-muted truncate max-w-[220px]">{q.description}</td>
                    <td className="font-mono">{q.batch_number || '—'}</td>
                    <td className="font-mono">{q.bin_code}</td>
                    <td className="font-mono">{fmtDate(q.exp_date) || '—'}</td>
                    <td className="text-right font-mono tabular-nums">
                      {q.qty} {q.uom}
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => {
                          onPick(q);
                          onClose();
                        }}
                        className="sap-btn sap-btn-primary !py-[3px] !px-2"
                      >
                        Pilih
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

let seq = 0;
const emptyLine = (): Line => ({
  key: `L${++seq}`,
  material_code: '',
  qty: '',
  batch_number: '',
  source_bin: '',
  target_bin: '',
  available: 0,
  exp_date: null,
  manualTarget: false,
});

export default function ZreplPage() {
  const { setStatus } = useStatus();
  const { materials, loading: catalogLoading } = useMaterialCatalog();

  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [batchFor, setBatchFor] = useState<Line | null>(null);
  const [binFor, setBinFor] = useState<{ line: Line; proposal: BatchProposal } | null>(null);
  const [quantFor, setQuantFor] = useState<Line | null>(null);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const matMap = useMemo(
    () => new Map(materials.map((m) => [m.material_code, m])),
    [materials]
  );

  function setLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setChecks([]);
  }

  function addLine() {
    setLines((ls) => [...ls, emptyLine()]);
    setChecks([]);
  }

  function removeLine(key: string) {
    setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((l) => l.key !== key)));
    setChecks([]);
  }

  function reset() {
    setLines([emptyLine()]);
    setChecks([]);
    setStatus('Layar dikosongkan', 'I');
  }

  /**
   * Isi otomatis saat material dipilih: satuan dan bin tujuan mengikuti master
   * data. Batch & rak sengaja DIKOSONGKAN, karena keduanya bergantung pada
   * material dan akan menyesatkan bila nilai lama tertinggal.
   */
  function onMaterialChange(l: Line, raw: string) {
    const code = raw.toUpperCase();
    const mat = matMap.get(code);
    setLine(l.key, {
      material_code: code,
      target_bin: mat?.fix_bin ?? '',
      manualTarget: !!mat && !mat.fix_bin,
      batch_number: '',
      source_bin: '',
      available: 0,
      exp_date: null,
    });
  }

  /** Kunci batch+rak yang sudah dipakai line LAIN untuk material yang sama. */
  function usedKeys(current: Line): string[] {
    return lines
      .filter(
        (l) =>
          l.key !== current.key &&
          l.material_code.trim().toUpperCase() === current.material_code.trim().toUpperCase() &&
          l.batch_number &&
          l.source_bin
      )
      .map((l) => quantKey(l.batch_number, l.source_bin));
  }

  /**
   * Terapkan satu quant (material + batch + rak) ke sebuah line.
   *
   * Dipakai oleh KEDUA jalur masuk — batch determination maupun pencarian
   * bebas — supaya aturan pemecahan qty hanya ada di satu tempat.
   */
  function applyQuant(
    l: Line,
    pick: { material_code: string; batch_number: string; bin_code: string; qty: number; exp_date: string | null }
  ) {
    const want = Number(l.qty) || 0;
    const mat = matMap.get(pick.material_code.toUpperCase());

    setLines((ls) => {
      const idx = ls.findIndex((x) => x.key === l.key);
      if (idx < 0) return ls;

      const filled: Line = {
        ...ls[idx],
        material_code: pick.material_code,
        target_bin: ls[idx].manualTarget ? ls[idx].target_bin : mat?.fix_bin ?? '',
        manualTarget: ls[idx].manualTarget || (!!mat && !mat.fix_bin),
        batch_number: pick.batch_number,
        source_bin: pick.bin_code,
        available: pick.qty,
        exp_date: pick.exp_date,
        qty: String(Math.min(want || pick.qty, pick.qty) || pick.qty),
      };

      const shortage = want - pick.qty;
      if (shortage <= 0) {
        const next = [...ls];
        next[idx] = filled;
        return next;
      }

      // Kekurangannya dipindahkan ke line baru tepat di bawahnya, dengan
      // material & tujuan yang sama tetapi batch/rak dikosongkan — daftar batch
      // line itu nanti tidak lagi menawarkan batch+rak yang barusan dipakai.
      const rest: Line = {
        ...emptyLine(),
        material_code: filled.material_code,
        qty: String(shortage),
        target_bin: filled.target_bin,
        manualTarget: filled.manualTarget,
      };
      return [...ls.slice(0, idx), filled, rest, ...ls.slice(idx + 1)];
    });

    setChecks([]);
    if (want > pick.qty) {
      setStatus(
        `Rak ${pick.bin_code} hanya berisi ${pick.qty} — sisa ${want - pick.qty} dipindahkan ke line baru.`,
        'W'
      );
    }
  }

  function onBatchPicked(b: BatchProposal) {
    const l = batchFor;
    setBatchFor(null);
    if (!l) return;

    if (b.bins.length === 1) {
      applyQuant(l, {
        material_code: l.material_code.trim().toUpperCase(),
        batch_number: b.batch_number,
        bin_code: b.bins[0].bin_code,
        qty: b.bins[0].qty,
        exp_date: b.exp_date,
      });
      return;
    }
    // Batch ada di beberapa rak — petugas memilih raknya sendiri.
    setBinFor({ line: l, proposal: b });
  }

  const filled = lines.filter((l) => l.material_code.trim() && Number(l.qty) > 0);

  /**
   * Nomor line pada hasil simulasi dihitung dari daftar yang DIKIRIM ke server
   * (hanya line terisi), bukan dari posisi baris di layar. Tanpa pemetaan ini,
   * satu line kosong di tengah membuat seluruh penandaan error bergeser ke
   * baris yang salah.
   */
  const checkLineOf = useMemo(
    () => new Map(filled.map((l, i) => [l.key, i + 1])),
    [filled]
  );

  function payload() {
    return filled.map((l) => ({
      material_code: l.material_code.trim().toUpperCase(),
      qty: Number(l.qty),
      batch_number: l.batch_number || null,
      source_bin: l.source_bin.trim().toUpperCase(),
      target_bin: l.target_bin.trim().toUpperCase(),
      remarks: 'ZREPL mass replenishment',
    }));
  }

  async function runCheck(): Promise<boolean> {
    if (filled.length === 0) {
      setStatus('Belum ada line yang diisi', 'E');
      return false;
    }
    setBusy(true);
    const r = await post<{ results: CheckResult[]; error_count: number }>(
      '/api/transfer/check',
      { items: payload() }
    );
    setBusy(false);
    if (!r.ok) {
      setStatus(r.message, 'E');
      return false;
    }
    setChecks(r.data?.results ?? []);
    const bad = r.data?.error_count ?? 0;
    setStatus(r.message, bad === 0 ? 'S' : 'E');
    return bad === 0;
  }

  async function submit() {
    setConfirmOpen(false);
    // Simulasi dijalankan ulang tepat sebelum posting: stok bisa berubah antara
    // pemeriksaan tadi dan penekanan tombol ini.
    const clean = await runCheck();
    if (!clean) return;

    setBusy(true);
    const r = await post('/api/transfer', { items: payload() });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setLines([emptyLine()]);
      setChecks([]);
    }
  }

  const errCount = checks.filter((c) => c.status === 'ERROR').length;

  return (
    <div className="space-y-3">
      <Panel
        title="ZREPL — Mass Replenishment (Fix Bin)"
        icon={<Layers3 size={13} className="text-sap-blue" />}
      >
        <p className="text-xxs text-sap-muted leading-relaxed">
          Bin tujuan diambil dari <b>Fix Bin</b> material (MM01). Batch dipilih lewat batch
          determination FEFO dan hanya menampilkan stok <b>Gudang Besar</b>; batch pada rak yang
          sudah dipakai line lain tidak ditawarkan lagi. Qty yang melebihi isi satu rak otomatis
          dipecah menjadi line baru. Pengisian tidak harus mulai dari material — ikon{' '}
          <PackageSearch size={11} className="inline align-[-1px] text-sap-blue" /> membuka
          pencarian stok yang bisa dimulai dari <b>rak</b>, <b>batch</b>, maupun material.
        </p>
        {catalogLoading && (
          <p className="text-xxs text-sap-muted mt-1">Menyegarkan katalog material …</p>
        )}
      </Panel>

      <Panel title="Line Item" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="sap-grid">
            <thead>
              <tr>
                <th className="w-[40px] text-center">#</th>
                <th className="w-[190px]">Material</th>
                <th className="w-[200px]">Deskripsi</th>
                <th className="w-[90px] text-right">Qty</th>
                <th className="w-[60px]">UoM</th>
                <th className="w-[190px]">Batch</th>
                <th className="w-[170px]">Rak Asal</th>
                <th className="w-[160px]">Bin Tujuan (Fix Bin)</th>
                <th className="w-[44px]"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const mat = matMap.get(l.material_code.trim().toUpperCase());
                const check = checks.find((c) => c.line === checkLineOf.get(l.key));
                return (
                  <tr key={l.key} className={check?.status === 'ERROR' ? 'bg-sap-errbg/40' : ''}>
                    <td className="text-center font-mono text-sap-muted/60">{i + 1}</td>
                    <td>
                      <MaterialPicker
                        value={l.material_code}
                        materials={materials}
                        onPick={(code) => onMaterialChange(l, code)}
                      />
                    </td>
                    <td className="text-sap-muted truncate max-w-[200px]">
                      {mat?.description ?? '—'}
                    </td>
                    <td>
                      <Input
                        type="number"
                        min={1}
                        className="text-right !py-[3px]"
                        value={l.qty}
                        onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      />
                    </td>
                    <td className="font-mono text-sap-muted">{mat?.uom ?? '—'}</td>
                    <td>
                      <div className="flex items-stretch gap-1">
                        <Input
                          className="uppercase !py-[3px]"
                          value={l.batch_number}
                          onChange={(e) => setLine(l.key, { batch_number: e.target.value })}
                        />
                        <button
                          type="button"
                          title={
                            l.material_code.trim()
                              ? 'Batch determination (FEFO)'
                              : 'Cari stok — boleh mulai dari rak atau batch'
                          }
                          onClick={() =>
                            l.material_code.trim() ? setBatchFor(l) : setQuantFor(l)
                          }
                          className="sap-btn !px-1.5 !py-[3px] shrink-0"
                        >
                          <Search size={12} />
                        </button>
                      </div>
                      {l.exp_date && (
                        <p className="text-xxs text-sap-muted font-mono mt-0.5">
                          ED {fmtDate(l.exp_date)}
                        </p>
                      )}
                    </td>
                    <td>
                      <div className="flex items-stretch gap-1">
                        <Input
                          className="uppercase !py-[3px]"
                          value={l.source_bin}
                          onChange={(e) => setLine(l.key, { source_bin: e.target.value })}
                        />
                        <button
                          type="button"
                          title="Cari stok — boleh mulai dari rak, batch, atau material"
                          onClick={() => setQuantFor(l)}
                          className="sap-btn !px-1.5 !py-[3px] shrink-0"
                        >
                          <PackageSearch size={12} />
                        </button>
                      </div>
                      {l.available > 0 && (
                        <p className="text-xxs text-sap-muted font-mono mt-0.5">
                          tersedia {l.available}
                        </p>
                      )}
                    </td>
                    <td>
                      <Input
                        className={`uppercase !py-[3px] ${l.manualTarget ? '' : 'opacity-80'}`}
                        value={l.target_bin}
                        placeholder={l.manualTarget ? 'isi manual' : ''}
                        onChange={(e) =>
                          setLine(l.key, { target_bin: e.target.value, manualTarget: true })
                        }
                      />
                      {l.manualTarget && l.material_code.trim() && (
                        <p className="text-xxs text-sap-warntext mt-0.5 flex items-center gap-1">
                          <MapPin size={10} /> tanpa Fix Bin
                        </p>
                      )}
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        title="Hapus line"
                        className="sap-btn sap-btn-ghost !px-1.5 !py-[3px]"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="p-2 border-t border-sap-border">
          <Button onClick={addLine}>
            <Plus size={13} /> New Item
          </Button>
        </div>
      </Panel>

      <Toolbar>
        <Button onClick={runCheck} loading={busy}>
          <ClipboardCheck size={13} /> Cek Stok
        </Button>
        <Button
          variant="primary"
          onClick={() => setConfirmOpen(true)}
          disabled={filled.length === 0}
        >
          <Save size={13} /> Posting ({filled.length} line)
        </Button>
        <Button onClick={reset}>
          <RotateCcw size={13} /> Reset
        </Button>
      </Toolbar>

      {checks.length > 0 && (
        <Panel
          title={
            errCount === 0
              ? `Hasil simulasi — ${checks.length} line siap`
              : `Hasil simulasi — ${errCount} line bermasalah`
          }
          icon={
            errCount === 0 ? (
              <CheckCircle2 size={13} className="text-sap-oktext" />
            ) : (
              <XCircle size={13} className="text-sap-errtext" />
            )
          }
          bodyClassName="p-0"
        >
          <table className="sap-grid">
            <thead>
              <tr>
                <th className="w-[40px] text-center">#</th>
                <th className="w-[150px]">Material</th>
                <th className="w-[140px]">Batch</th>
                <th className="w-[130px]">Rak Asal</th>
                <th className="w-[80px] text-right">Qty</th>
                <th className="w-[90px] text-right">Tersedia</th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.line} className={c.status === 'ERROR' ? 'bg-sap-errbg/40' : ''}>
                  <td className="text-center font-mono text-sap-muted/60">{c.line}</td>
                  <td className="font-mono">{c.material_code || '—'}</td>
                  <td className="font-mono">{c.batch_number || '—'}</td>
                  <td className="font-mono">{c.source_bin || '—'}</td>
                  <td className="text-right font-mono tabular-nums">{c.qty}</td>
                  <td className="text-right font-mono tabular-nums">{c.available}</td>
                  <td className={c.status === 'ERROR' ? 'text-sap-errtext' : 'text-sap-oktext'}>
                    {c.message ?? 'Siap diposting'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <QuantPicker
        open={!!quantFor}
        initial={{
          material: quantFor?.material_code ?? '',
          batch: quantFor?.batch_number ?? '',
          bin: quantFor?.source_bin ?? '',
        }}
        onPick={(q) => {
          if (!quantFor) return;
          applyQuant(quantFor, {
            material_code: q.material_code,
            batch_number: q.batch_number,
            bin_code: q.bin_code,
            qty: q.qty,
            exp_date: q.exp_date,
          });
        }}
        onClose={() => setQuantFor(null)}
      />

      <BatchDetermination
        open={!!batchFor}
        material={batchFor?.material_code.trim().toUpperCase() ?? ''}
        description={matMap.get(batchFor?.material_code.trim().toUpperCase() ?? '')?.description}
        zoneGroup={ZONE_GROUP}
        exclude={batchFor ? usedKeys(batchFor) : []}
        onPick={onBatchPicked}
        onClose={() => setBatchFor(null)}
      />

      {/* Pemilih rak — muncul hanya bila batch terpilih tersebar di beberapa rak. */}
      {binFor && (
        <div data-modal className="fixed inset-0 z-[86] flex items-center justify-center p-3">
          <button
            type="button"
            aria-label="Tutup"
            onClick={() => setBinFor(null)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="relative w-full max-w-[460px] sap-panel shadow-sap">
            <div className="sap-panel-title">
              <Split size={13} className="text-sap-blue" />
              <span>
                Batch {binFor.proposal.batch_number || '(tanpa batch)'} ada di{' '}
                {binFor.proposal.bins.length} rak
              </span>
            </div>
            <div className="p-3 space-y-1.5">
              {binFor.proposal.bins.map((b) => (
                <button
                  key={b.bin_code}
                  type="button"
                  onClick={() => {
                    applyQuant(binFor.line, {
                      material_code: binFor.line.material_code.trim().toUpperCase(),
                      batch_number: binFor.proposal.batch_number,
                      bin_code: b.bin_code,
                      qty: b.qty,
                      exp_date: binFor.proposal.exp_date,
                    });
                    setBinFor(null);
                  }}
                  className="w-full flex items-center justify-between gap-3 rounded-[3px] border border-sap-border bg-sap-panelalt px-3 py-2 hover:border-sap-blue/60"
                >
                  <span className="font-mono text-2xs text-sap-blue">{b.bin_code}</span>
                  <span className="font-mono text-2xs tabular-nums">{b.qty}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Posting replenishment"
        question={`${filled.length} line akan diposting sebagai transfer 301.`}
        details={[
          { label: 'Jumlah line', value: filled.length },
          { label: 'Total qty', value: filled.reduce((a, l) => a + (Number(l.qty) || 0), 0) },
          { label: 'Pemeriksaan', value: 'Stok dicek ulang tepat sebelum posting' },
          { label: 'Sifat posting', value: 'Satu transaksi — tidak mungkin separuh dokumen masuk' },
        ]}
        busy={busy}
        confirmLabel="Posting"
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
