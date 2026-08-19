'use client';

import { useRef, useState } from 'react';
import { PackagePlus, Save, RotateCcw } from 'lucide-react';
import { PdtScreen, PdtInput, PdtButton, PdtRow, PdtMessage } from '@/components/pdt/ui';
import { useMasterData } from '@/components/sap/hooks';
import { api, post, fmtDate } from '@/lib/client';
import { parseBatchCode } from '@/lib/batchcode';
import { resolveScan } from '@/lib/barcode';
import { fillMfg, DEFAULT_SHELF_LIFE_YEARS } from '@/lib/shelflife';
import { useScanGun } from '@/lib/scanner';

interface BatchInfo {
  /** true = batch sudah pernah terdaftar (tanggalnya pasti) */
  found: boolean;
  /** STOCK = dari batch yang ada, CODE = dibaca dari pola nomor batch */
  source?: 'STOCK' | 'CODE' | 'NONE';
  mfg_date?: string | null;
  exp_date?: string | null;
  on_hand?: number;
}

export default function ZrfGrPage() {
  const { materials } = useMasterData();
  const matRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLInputElement>(null);
  const expRef = useRef<HTMLInputElement>(null);

  const [material, setMaterial] = useState('');
  const [qty, setQty] = useState('');
  const [batch, setBatch] = useState('');
  const [expDate, setExpDate] = useState('');
  const [mfgDate, setMfgDate] = useState('');
  const [reference, setReference] = useState('');
  const [knownBatch, setKnownBatch] = useState<BatchInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'S' | 'E' | 'W' | 'I' } | null>(null);

  const mat = materials.find((m) => m.material_code === material.trim().toUpperCase());
  const pack = mat?.packagings?.find((p) => p.is_default) ?? mat?.packagings?.[0];
  const splitLines = pack && Number(qty) > 0 ? Math.ceil(Number(qty) / pack.qty_per_unit) : 0;

  /**
   * Tanggal batch diisi otomatis dari dua sumber, ditentukan server:
   *   1. batch yang SUDAH pernah terdaftar -> tanggalnya dipakai ulang, supaya
   *      satu nomor batch tidak berakhir dengan dua tanggal kedaluwarsa berbeda;
   *   2. batch baru berpola 6 karakter (mis. G26339) -> tanggal dibaca dari
   *      kodenya: huruf = bulan, 2 digit berikutnya = tahun produksi.
   *
   * Hanya sumber (1) yang membuat batch dianggap "dikenal" — hasil pembacaan
   * kode tetap perkiraan, jadi expired date tetap wajib dikonfirmasi operator.
   * Isian manual operator tidak pernah ditimpa.
   */
  async function loadBatchDates(mCode: string, bCode: string) {
    const m = mCode.trim().toUpperCase();
    const b = bCode.trim().toUpperCase();
    if (!m || !b) return setKnownBatch(null);

    const r = await api<BatchInfo>(
      `/api/materials/batch?material=${encodeURIComponent(m)}&batch=${encodeURIComponent(b)}`
    );
    const info = r.ok ? r.data ?? null : null;
    setKnownBatch(info?.found ? info : null);

    let exp = info?.exp_date ? String(info.exp_date).slice(0, 10) : '';
    let mfg = info?.mfg_date ? String(info.mfg_date).slice(0, 10) : '';

    // Pola nomor batch dihitung di perangkat, tanpa server — supaya di PDT
    // pengisian otomatis tetap jalan walau jaringannya sedang buruk.
    if (!exp && !mfg) {
      const code = parseBatchCode(b);
      if (code) {
        exp = code.exp_date;
        mfg = code.mfg_date;
      }
    }
    if (!exp && !mfg) return;

    setExpDate((v) => v || exp);
    setMfgDate((v) => v || mfg);
    if (exp) {
      setMsg({
        text: info?.found
          ? `Batch ${b} sudah terdaftar — ED ${fmtDate(exp)} terisi otomatis.`
          : `Batch ${b} baru — ED ${fmtDate(exp)} dibaca dari nomor batch, periksa lagi.`,
        type: 'I',
      });
    }
  }

  /**
   * Handle hasil scan barcode pada field material:
   * - "MAT;BATCH;..." -> material + batch langsung terisi
   * - EAN polos      -> lookup barcode B-POM / produk di master data
   *
   * Bila cocok, fokus langsung lompat ke Quantity supaya operator bisa
   * scan -> ketik jumlah -> post tanpa menyentuh layar.
   */
  async function handleMaterialScan(raw?: string) {
    const value = (raw ?? material).trim();
    if (!value) return;
    const rs = await resolveScan(value);
    if (!rs.ok) {
      setMsg({ text: rs.message ?? 'Barcode tidak dikenal', type: 'E' });
      setMaterial('');
      return;
    }

    setMaterial(rs.material_code);
    const found = materials.find((m) => m.material_code === rs.material_code);

    if (rs.batch_number) {
      setBatch(rs.batch_number);
      await loadBatchDates(rs.material_code, rs.batch_number);
    }

    setMsg({
      text: rs.message ?? `${rs.material_code} — ${found?.description ?? 'material dikenali'}`,
      type: 'S',
    });

    // Tujuan fokus dihitung dari hasil scan LANGSUNG, bukan dari state — state
    // hasil setMaterial/setBatch belum ter-commit saat baris ini berjalan.
    const nextBatch = (rs.batch_number ?? batch).trim();
    const needBatch = !!found?.is_batch_managed && !nextBatch;
    const target = needBatch ? batchRef : qtyRef;
    setTimeout(() => target.current?.focus(), 30);
  }

  /** Barcode dari scanner fisik — tidak perlu ada field yang difokuskan. */
  useScanGun((code) => {
    setMaterial(code.split(';')[0].toUpperCase());
    handleMaterialScan(code);
  }, !busy);

  /**
   * Lompat ke field berikutnya yang benar-benar perlu diisi.
   * Field yang sudah terisi otomatis dari hasil scan dilewati; kalau tidak ada
   * lagi yang kosong, fokus dilepas supaya keyboard virtual tertutup.
   */
  function focusNextNeeded(from: 'material' | 'batch' | 'qty' | 'exp') {
    const needBatch = !!mat?.is_batch_managed && !batch.trim();
    const needQty = !qty.trim();
    const needExp = !knownBatch?.found && !expDate.trim();

    const chain: { after: string[]; need: boolean; ref: React.RefObject<HTMLInputElement | null> }[] = [
      { after: ['material'], need: needBatch, ref: batchRef },
      { after: ['material', 'batch'], need: needQty, ref: qtyRef },
      { after: ['material', 'batch', 'qty'], need: needExp, ref: expRef },
    ];

    const next = chain.find((c) => c.after.includes(from) && c.need);
    if (next?.ref.current) {
      setTimeout(() => next.ref.current?.focus(), 30);
      return;
    }
    // Tidak ada lagi yang wajib -> lepas fokus supaya keyboard tertutup.
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function reset() {
    setMaterial('');
    setQty('');
    setBatch('');
    setExpDate('');
    setMfgDate('');
    setReference('');
    setKnownBatch(null);
    setMsg(null);
  }

  async function submit() {
    if (!material.trim()) return setMsg({ text: 'Scan material terlebih dahulu', type: 'E' });
    if (!Number(qty)) return setMsg({ text: 'Quantity belum diisi', type: 'E' });
    if (mat?.is_batch_managed && !batch.trim())
      return setMsg({ text: `Material ${mat.material_code} wajib batch`, type: 'E' });

    setBusy(true);
    const r = await post('/api/migo', {
      movement_type: '101',
      reference,
      items: [
        {
          material_code: material.trim().toUpperCase(),
          qty: Number(qty),
          batch_number: batch.trim().toUpperCase() || null,
          exp_date: expDate || null,
          mfg_date: mfgDate || null,
        },
      ],
    });
    setBusy(false);
    setMsg({ text: r.message, type: r.ok ? 'S' : 'E' });
    if (r.ok) {
      // seluruh field dikosongkan supaya siap scan berikutnya tanpa sisa data
      setMaterial('');
      setQty('');
      setBatch('');
      setExpDate('');
      setMfgDate('');
      setReference('');
      setKnownBatch(null);
      // fokus tidak dikembalikan otomatis: keyboard virtual tidak ikut terbuka
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }

  return (
    <PdtScreen
      title="Goods Receipt"
      code="ZRF01"
      footer={
        <p className="text-xxs text-sap-muted">
          Barang masuk ke GR zone. Simpan ke rak lewat <b>ZRF02 Put-away</b>.
        </p>
      }
    >
      {msg && <PdtMessage text={msg.text} type={msg.type} />}

      <PdtInput
        ref={matRef}
        label="Material"
        list="dl-pdt-mat"
        value={material}
        onChange={(e) => setMaterial(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleMaterialScan();
          }
        }}
        onBlur={() => {
          // hanya diproses bila materialnya belum dikenali — mencegah kode
          // material hasil scan dibaca ulang sebagai barcode
          if (!mat && material.trim()) handleMaterialScan();
        }}
        hint={mat ? mat.description : 'Boleh diketik manual, atau langsung di-scan.'}
      />
      {mat && (
        <div className="rounded-[3px] border border-sap-border bg-sap-panelalt px-3 py-2">
          <PdtRow label="Deskripsi" value={mat.description} />
          <PdtRow label="UoM" value={mat.uom} />
          <PdtRow label="Batch" value={mat.is_batch_managed ? 'WAJIB' : 'tidak dipakai'} />
          {pack && <PdtRow label="Pallet" value={`${pack.pack_code} = ${pack.qty_per_unit}`} accent />}
        </div>
      )}

      <PdtInput
        ref={qtyRef}
        label="Quantity"
        type="number"
        inputMode="numeric"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            focusNextNeeded('qty');
          }
        }}
        hint={splitLines > 1 ? `Akan dipecah menjadi ${splitLines} pallet` : undefined}
      />

      <PdtInput
        ref={batchRef}
        label="Batch"
        disabled={!!mat && !mat.is_batch_managed}
        value={batch}
        onChange={(e) => setBatch(e.target.value.toUpperCase())}
        onBlur={() => loadBatchDates(material, batch)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            loadBatchDates(material, batch).then(() => focusNextNeeded('batch'));
          }
        }}
        hint={
          knownBatch?.found
            ? `Batch dikenal — stok tercatat ${knownBatch.on_hand ?? 0}`
            : 'Batch baru: isi expired date di bawah'
        }
      />

      <PdtInput
        ref={expRef}
        label="Expired Date"
        type="date"
        value={expDate}
        onChange={(e) => {
          setExpDate(e.target.value);
          setMfgDate((m) => fillMfg(e.target.value, m));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            focusNextNeeded('exp');
          }
        }}
      />
      <PdtInput
        label="Manufacturing Date"
        type="date"
        hint={`Terisi otomatis: expired date dikurangi ${DEFAULT_SHELF_LIFE_YEARS} tahun.`}
        value={mfgDate}
        onChange={(e) => setMfgDate(e.target.value)}
      />

      <PdtInput
        label="Reference / DO"
        value={reference}
        onChange={(e) => setReference(e.target.value.toUpperCase())}
      />

      <div className="grid grid-cols-2 gap-2 pt-1">
        <PdtButton onClick={reset}>
          <RotateCcw size={16} /> Reset
        </PdtButton>
        <PdtButton variant="primary" onClick={submit} loading={busy}>
          <Save size={16} /> Post
        </PdtButton>
      </div>

      <datalist id="dl-pdt-mat">
        {materials.map((m) => (
          <option key={m.id} value={m.material_code}>
            {m.description}
          </option>
        ))}
      </datalist>
    </PdtScreen>
  );
}
