'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  PackagePlus,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Info,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  Boxes,
  ArrowRight,
  Layers,
} from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Separator } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData, useCostCenters } from '@/components/sap/hooks';
import { useExecuteKey } from '@/components/sap/keynav';
import { ConfirmDialog } from '@/components/sap/Confirm';
import { BatchDetermination } from '@/components/sap/BatchDetermination';
import { api, post, fmtDate } from '@/lib/client';
import { ZONE_GROUPS, DEFAULT_GR_ZONE_GROUP } from '@/lib/zones';
import { fillMfg, DEFAULT_SHELF_LIFE_YEARS } from '@/lib/shelflife';
import { BATCH_CODE_LENGTH, parseBatchCode } from '@/lib/batchcode';

/* --------------------------------------------------------------- */

/** Balasan /api/materials/batch. `found` = batch sudah pernah terdaftar. */
interface BatchInfo {
  found: boolean;
  source?: 'STOCK' | 'CODE' | 'NONE';
  mfg_date?: string | null;
  exp_date?: string | null;
}

const MOVEMENTS = [
  { code: '101', label: '101 — Goods Receipt (GR Pembelian)', mode: 'TR_IN' },
  { code: '501', label: '501 — Goods Receipt Lain-lain (Retur, dll)', mode: 'TR_IN' },
  { code: '201', label: '201 — Goods Issue (Cost Center)', mode: 'TR_OUT' },
  { code: '601', label: '601 — Goods Issue (Penjualan)', mode: 'DIRECT_MIN' },
  { code: '122', label: '122 — Retur ke Vendor', mode: 'DIRECT_MIN' },
  { code: '551', label: '551 — Scrapping / Adjustment (-)', mode: 'DIRECT_MIN' },
  { code: '701', label: '701 — Phys. Inv. Difference (+)', mode: 'DIRECT_PLUS' },
  { code: '702', label: '702 — Phys. Inv. Difference (-)', mode: 'DIRECT_MIN' },
  { code: 'CANCEL', label: 'Cancellation — 102 / 123 / 202 / 502 / 552 / 562 / 602 / 711 / 712', mode: 'CANCEL' },
] as const;

type Mode = (typeof MOVEMENTS)[number]['mode'];

/** Satu baris dokumen asal beserta status kelayakan pembatalannya. */
interface CancelLine {
  line_no: number;
  movement_code: string;
  movement_label: string;
  cancel_code: string;
  cancel_label: string;
  material_code: string;
  description: string;
  uom: string;
  qty: number;
  batch_number: string | null;
  source_bin: string | null;
  target_bin: string | null;
  tr_number: string | null;
  cancellable: boolean;
  blocked_reason: string | null;
}

interface CancelPreview {
  document_number: string;
  movement_code: string;
  movement_label: string;
  cancel_code: string;
  cancel_label: string;
  doc_date: string;
  reference: string | null;
  user_id: string;
  lines: CancelLine[];
}

interface Line {
  key: string;
  material_code: string;
  qty: string;
  batch_number: string;
  mfg_date: string;
  exp_date: string;
  pack_code: string;
  bin: string;
  remarks: string;
}

/** Kolom yang bisa diisi lewat tempel dari spreadsheet, berurutan kiri ke kanan. */
type PasteCol = 'material_code' | 'qty' | 'batch_number' | 'mfg_date' | 'exp_date' | 'pack_code' | 'bin' | 'remarks';

/**
 * Ubah tanggal dari spreadsheet menjadi format input HTML (YYYY-MM-DD).
 *
 * Excel Indonesia menyalin tanggal sebagai dd/mm/yyyy atau dd.mm.yyyy,
 * sedangkan input tanggal HTML hanya menerima yyyy-mm-dd. Tanpa penerjemahan
 * ini, kolom tanggal hasil tempel akan diam-diam kosong — dan pada penerimaan
 * barang, expired date yang hilang jauh lebih berbahaya daripada tempelan yang
 * gagal terang-terangan.
 *
 * Urutan hari-bulan mengikuti kebiasaan Indonesia: 03/04/2026 dibaca 3 April,
 * bukan 4 Maret.
 */
function pasteDate(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return '';
}

/** Rapikan satu sel tempelan sesuai kolom tujuannya. */
function pasteCell(col: PasteCol, raw: string): string {
  const v = raw.trim();
  if (col === 'qty') return v.replace(/[^\d-]/g, '');
  if (col === 'mfg_date' || col === 'exp_date') return pasteDate(v);
  if (col === 'remarks') return v;
  return v.toUpperCase();
}

const emptyLine = (): Line => ({
  key: Math.random().toString(36).slice(2),
  material_code: '',
  qty: '',
  batch_number: '',
  mfg_date: '',
  exp_date: '',
  pack_code: '',
  bin: '',
  remarks: '',
});

interface PostedDoc {
  line: number;
  material_code: string;
  qty: number;
  document_number: string | null;
  tr_number: string | null;
  tr_lines: number;
}

export default function MigoPage() {
  const { setStatus } = useStatus();
  const { materials, bins } = useMasterData();
  const { costCenters } = useCostCenters();

  // Semua pilihan header sengaja kosong: operator harus memilih sadar,
  // supaya tidak ada dokumen terposting dengan movement/langkah default.
  const [movement, setMovement] = useState<string>('');
  const [giMode, setGiMode] = useState<'' | 'REQUEST' | 'ISSUE'>('');
  // Kecuali gudang tujuan, seluruh pilihan header memang sengaja kosong supaya
  // operator memilih sadar. Gudang tujuan dikecualikan karena hampir seluruh
  // penerimaan masuk ke Heavy Duty Racking — memaksa memilih setiap kali hanya
  // menambah satu klik yang jawabannya selalu sama, dan tetap bisa diubah.
  const [zoneGroup, setZoneGroup] = useState<string>(DEFAULT_GR_ZONE_GROUP);
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<PostedDoc[]>([]);

  // --- mode CANCELLATION ---
  const [cancelDoc, setCancelDoc] = useState('');
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);
  /** nomor baris dokumen asal yang dipilih untuk dibatalkan */
  const [cancelSel, setCancelSel] = useState<number[]>([]);
  const [cancelRemarks, setCancelRemarks] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);

  // --- konfirmasi posting & batch determination ---
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [batchFor, setBatchFor] = useState<Line | null>(null);

  const mode: Mode | null = MOVEMENTS.find((m) => m.code === movement)?.mode ?? null;
  const isGiIssue = mode === 'TR_OUT' && giMode === 'ISSUE';
  // ISSUE mengeluarkan stok dari bin interim GI, jadi tidak perlu input bin manual
  const isTwoStep = mode === 'TR_IN' || mode === 'TR_OUT';
  const isInbound = mode === 'TR_IN' || mode === 'DIRECT_PLUS';
  const isCancel = mode === 'CANCEL';
  // 201 tahap ISSUE membebankan biaya ke cost center; 601 (penjualan) tidak.
  // Ditampilkan di kedua langkah 201: diisi saat REQUEST akan diwarisi oleh
  // langkah ISSUE, dan wajib paling lambat saat ISSUE.
  const showCc = mode === 'TR_OUT';
  /**
   * Retur ke vendor wajib menyebut tujuannya. Aplikasi ini belum punya master
   * vendor, jadi kolom Reference yang memikul keterangan itu — tanpa isian,
   * stok berkurang tetapi tidak ada yang tahu barangnya kembali ke siapa.
   */
  const refRequired = movement === '122';
  const needsCc = showCc && giMode === 'ISSUE';

  async function loadCancelPreview() {
    const doc = cancelDoc.trim().toUpperCase();
    if (!doc) return setStatus('Masukkan nomor material document yang akan dibatalkan', 'E');
    setCancelLoading(true);
    setCancelPreview(null);
    setCancelSel([]);
    const r = await api<CancelPreview>(`/api/migo/cancel?doc=${encodeURIComponent(doc)}`);
    setCancelLoading(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok && r.data) {
      setCancelPreview(r.data);
      // Bawaannya seluruh baris yang masih layak — kasus tersering adalah
      // membatalkan satu dokumen utuh; mencentang ulang lima baris untuk itu
      // hanya menambah kerja.
      setCancelSel(r.data.lines.filter((l) => l.cancellable).map((l) => l.line_no));
    }
  }

  async function submitCancel() {
    if (!cancelPreview) return setStatus('Tampilkan dokumen terlebih dahulu', 'E');
    setBusy(true);
    setConfirmOpen(false);
    const r = await post('/api/migo/cancel', {
      document_number: cancelPreview.document_number,
      lines: cancelSel,
      remarks: cancelRemarks,
    });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setCancelPreview(null);
      setCancelSel([]);
      setCancelDoc('');
      setCancelRemarks('');
    }
  }

  function toggleCancelLine(line_no: number) {
    setCancelSel((sel) =>
      sel.includes(line_no) ? sel.filter((n) => n !== line_no) : [...sel, line_no]
    );
  }

  const matMap = useMemo(() => new Map(materials.map((m) => [m.material_code, m])), [materials]);

  /**
   * Kolom tempel yang berlaku untuk mode saat ini, urut seperti tampilan tabel.
   *
   * Harus mengikuti kolom yang BENAR-BENAR tampil: menempel lima kolom dari
   * Excel ke layar yang hanya menampilkan tiga akan meleset satu kolom untuk
   * seterusnya, dan salahnya baru terlihat setelah posting.
   */
  const pasteCols = useMemo<PasteCol[]>(() => {
    const cols: PasteCol[] = ['material_code', 'qty', 'batch_number'];
    if (isInbound) cols.push('mfg_date', 'exp_date');
    if (isGiIssue) cols.push('pack_code');
    if (!isTwoStep) cols.push('bin');
    cols.push('remarks');
    return cols;
  }, [isInbound, isGiIssue, isTwoStep]);

  /**
   * Tempel banyak baris dari spreadsheet.
   *
   * Excel menyalin sebagai teks bertabulasi: baris dipisah baris-baru, kolom
   * dipisah tab. Tempelan dimulai dari sel tempat kursor berada — sama seperti
   * di Excel sendiri — lalu mengisi ke bawah dan ke kanan.
   *
   * Baris yang kurang ditambahkan otomatis, jadi menempel 5 baris ke layar yang
   * baru punya 1 line menghasilkan 5 line. Baris yang sudah ada TIDAK dihapus:
   * menempel di tengah dokumen hanya menimpa sebanyak baris yang ditempel.
   *
   * Tempelan satu sel dibiarkan berperilaku bawaan — supaya menyalin satu kode
   * material dari mana pun tetap terasa biasa.
   */
  function handlePaste(e: React.ClipboardEvent, rowIndex: number, col: PasteCol) {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;

    const grid = text
      .replace(/\r\n?/g, '\n')
      .replace(/\n+$/, '')
      .split('\n')
      .map((r) => r.split('\t'));

    if (grid.length === 1 && grid[0].length === 1) return; // satu sel: biarkan biasa
    e.preventDefault();

    const startCol = pasteCols.indexOf(col);
    if (startCol < 0) return;

    const added = Math.max(0, rowIndex + grid.length - lines.length);

    setLines((ls) => {
      const next = [...ls];
      while (next.length < rowIndex + grid.length) next.push(emptyLine());

      grid.forEach((cells, r) => {
        const target = next[rowIndex + r];
        const patch: Partial<Line> = {};
        cells.forEach((cell, c) => {
          const key = pasteCols[startCol + c];
          if (!key) return; // kolom melewati ujung tabel — diabaikan
          patch[key] = pasteCell(key, cell);
        });
        next[rowIndex + r] = { ...target, ...patch };
      });
      return next;
    });

    setStatus(
      `${grid.length} baris ditempel${added > 0 ? `, ${added} line baru ditambahkan` : ''}. Periksa kembali sebelum posting.`,
      'I'
    );
  }

  function setLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /**
   * Isi manufacturing & expired date otomatis begitu nomor batch selesai diketik.
   *
   * Dua sumber, berurutan:
   *   1. batch yang SUDAH pernah terdaftar -> ditanya ke server, tanggalnya
   *      dipakai ulang supaya satu nomor batch tidak pernah punya dua tanggal
   *      kedaluwarsa berbeda;
   *   2. batch baru berpola 6 karakter (mis. G26339) -> dihitung DI LAYAR dari
   *      kodenya sendiri: huruf = bulan, 2 digit berikutnya = tahun produksi.
   *
   * Sumber 2 sengaja tidak bergantung pada server: pola batch sepenuhnya bisa
   * dibaca dari teksnya, jadi tidak ada alasan pengisian otomatis ikut gagal
   * saat permintaan ke server gagal, lambat, atau modulnya belum ter-reload.
   *
   * Isian operator TIDAK PERNAH ditimpa — hanya field yang masih kosong diisi.
   */
  async function loadBatchDates(line: Line) {
    const m = line.material_code.trim().toUpperCase();
    const b = line.batch_number.trim().toUpperCase();
    if (!b) return;

    // Kedua tanggal sudah diisi operator -> tidak ada yang perlu ditebak.
    const wantMfg = line.mfg_date.trim() === '';
    const wantExp = line.exp_date.trim() === '';
    if (!wantMfg && !wantExp) return;

    // Sumber 1 — batch yang sudah terdaftar. Butuh material; kalau materialnya
    // belum diisi, langkah ini dilewati dan pembacaan kode tetap jalan.
    let registered = false;
    let exp = '';
    let mfg = '';
    if (m) {
      const r = await api<BatchInfo>(
        `/api/materials/batch?material=${encodeURIComponent(m)}&batch=${encodeURIComponent(b)}`
      );
      registered = !!(r.ok && r.data?.found);
      exp = r.ok && r.data?.exp_date ? String(r.data.exp_date).slice(0, 10) : '';
      mfg = r.ok && r.data?.mfg_date ? String(r.data.mfg_date).slice(0, 10) : '';
    }

    // Sumber 2 — pola nomor batch, dihitung di layar tanpa server.
    if (!exp && !mfg) {
      const code = parseBatchCode(b);
      if (code) {
        exp = code.exp_date;
        mfg = code.mfg_date;
      }
    }
    if ((wantMfg ? mfg : '') === '' && (wantExp ? exp : '') === '') return;

    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== line.key) return l;
        // nomor batch sempat diubah lagi sebelum balasan tiba -> abaikan
        if (l.batch_number.trim().toUpperCase() !== b) return l;
        return {
          ...l,
          mfg_date: l.mfg_date || mfg,
          exp_date: l.exp_date || exp,
        };
      })
    );

    setStatus(
      registered
        ? `Batch ${b} sudah terdaftar — tanggal diambil dari batch yang ada.`
        : `Batch ${b} baru — tanggal dibaca dari nomor batch (boleh diubah).`,
      'I'
    );
  }

  /** Pratinjau pemecahan pallet untuk satu line. */
  function palletPreview(l: Line): { lines: number; per: number; pack: string } | null {
    const mat = matMap.get(l.material_code.trim().toUpperCase());
    const qty = Number(l.qty);
    if (!mat || !qty || qty <= 0) return null;
    const packs = mat.packagings ?? [];
    if (packs.length === 0) return null;
    const g = zoneGroup || null;
    const chosen =
      packs.find((p) => p.pack_code === l.pack_code.trim().toUpperCase()) ??
      (g
        ? (packs.find((p) => p.zone_group === g && p.is_default) ??
          packs.find((p) => p.zone_group === g) ??
          packs.find((p) => !p.zone_group && p.is_default) ??
          packs.find((p) => !p.zone_group))
        : undefined) ??
      packs.find((p) => p.is_default) ??
      packs[0];
    if (!chosen || chosen.qty_per_unit <= 0) return null;
    return {
      lines: Math.ceil(qty / chosen.qty_per_unit),
      per: chosen.qty_per_unit,
      pack: chosen.pack_code,
    };
  }

  function reset() {
    setLines([emptyLine()]);
    setReference('');
    setCostCenter('');
    setGiMode('');
    setZoneGroup(DEFAULT_GR_ZONE_GROUP);
    setPosted([]);
    setStatus('Entry screen has been reset', 'I');
  }

  /** Bentuk payload item + validasi. null bila ada yang tidak lolos. */
  function buildItems() {
    const items = lines
      .filter((l) => l.material_code.trim() !== '' || l.qty.trim() !== '')
      .map((l) => ({
        material_code: l.material_code.trim().toUpperCase(),
        qty: Number(l.qty),
        batch_number: l.batch_number.trim().toUpperCase() || null,
        mfg_date: l.mfg_date || null,
        exp_date: l.exp_date || null,
        pack_code: isGiIssue ? null : l.pack_code.trim().toUpperCase() || null,
        tr_number: isGiIssue ? l.pack_code.trim().toUpperCase() || null : null,
        bin: isTwoStep ? null : l.bin.trim().toUpperCase(),
        remarks: l.remarks.trim() || null,
      }));

    if (items.length === 0) {
      setStatus('Enter at least one line item', 'E');
      return null;
    }
    for (const [i, it] of items.entries()) {
      if (!it.material_code) {
        setStatus(`Line ${i + 1}: material number is missing`, 'E');
        return null;
      }
      if (!it.qty || it.qty <= 0) {
        setStatus(`Line ${i + 1}: quantity must be greater than zero`, 'E');
        return null;
      }
      if (!isTwoStep && !it.bin) {
        setStatus(`Line ${i + 1}: storage bin is missing`, 'E');
        return null;
      }
    }
    return items;
  }

  /** Tombol Post / tombol Enter: validasi dulu, lalu minta konfirmasi. */
  function askPost() {
    if (!movement) return setStatus('Pilih movement type terlebih dahulu', 'E');
    if (isCancel) {
      if (!cancelPreview) return setStatus('Tampilkan dokumen terlebih dahulu', 'E');
      if (cancelSel.length === 0)
        return setStatus('Pilih minimal satu baris yang akan dibatalkan', 'E');
      return setConfirmOpen(true);
    }
    if (mode === 'TR_OUT' && !giMode) return setStatus('Pilih langkah 201 terlebih dahulu', 'E');
    if (mode === 'TR_IN' && !zoneGroup) return setStatus('Pilih gudang tujuan terlebih dahulu', 'E');
    if (refRequired && !reference.trim())
      return setStatus('Retur ke vendor wajib menyebut vendor / nomor retur di kolom Reference', 'E');
    if (!buildItems()) return;
    setConfirmOpen(true);
  }

  async function submit() {
    const items = buildItems();
    if (!items) return;

    setBusy(true);
    const r = await post('/api/migo', {
      movement_type: movement,
      doc_date: docDate,
      reference,
      ...(showCc && costCenter ? { cost_center: costCenter } : {}),
      ...(mode === 'TR_OUT' ? { mode: giMode } : {}),
      ...(mode === 'TR_IN' && zoneGroup ? { zone_group: zoneGroup } : {}),
      items,
    });
    setBusy(false);

    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setPosted(r.data?.documents ?? []);
      setLines([emptyLine()]);
    }
  }

  /* ---- ringkasan untuk dialog konfirmasi ---- */
  const confirmLines = lines.filter((l) => l.material_code.trim() !== '' || l.qty.trim() !== '');
  const confirmQty = confirmLines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const movementLabel = MOVEMENTS.find((m) => m.code === movement)?.label ?? movement;

  // Enter / F8 = jalankan aksi utama layar (tetap lewat dialog konfirmasi)
  useExecuteKey(askPost, !busy);

  return (
    <div className="space-y-3">
      {/* HEADER DATA */}
      <Panel title="MIGO — Goods Movement · Header Data" icon={<PackagePlus size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
          <Field label="Movement Type" required>
            <Select
              value={movement}
              onChange={(e) => {
                const mv = e.target.value;
                setMovement(mv);
                setPosted([]);
                // pilihan turunan ikut direset supaya tidak terbawa dari movement lama
                setGiMode('');
                /**
                 * Retur (501) hampir selalu kembali ke Gudang Kecil — itu rak
                 * asal barang eceran, dan Fix Bin material di MM01 menunjuk ke
                 * sana. Menyetel gudang tujuan mengikuti movement membuat saran
                 * rak put-away nanti benar-benar menyala; kalau dibiarkan
                 * BESAR, Fix Bin-nya tidak akan cocok dan sarannya diam.
                 * Tetap bisa diubah untuk kasus retur yang masuk gudang besar.
                 */
                setZoneGroup(mv === '501' ? 'KECIL' : DEFAULT_GR_ZONE_GROUP);
              }}
            >
              <option value="">(pilih movement type)</option>
              {MOVEMENTS.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>

          {!isCancel && (
            <Field label="Document Date" required>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </Field>
          )}

          {mode === 'TR_IN' && (
            <Field
              label="Gudang Tujuan"
              required
              hint={
                movement === '501'
                  ? 'retur: rak put-away disarankan dari Fix Bin material (MM01)'
                  : 'menentukan baris palletization yang dipakai'
              }
            >
              <Select value={zoneGroup} onChange={(e) => setZoneGroup(e.target.value)}>
                {ZONE_GROUPS.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {mode === 'TR_OUT' && (
            <Field label="Langkah 201" required>
              <Select value={giMode} onChange={(e) => setGiMode(e.target.value as '' | 'REQUEST' | 'ISSUE')}>
                <option value="">(pilih langkah)</option>
                <option value="REQUEST">1 — Buat permintaan picking (Transfer Requirement)</option>
                <option value="ISSUE">2 — Post goods issue dari GI zone</option>
              </Select>
            </Field>
          )}

          {showCc && (
            <Field
              label="Cost Center"
              required={needsCc}
              hint={
                costCenters.find((c) => c.cost_center === costCenter)?.description ??
                (needsCc
                  ? 'Wajib — kosongkan hanya bila ingin mewarisi dari TR'
                  : 'Opsional di langkah 1; akan diwarisi langkah goods issue')
              }
            >
              <Select value={costCenter} onChange={(e) => setCostCenter(e.target.value)}>
                <option value="">(pilih cost center)</option>
                {costCenters
                  .filter((c) => c.is_active || c.cost_center === costCenter)
                  .map((c) => (
                    <option key={c.cost_center} value={c.cost_center}>
                      {c.cost_center} — {c.description}
                    </option>
                  ))}
              </Select>
            </Field>
          )}

          {!isCancel && (
            <Field
              label={refRequired ? 'Vendor / Nomor Retur' : 'Reference / Delivery Note'}
              required={refRequired}
              hint={refRequired ? 'Wajib — tanpa ini retur tidak bisa dicocokkan nanti' : undefined}
            >
              <Input
                value={reference}
                placeholder={refRequired ? 'mis. PT ABC / RET-2026-0012' : 'mis. DO-2026-00123'}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          )}

          {isCancel && (
            <Field label="No. Dokumen yang Dibatalkan" required>
              <div className="flex gap-1.5">
                <Input
                  className="uppercase font-mono"
                  placeholder="5000000123"
                  value={cancelDoc}
                  onChange={(e) => setCancelDoc(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadCancelPreview()}
                />
                <Button variant="primary" onClick={loadCancelPreview} loading={cancelLoading}>
                  Tampilkan
                </Button>
              </div>
            </Field>
          )}

          <Field label="Processing Level">
            <div className="sap-control-row flex-wrap">
              {mode === 'TR_IN' && (
                <span className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext gap-1">
                  <ArrowDownToLine size={11} /> IM + → GR ZONE
                </span>
              )}
              {mode === 'TR_OUT' && giMode === 'REQUEST' && (
                <span className="sap-badge border-sap-infoborder bg-sap-infobg text-sap-infotext gap-1">
                  <ArrowUpFromLine size={11} /> REQUEST ONLY
                </span>
              )}
              {mode === 'TR_OUT' && giMode === 'ISSUE' && (
                <span className="sap-badge border-sap-errborder bg-sap-errbg text-sap-errtext gap-1">
                  <ArrowUpFromLine size={11} /> IM − / WM − @ GI ZONE
                </span>
              )}
              {mode === 'DIRECT_PLUS' && (
                <span className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext">IM + / WM +</span>
              )}
              {mode === 'DIRECT_MIN' && (
                <span className="sap-badge border-sap-errborder bg-sap-errbg text-sap-errtext">IM − / WM −</span>
              )}
              {isCancel && (
                <span className="sap-badge border-sap-warnborder bg-sap-warnbg text-sap-warntext">
                  REVERSAL — DATA TERKUNCI
                </span>
              )}
            </div>
          </Field>
        </div>

        {isCancel && (
          <div className="mt-3 flex items-start gap-2 px-2.5 py-2 rounded-[2px] border border-sap-warnborder/60 bg-sap-warnbg text-2xs text-sap-warntext">
            <Info size={13} className="shrink-0 mt-[1px]" />
            <span>
              Masukkan nomor material document asal — sistem menentukan movement pembatalan secara
              otomatis (101→102, 201→202, 551→552, 561→562, 701→711, 702→712). Seluruh data (material,
              qty, batch, bin) diambil dari dokumen asal dan <b>tidak dapat diubah</b>. Dokumen yang sudah
              pernah dibatalkan tidak bisa dibatalkan lagi.
            </span>
          </div>
        )}

        {isTwoStep && (
          <div className="mt-3 flex items-start gap-2 px-2.5 py-2 rounded-[2px] border border-sap-blue/40 bg-sap-blue/10 text-2xs text-sap-infotext">
            <Info size={13} className="shrink-0 mt-[1px]" />
            {mode === 'TR_IN' ? (
              <span>
                MIGO hanya memproses level <b>Inventory Management</b>. Stok masuk ke bin interim{' '}
                <b>GR-ZONE</b> dan sistem membuat Transfer Requirement yang sudah dipecah per pallet —
                penentuan rak dilakukan di <Link href="/lb12" className="underline">LB12</Link>.
              </span>
            ) : giMode === 'REQUEST' ? (
              <span>
                Langkah 1 — MIGO 201 membuat <b>permintaan picking</b> (Transfer Requirement). Stok belum
                berkurang. Operator mengambil dari rak di{' '}
                <Link href="/lb12" className="underline">LB12</Link> / ZRF03 sehingga barang berpindah ke bin
                interim GI zone.
              </span>
            ) : (
              <span>
                Langkah 2 — mengeluarkan stok yang sudah <b>dipicking ke GI zone</b>. Stock IM dan WM berkurang
                di sini. Pastikan Transfer Requirement picking-nya sudah dikonfirmasi di{' '}
                <Link href="/lb12" className="underline">LB12</Link>.
              </span>
            )}
          </div>
        )}
      </Panel>

      {/* CANCELLATION PREVIEW */}
      {isCancel && (
        <Panel
          title="Cancellation — Data Dokumen Asal (terkunci)"
          icon={<RotateCcw size={13} className="text-sap-warntext" />}
        >
          {!cancelPreview ? (
            <p className="text-2xs text-sap-muted">
              Masukkan nomor dokumen lalu tekan <b>Tampilkan</b>. Data dokumen asal akan muncul di sini.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-start">
                <Field label="Dokumen Asal">
                  <Input disabled value={cancelPreview.document_number} className="font-mono" />
                </Field>
                <Field label="Movement Asal">
                  <Input disabled value={cancelPreview.movement_label} />
                </Field>
                <Field label="Movement Pembatalan">
                  <Input disabled value={cancelPreview.cancel_label} className="text-sap-warntext" />
                </Field>
                <Field label="Tgl. Dokumen Asal">
                  <Input disabled value={fmtDate(cancelPreview.doc_date)} className="font-mono" />
                </Field>
                <Field label="Reference">
                  <Input disabled value={cancelPreview.reference ?? '—'} />
                </Field>
                <Field label="User Asal">
                  <Input disabled value={cancelPreview.user_id} className="font-mono" />
                </Field>
              </div>

              {/* Pembatalan berlaku PER BARIS: satu baris keliru pada dokumen
                  lima baris bisa dibalik tanpa menyentuh empat baris lainnya. */}
              <div className="border border-sap-border rounded overflow-x-auto">
                <table className="w-full text-2xs">
                  <thead className="bg-sap-thead text-sap-muted">
                    <tr>
                      <th className="p-1 w-8">
                        <input
                          type="checkbox"
                          aria-label="Pilih semua baris"
                          checked={
                            cancelSel.length > 0 &&
                            cancelSel.length ===
                              cancelPreview.lines.filter((l) => l.cancellable).length
                          }
                          onChange={(e) =>
                            setCancelSel(
                              e.target.checked
                                ? cancelPreview.lines
                                    .filter((l) => l.cancellable)
                                    .map((l) => l.line_no)
                                : []
                            )
                          }
                        />
                      </th>
                      <th className="p-1 text-left">Ln</th>
                      <th className="p-1 text-left">Material</th>
                      <th className="p-1 text-left">Deskripsi</th>
                      <th className="p-1 text-right">Qty</th>
                      <th className="p-1 text-left">Batch</th>
                      <th className="p-1 text-left">Source</th>
                      <th className="p-1 text-left">Target</th>
                      <th className="p-1 text-left">Cancel</th>
                      <th className="p-1 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cancelPreview.lines.map((l) => (
                      <tr
                        key={l.line_no}
                        className={`border-t border-sap-border ${l.cancellable ? '' : 'opacity-50'}`}
                      >
                        <td className="p-1 text-center">
                          <input
                            type="checkbox"
                            aria-label={`Batalkan baris ${l.line_no}`}
                            disabled={!l.cancellable}
                            checked={cancelSel.includes(l.line_no)}
                            onChange={() => toggleCancelLine(l.line_no)}
                          />
                        </td>
                        <td className="p-1 font-mono">{l.line_no}</td>
                        <td className="p-1 font-mono">{l.material_code}</td>
                        <td className="p-1">{l.description}</td>
                        <td className="p-1 font-mono text-right">
                          {l.qty.toLocaleString('de-DE')} {l.uom}
                        </td>
                        <td className="p-1 font-mono">{l.batch_number ?? '—'}</td>
                        <td className="p-1 font-mono">{l.source_bin ?? '—'}</td>
                        <td className="p-1 font-mono">{l.target_bin ?? '—'}</td>
                        <td className="p-1 font-mono text-sap-warntext">{l.cancel_code}</td>
                        <td className="p-1 text-sap-muted">
                          {l.cancellable ? 'Dapat dibatalkan' : l.blocked_reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xxs text-sap-muted">
                {cancelSel.length} dari {cancelPreview.lines.length} baris dipilih. Baris yang tidak
                dicentang tetap berlaku.
              </p>

              <Field label="Remarks Pembatalan (opsional)">
                <Input
                  value={cancelRemarks}
                  placeholder={`Cancellation of ${cancelPreview.document_number}`}
                  onChange={(e) => setCancelRemarks(e.target.value)}
                />
              </Field>
            </div>
          )}
        </Panel>
      )}

      {/* ITEM TABLE */}
      {!isCancel && (
      <Panel
        title={`Line Items (${lines.length})`}
        icon={<ClipboardCheck size={13} className="text-sap-blue" />}
        bodyClassName="p-0"
        actions={
          <>
            <span className="hidden lg:inline text-xxs text-sap-muted mr-2">
              Bisa tempel langsung dari Excel — beberapa baris sekaligus
            </span>
            <Button onClick={() => setLines((l) => [...l, emptyLine()])}>
              <Plus size={12} /> New Item
            </Button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="sap-grid min-w-[1180px]">
            <thead>
              <tr>
                <th className="w-[40px] text-center">#</th>
                <th className="w-[180px]">Material</th>
                <th className="w-[210px]">Description</th>
                <th className="w-[95px] text-right">Quantity</th>
                <th className="w-[56px]">UoM</th>
                <th className="w-[140px]">Batch</th>
                {isInbound && <th className="w-[125px]">Mfg. Date</th>}
                {isInbound && <th className="w-[125px]">Exp. Date</th>}
                {isGiIssue && <th className="w-[140px]">TR Reference</th>}
                {mode === 'TR_IN' && <th className="w-[150px]">Packaging</th>}
                {mode === 'TR_IN' && <th className="w-[130px]">Pallet Split</th>}
                {!isTwoStep && <th className="w-[150px]">Storage Bin</th>}
                <th className="w-[150px]">Item Text</th>
                <th className="w-[44px]"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const mat = matMap.get(l.material_code.trim().toUpperCase());
                const batchDisabled = mat ? !mat.is_batch_managed : false;
                const prev = palletPreview(l);
                return (
                  <tr key={l.key}>
                    <td className="text-center font-mono text-sap-muted/60">{i + 1}</td>
                    <td>
                      <Input
                        list="dl-materials"
                        className="uppercase !py-[3px]"
                        value={l.material_code}
                        onChange={(e) => setLine(l.key, { material_code: e.target.value })}
                        onPaste={(e) => handlePaste(e, i, 'material_code')}
                      />
                    </td>
                    <td className="text-sap-muted truncate max-w-[210px]">{mat?.description ?? '—'}</td>
                    <td>
                      <Input
                        type="number"
                        min={1}
                        className="text-right !py-[3px]"
                        value={l.qty}
                        onChange={(e) => setLine(l.key, { qty: e.target.value })}
                        onPaste={(e) => handlePaste(e, i, 'qty')}
                      />
                    </td>
                    <td className="font-mono text-sap-muted">{mat?.uom ?? '—'}</td>
                    <td>
                      <div className="flex items-stretch gap-1">
                        <Input
                          className="uppercase !py-[3px]"
                          disabled={batchDisabled}
                          placeholder={batchDisabled ? 'n/a' : ''}
                          title={
                            isInbound
                              ? `Tanggal terisi otomatis dari batch yang sudah terdaftar, atau dari kode batch ${BATCH_CODE_LENGTH} karakter (mis. G26339 = Juli 2026)`
                              : undefined
                          }
                          value={l.batch_number}
                          onChange={(e) => setLine(l.key, { batch_number: e.target.value })}
                          onPaste={(e) => handlePaste(e, i, 'batch_number')}
                          onBlur={() => {
                            if (isInbound) void loadBatchDates(l);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && isInbound) void loadBatchDates(l);
                          }}
                        />
                        {/* Batch Determination — usulan batch (FEFO) untuk material baris ini */}
                        <button
                          type="button"
                          title={
                            l.material_code.trim()
                              ? 'Batch determination — tampilkan batch yang tersedia (FEFO)'
                              : 'Isi material terlebih dahulu'
                          }
                          disabled={batchDisabled || !l.material_code.trim()}
                          onClick={() => setBatchFor(l)}
                          className="sap-btn !px-1.5 !py-[3px] shrink-0"
                        >
                          <Layers size={12} />
                        </button>
                      </div>
                    </td>
                    {isInbound && (
                      <td>
                        <Input
                          type="date"
                          className="!py-[3px]"
                          title={`Terisi otomatis dari nomor batch, atau dari expired date dikurangi ${DEFAULT_SHELF_LIFE_YEARS} tahun — boleh diubah`}
                          value={l.mfg_date}
                          onChange={(e) => setLine(l.key, { mfg_date: e.target.value })}
                          onPaste={(e) => handlePaste(e, i, 'mfg_date')}
                        />
                      </td>
                    )}
                    {isInbound && (
                      <td>
                        <Input
                          type="date"
                          className="!py-[3px]"
                          value={l.exp_date}
                          onChange={(e) =>
                            setLine(l.key, {
                              exp_date: e.target.value,
                              mfg_date: fillMfg(e.target.value, l.mfg_date),
                            })
                          }
                          onPaste={(e) => handlePaste(e, i, 'exp_date')}
                        />
                      </td>
                    )}
                    {isGiIssue && (
                      <td>
                        <Input
                          className="uppercase !py-[3px]"
                          placeholder="TR00000102"
                          value={l.pack_code}
                          onChange={(e) => setLine(l.key, { pack_code: e.target.value })}
                          onPaste={(e) => handlePaste(e, i, 'pack_code')}
                        />
                      </td>
                    )}
                    {mode === 'TR_IN' && (
                      <td>
                        <Select
                          className="!py-[3px]"
                          value={l.pack_code}
                          onChange={(e) => setLine(l.key, { pack_code: e.target.value })}
                        >
                          <option value="">
                            {mat?.packagings?.length ? '(otomatis)' : 'tanpa palletization'}
                          </option>
                          {(mat?.packagings ?? []).map((p) => (
                            <option key={p.id} value={p.pack_code}>
                              {p.zone_group ?? 'ALL'} · {p.pack_code} · {p.qty_per_unit}
                            </option>
                          ))}
                        </Select>
                      </td>
                    )}
                    {mode === 'TR_IN' && (
                      <td className="font-mono text-xxs">
                        {prev ? (
                          <span className="text-sap-oktext">
                            {prev.lines} line × {prev.per}
                          </span>
                        ) : (
                          <span className="text-sap-muted">1 line</span>
                        )}
                      </td>
                    )}
                    {!isTwoStep && (
                      <td>
                        <Input
                          list="dl-bins"
                          className="uppercase !py-[3px]"
                          value={l.bin}
                          onPaste={(e) => handlePaste(e, i, 'bin')}
                          onChange={(e) => setLine(l.key, { bin: e.target.value })}
                        />
                      </td>
                    )}
                    <td>
                      <Input
                        className="!py-[3px]"
                        value={l.remarks}
                        onPaste={(e) => handlePaste(e, i, 'remarks')}
                        onChange={(e) => setLine(l.key, { remarks: e.target.value })}
                      />
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        title="Delete line"
                        onClick={() =>
                          setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((x) => x.key !== l.key)))
                        }
                        className="text-sap-muted hover:text-sap-error p-1"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      )}

      {/* TOOLBAR */}
      <Toolbar>
        {isCancel ? (
          <>
            <Button variant="danger" onClick={askPost} loading={busy} disabled={!cancelPreview}>
              <Save size={13} /> Post Cancellation
            </Button>
            <Button
              onClick={() => {
                setCancelPreview(null);
                setCancelDoc('');
                setCancelRemarks('');
                setStatus('Cancellation screen has been reset', 'I');
              }}
            >
              <RotateCcw size={13} /> Reset
            </Button>
            <Separator />
            <span className="text-xxs text-sap-muted flex items-center gap-1.5">
              <Info size={12} />
              Stok dikembalikan persis seperti sebelum dokumen asal diposting (qty &amp; batch sama).
            </span>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={askPost} loading={busy}>
              <Save size={13} /> Post
            </Button>
            <Button onClick={reset}>
              <RotateCcw size={13} /> Reset
            </Button>
            <Separator />
            <span className="text-xxs text-sap-muted flex items-center gap-1.5">
              <Info size={12} />
              Enter / F8 = Post (selalu lewat konfirmasi). Semua item diposting dalam satu database
              transaction — bila satu baris gagal, seluruh dokumen dibatalkan.
            </span>
          </>
        )}
      </Toolbar>

      {/* HASIL POSTING */}
      {posted.length > 0 && (
        <Panel
          title="Posting Result"
          icon={<ClipboardCheck size={13} className="text-sap-success" />}
          actions={
            posted.some((d) => d.tr_number) ? (
              <Link href="/lb10" className="sap-btn sap-btn-primary">
                <ArrowRight size={12} /> Buka LB10
              </Link>
            ) : null
          }
        >
          <table className="sap-grid">
            <thead>
              <tr>
                <th className="w-[50px]">Line</th>
                <th className="w-[150px]">Material</th>
                <th className="w-[90px] text-right">Qty</th>
                <th className="w-[150px]">Material Doc.</th>
                <th className="w-[150px]">Transfer Req.</th>
                <th>Next Step</th>
              </tr>
            </thead>
            <tbody>
              {posted.map((d) => (
                <tr key={`${d.line}-${d.material_code}`}>
                  <td className="font-mono text-sap-muted">{d.line}</td>
                  <td className="font-mono">{d.material_code}</td>
                  <td className="text-right font-mono">{d.qty.toLocaleString('de-DE')}</td>
                  <td className="font-mono text-sap-oktext">{d.document_number ?? '—'}</td>
                  <td className="font-mono text-sap-infotext">{d.tr_number ?? '—'}</td>
                  <td className="text-sap-muted">
                    {d.tr_number ? (
                      <Link href={`/lb12?tr=${d.tr_number}`} className="text-sap-blue hover:underline">
                        Proses {d.tr_lines} line di LB12
                      </Link>
                    ) : (
                      'Selesai'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* SEARCH HELP (F4) */}
      <datalist id="dl-materials">
        {materials.map((m) => (
          <option key={m.id} value={m.material_code}>
            {m.description}
          </option>
        ))}
      </datalist>
      <datalist id="dl-bins">
        {bins
          .filter((b) => b.status !== 'BLOCKED')
          .map((b) => (
            <option key={b.id} value={b.bin_code}>
              {b.zone_id} · {b.status}
            </option>
          ))}
      </datalist>

      <p className="text-xxs text-sap-muted/60 px-1 flex items-center gap-1.5">
        <Boxes size={12} /> Tabel palletization diatur di MM01 (material × SU type × kelompok gudang). Bila
        material belum punya baris palletization, qty tidak dipecah dan Transfer Requirement dibuat satu baris.
      </p>

      {/* ---------- KONFIRMASI POSTING (ala SAP) ---------- */}
      <ConfirmDialog
        open={confirmOpen}
        title={isCancel ? 'Konfirmasi Pembatalan' : 'Konfirmasi Posting'}
        danger={isCancel}
        busy={busy}
        confirmLabel={isCancel ? 'Ya, batalkan' : 'Ya, posting'}
        question={
          isCancel
            ? 'Yakin akan membatalkan baris yang dipilih? Stok akan dikembalikan seperti sebelum baris tersebut diposting.'
            : 'Yakin akan memposting dokumen ini? Setelah diposting, stok langsung berubah.'
        }
        details={
          isCancel && cancelPreview
            ? [
                { label: 'Dokumen asal', value: cancelPreview.document_number },
                { label: 'Movement', value: cancelPreview.cancel_label },
                {
                  label: 'Baris dibatalkan',
                  value:
                    `${cancelSel.length} dari ${cancelPreview.lines.length} — ` +
                    `baris ${[...cancelSel].sort((a, b) => a - b).join(', ')}`,
                },
                {
                  label: 'Total quantity',
                  value: cancelPreview.lines
                    .filter((l) => cancelSel.includes(l.line_no))
                    .reduce((a, l) => a + l.qty, 0)
                    .toLocaleString('de-DE'),
                },
              ]
            : [
                { label: 'Movement Type', value: movementLabel },
                ...(mode === 'TR_OUT'
                  ? [
                      {
                        label: 'Langkah 201',
                        value: giMode === 'REQUEST' ? 'Buat permintaan picking' : 'Post goods issue',
                      },
                    ]
                  : []),
                { label: 'Document Date', value: docDate },
                { label: 'Jumlah line', value: `${confirmLines.length} item` },
                { label: 'Total qty', value: confirmQty.toLocaleString('de-DE') },
                ...(showCc ? [{ label: 'Cost Center', value: costCenter || '(warisi dari TR)' }] : []),
                ...(reference ? [{ label: 'Reference', value: reference }] : []),
              ]
        }
        onConfirm={() => {
          if (isCancel) {
            submitCancel();
          } else {
            setConfirmOpen(false);
            submit();
          }
        }}
        onCancel={() => setConfirmOpen(false)}
      />

      {/* ---------- BATCH DETERMINATION ---------- */}
      <BatchDetermination
        open={!!batchFor}
        material={batchFor?.material_code.trim().toUpperCase() ?? ''}
        description={matMap.get(batchFor?.material_code.trim().toUpperCase() ?? '')?.description}
        /* untuk goods issue dari GI zone, stok justru ada di bin interim */
        includeInterim={isGiIssue}
        onPick={(b) => {
          if (!batchFor) return;
          setLine(batchFor.key, {
            batch_number: b.batch_number,
            ...(isInbound && b.exp_date ? { exp_date: b.exp_date.slice(0, 10) } : {}),
            ...(!isTwoStep && b.bins[0] ? { bin: b.bins[0].bin_code } : {}),
          });
          setStatus(
            `Batch ${b.batch_number} dipilih (${b.total_qty.toLocaleString('de-DE')} ${b.uom} tersedia)`,
            'S'
          );
        }}
        onClose={() => setBatchFor(null)}
      />
    </div>
  );
}
