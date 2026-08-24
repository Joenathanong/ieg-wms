'use client';

import { useRef, useState } from 'react';
import { Layers, Search, ArrowLeftRight, MapPin } from 'lucide-react';
import { PdtScreen, PdtInput, PdtButton, PdtRow, PdtMessage } from '@/components/pdt/ui';
import { api, post, qs, fmtDate } from '@/lib/client';
import { parseScan, resolveScan } from '@/lib/barcode';

/**
 * ZRF08 hanya melayani replenishment di Gudang Besar: stok berpindah dari
 * Heavy Duty Racking ke pick bin, keduanya berada di kelompok gudang BESAR.
 * Menampilkan stok Gudang Kecil di sini hanya menambah baris yang tidak akan
 * pernah dipilih operator.
 */
const ZONE_GROUP = 'BESAR';

/*
 * Catatan bila stok gudang lain masih ikut muncul: penyaringan ini memakai
 * KELOMPOK GUDANG pada master zona (ZZONE), bukan nama zonanya. Zona bernama
 * "GUDANG-KECIL" tetap dianggap Gudang Besar bila kolom Kelompok Gudang-nya
 * berisi BESAR. Periksa kolom itu di ZZONE, bukan kode zonanya.
 */

interface Quant {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  batch_number: string;
  zone_id: string;
  mfg_date: string | null;
  exp_date: string | null;
  gr_date: string | null;
  qty: number;
  bin_code: string;
  fix_bin: string | null;
}

/**
 * ZRF08 — Replenishment.
 * Sama dengan ZRF04 (bin-to-bin 301) tetapi menampilkan LIST dulu (ala ZRF06):
 * scan BIN atau MATERIAL -> daftar stok urut FEFO (ED terdekat paling atas)
 * -> pilih -> tampil detail + input qty + S-Bin tujuan (saran: Fix Bin material).
 */
export default function ZrfReplenishPage() {
  const [binScan, setBinScan] = useState('');
  const [matScan, setMatScan] = useState('');
  const [quants, setQuants] = useState<Quant[]>([]);
  const [sel, setSel] = useState<Quant | null>(null);
  const [qty, setQty] = useState('');
  const [targetBin, setTargetBin] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'S' | 'E' | 'W' | 'I' } | null>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  async function run() {
    const binQ = binScan.trim().toUpperCase();
    const rawMat = matScan.trim();
    if (!binQ && !rawMat) return setMsg({ text: 'Scan bin ATAU material terlebih dahulu', type: 'E' });

    setLoading(true);
    setSel(null);

    /**
     * Dua perlakuan berbeda, ditentukan dari bentuk isiannya:
     *
     *  - HASIL SCAN (compound ';' atau EAN) -> dicocokkan PERSIS lewat
     *    parameter `material`. Barcode sudah menunjuk satu material tertentu,
     *    jadi pencocokan longgar justru berbahaya di PDT: kode lain yang
     *    kebetulan mengandung potongan yang sama ikut muncul.
     *
     *  - DIKETIK MANUAL -> dicari bebas lewat parameter `q`, yang mencocokkan
     *    ke kode MAUPUN nama barang dan mendukung wildcard '*'. Ini yang
     *    membuat "sabun" atau "*glacier*" bisa dipakai, sama seperti ZRF06.
     */
    let exactMat = '';
    let freeText = '';
    if (rawMat) {
      const kind = parseScan(rawMat).kind;
      if (kind === 'PLAIN') {
        freeText = rawMat;
      } else {
        const rs = await resolveScan(rawMat);
        if (!rs.ok) {
          setLoading(false);
          return setMsg({ text: rs.message ?? 'Barcode tidak dikenal', type: 'E' });
        }
        exactMat = rs.material_code;
        if (exactMat !== rawMat.toUpperCase()) setMatScan(exactMat);
      }
    }

    const r = await api<Quant[]>(
      '/api/stock/quants' +
        qs({
          bin: binQ,
          material: exactMat,
          q: freeText,
          exclInterim: 1,
          zoneGroup: ZONE_GROUP,
        })
    );
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });

    // Urut FEFO:
    //   1) expired date terdekat di paling atas (tanpa ED selalu di bawah)
    //   2) bila ED SAMA -> qty paling kecil dulu, supaya sisa kecil habis lebih dahulu
    //   3) terakhir urut bin agar hasilnya stabil
    const rows = [...(r.data ?? [])].sort((a, b) => {
      const ea = a.exp_date ? new Date(a.exp_date).getTime() : Infinity;
      const eb = b.exp_date ? new Date(b.exp_date).getTime() : Infinity;
      if (ea !== eb) return ea - eb;
      if (a.qty !== b.qty) return a.qty - b.qty;
      return a.bin_code.localeCompare(b.bin_code, 'id', { numeric: true });
    });
    setQuants(rows);
    setMsg({
      text:
        rows.length > 0
          ? `${rows.length} stok Gudang Besar ditemukan — urut FEFO (ED sama: qty terkecil dulu)`
          : 'Tidak ada stok Gudang Besar untuk kriteria ini',
      type: rows.length > 0 ? 'S' : 'W',
    });
  }

  function pick(q: Quant) {
    setSel(q);
    setQty(String(q.qty));
    setTargetBin(q.fix_bin ?? '');
    setMsg(
      q.fix_bin
        ? { text: `Saran S-Bin tujuan: ${q.fix_bin} (Fix Bin material)`, type: 'I' }
        : { text: 'Material belum punya Fix Bin (MM01) — scan bin tujuan manual', type: 'W' }
    );
    setTimeout(() => targetRef.current?.focus(), 50);
  }

  async function submit() {
    if (!sel) return setMsg({ text: 'Pilih stok yang akan dipindah', type: 'E' });
    const n = Number(qty);
    if (!n || n <= 0) return setMsg({ text: 'Quantity tidak valid', type: 'E' });
    if (n > sel.qty) return setMsg({ text: `Maksimum ${sel.qty}`, type: 'E' });
    if (!targetBin.trim()) return setMsg({ text: 'Scan S-Bin tujuan', type: 'E' });

    setBusy(true);
    const r = await post('/api/transfer', {
      via_pdt: true,
      items: [
        {
          material_code: sel.material_code,
          qty: n,
          batch_number: sel.batch_number || null,
          source_bin: sel.bin_code,
          target_bin: targetBin.trim().toUpperCase(),
        },
      ],
    });
    setBusy(false);
    setMsg({ text: r.message, type: r.ok ? 'S' : 'E' });
    if (r.ok) {
      setSel(null);
      setQty('');
      setTargetBin('');
      run();
    }
  }

  return (
    <PdtScreen
      title="Replenishment"
      code="ZRF08"
      footer={
        <p className="text-xxs text-sap-muted">
          Hanya menampilkan stok <b>Gudang Besar</b>. List urut <b>FEFO</b> — expired date terdekat
          paling atas; bila ED sama, <b>qty terkecil</b> didahulukan agar sisa kecil cepat habis.
          S-Bin tujuan disarankan dari <b>Fix Bin</b> material (MM01), tetap boleh diganti.
        </p>
      }
    >
      {msg && <PdtMessage text={msg.text} type={msg.type} />}

      <PdtInput
        label="Scan bin asal"
        autoFocus
        value={binScan}
        onChange={(e) => setBinScan(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && run()}
      />
      <PdtInput
        label="atau scan / ketik material"
        value={matScan}
        onChange={(e) => setMatScan(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && run()}
        hint="scan barcode, atau ketik kode / nama barang — mis. sabun, *glacier*"
      />
      <PdtButton variant="primary" onClick={run} loading={loading}>
        <Search size={16} /> Tampilkan list (FEFO)
      </PdtButton>

      {quants.length > 0 && !sel && (
        <div className="space-y-1.5 max-h-[38dvh] overflow-auto">
          {quants.map((q, i) => (
            <button
              key={q.id}
              type="button"
              onClick={() => pick(q)}
              className="w-full text-left rounded-[3px] border border-sap-border bg-sap-panelalt px-3 py-2 hover:border-sap-blue/60"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-mono text-sm text-sap-blue">{q.material_code}</p>
                {i === 0 && q.exp_date && (
                  <span className="sap-badge border-sap-warnborder bg-sap-warnbg text-sap-warntext shrink-0">
                    FEFO 1st
                  </span>
                )}
                {i > 0 &&
                  q.exp_date &&
                  quants[i - 1]?.exp_date === q.exp_date && (
                    <span className="sap-badge border-sap-neutralborder bg-sap-neutralbg text-sap-muted shrink-0">
                      ED sama
                    </span>
                  )}
              </div>
              <p className="text-2xs text-sap-text truncate">{q.description}</p>
              <p className="text-xxs text-sap-muted font-mono">
                {q.bin_code} · {q.zone_id} · {q.batch_number || 'no batch'} · {q.qty} {q.uom}
                {q.exp_date ? ` · ED ${fmtDate(q.exp_date)}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      {sel && (
        <>
          <div className="rounded-[3px] border border-sap-blue/40 bg-sap-blue/10 px-3 py-2">
            <PdtRow label="Material" value={sel.material_code} accent />
            <PdtRow label="Deskripsi" value={sel.description} />
            {sel.batch_number && <PdtRow label="Batch" value={sel.batch_number} />}
            {sel.exp_date && <PdtRow label="Expired" value={fmtDate(sel.exp_date)} />}
            <PdtRow label="Tersedia" value={`${sel.qty} ${sel.uom}`} />
            <PdtRow label="Dari bin" value={sel.bin_code} />
            {sel.fix_bin && (
              <PdtRow
                label="Fix Bin"
                value={
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={12} className="text-sap-blue" /> {sel.fix_bin}
                  </span>
                }
                accent
              />
            )}
          </div>

          <PdtInput
            label="Quantity"
            type="number"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <PdtInput
            ref={targetRef}
            label="S-Bin tujuan"
            value={targetBin}
            onChange={(e) => setTargetBin(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            hint={sel.fix_bin ? `Saran: ${sel.fix_bin} (Fix Bin)` : 'Material tanpa Fix Bin — isi manual'}
          />

          <div className="grid grid-cols-2 gap-2">
            <PdtButton onClick={() => setSel(null)}>Batal</PdtButton>
            <PdtButton variant="primary" onClick={submit} loading={busy}>
              <ArrowLeftRight size={16} /> Transfer
            </PdtButton>
          </div>
        </>
      )}

      {quants.length === 0 && !loading && !sel && (
        <p className="text-2xs text-sap-muted text-center py-2 flex items-center justify-center gap-1.5">
          <Layers size={14} /> Scan bin asal, atau ketik kode / nama barang.
        </p>
      )}
    </PdtScreen>
  );
}
