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
import { ZONE_GROUPS } from '@/lib/zones';

/* --------------------------------------------------------------- */

const MOVEMENTS = [
  { code: '101', label: '101 — Goods Receipt (GR)', mode: 'TR_IN' },
  { code: '201', label: '201 — Goods Issue (Cost Center)', mode: 'TR_OUT' },
  { code: '601', label: '601 — Goods Issue (Penjualan)', mode: 'DIRECT_MIN' },
  { code: '551', label: '551 — Scrapping / Adjustment (-)', mode: 'DIRECT_MIN' },
  { code: '701', label: '701 — Phys. Inv. Difference (+)', mode: 'DIRECT_PLUS' },
  { code: '702', label: '702 — Phys. Inv. Difference (-)', mode: 'DIRECT_MIN' },
  { code: 'CANCEL', label: 'Cancellation — 102 / 202 / 552 / 562 / 711 / 712', mode: 'CANCEL' },
] as const;

type Mode = (typeof MOVEMENTS)[number]['mode'];

interface CancelPreview {
  document_number: string;
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
  doc_date: string;
  reference: string | null;
  tr_number: string | null;
  user_id: string;
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

  const [movement, setMovement] = useState<string>('101');
  const [giMode, setGiMode] = useState<'REQUEST' | 'ISSUE'>('REQUEST');
  const [zoneGroup, setZoneGroup] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<PostedDoc[]>([]);

  // --- mode CANCELLATION ---
  const [cancelDoc, setCancelDoc] = useState('');
  const [cancelPreview, setCancelPreview] = useState<CancelPreview | null>(null);
  const [cancelRemarks, setCancelRemarks] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);

  // --- konfirmasi posting & batch determination ---
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [batchFor, setBatchFor] = useState<Line | null>(null);

  const mode: Mode = MOVEMENTS.find((m) => m.code === movement)?.mode ?? 'TR_IN';
  const isGiIssue = mode === 'TR_OUT' && giMode === 'ISSUE';
  // ISSUE mengeluarkan stok dari bin interim GI, jadi tidak perlu input bin manual
  const isTwoStep = mode === 'TR_IN' || mode === 'TR_OUT';
  const isInbound = mode === 'TR_IN' || mode === 'DIRECT_PLUS';
  const isCancel = mode === 'CANCEL';
  // 201 tahap ISSUE membebankan biaya ke cost center; 601 (penjualan) tidak.
  const needsCc = mode === 'TR_OUT' && giMode === 'ISSUE';

  async function loadCancelPreview() {
    const doc = cancelDoc.trim().toUpperCase();
    if (!doc) return setStatus('Masukkan nomor material document yang akan dibatalkan', 'E');
    setCancelLoading(true);
    setCancelPreview(null);
    const r = await api<CancelPreview>(`/api/migo/cancel?doc=${encodeURIComponent(doc)}`);
    setCancelLoading(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok && r.data) setCancelPreview(r.data);
  }

  async function submitCancel() {
    if (!cancelPreview) return setStatus('Tampilkan dokumen terlebih dahulu', 'E');
    setBusy(true);
    setConfirmOpen(false);
    const r = await post('/api/migo/cancel', {
      document_number: cancelPreview.document_number,
      remarks: cancelRemarks,
    });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setCancelPreview(null);
      setCancelDoc('');
      setCancelRemarks('');
    }
  }

  const matMap = useMemo(() => new Map(materials.map((m) => [m.material_code, m])), [materials]);

  function setLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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
    if (isCancel) {
      if (!cancelPreview) return setStatus('Tampilkan dokumen terlebih dahulu', 'E');
      return setConfirmOpen(true);
    }
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
      ...(needsCc ? { cost_center: costCenter } : {}),
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
                setMovement(e.target.value);
                setPosted([]);
              }}
            >
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
            <Field label="Gudang Tujuan" hint="menentukan baris palletization yang dipakai">
              <Select value={zoneGroup} onChange={(e) => setZoneGroup(e.target.value)}>
                <option value="">(pakai default material)</option>
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
              <Select value={giMode} onChange={(e) => setGiMode(e.target.value as 'REQUEST' | 'ISSUE')}>
                <option value="REQUEST">1 — Buat permintaan picking (Transfer Requirement)</option>
                <option value="ISSUE">2 — Post goods issue dari GI zone</option>
              </Select>
            </Field>
          )}

          {needsCc && (
            <Field
              label="Cost Center"
              required
              hint={
                costCenters.find((c) => c.cost_center === costCenter)?.description ??
                'Tujuan pembebanan biaya — dikelola di KS01'
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
            <Field label="Reference / Delivery Note">
              <Input
                value={reference}
                placeholder="mis. DO-2026-00123"
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
                <Field label="Material">
                  <Input disabled value={cancelPreview.material_code} className="font-mono" />
                </Field>
                <Field label="Deskripsi">
                  <Input disabled value={cancelPreview.description} />
                </Field>
                <Field label="Quantity">
                  <Input
                    disabled
                    value={`${cancelPreview.qty.toLocaleString('de-DE')} ${cancelPreview.uom}`}
                    className="font-mono text-right"
                  />
                </Field>
                <Field label="Batch">
                  <Input disabled value={cancelPreview.batch_number ?? '—'} className="font-mono" />
                </Field>
                <Field label="Source Bin">
                  <Input disabled value={cancelPreview.source_bin ?? '—'} className="font-mono" />
                </Field>
                <Field label="Target Bin">
                  <Input disabled value={cancelPreview.target_bin ?? '—'} className="font-mono" />
                </Field>
                <Field label="Reference">
                  <Input disabled value={cancelPreview.reference ?? '—'} />
                </Field>
                <Field label="User Asal">
                  <Input disabled value={cancelPreview.user_id} className="font-mono" />
                </Field>
              </div>
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
          <Button onClick={() => setLines((l) => [...l, emptyLine()])}>
            <Plus size={12} /> New Item
          </Button>
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
                      />
                    </td>
                    <td className="font-mono text-sap-muted">{mat?.uom ?? '—'}</td>
                    <td>
                      <div className="flex items-stretch gap-1">
                        <Input
                          className="uppercase !py-[3px]"
                          disabled={batchDisabled}
                          placeholder={batchDisabled ? 'n/a' : ''}
                          value={l.batch_number}
                          onChange={(e) => setLine(l.key, { batch_number: e.target.value })}
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
                          value={l.mfg_date}
                          onChange={(e) => setLine(l.key, { mfg_date: e.target.value })}
                        />
                      </td>
                    )}
                    {isInbound && (
                      <td>
                        <Input
                          type="date"
                          className="!py-[3px]"
                          value={l.exp_date}
                          onChange={(e) => setLine(l.key, { exp_date: e.target.value })}
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
                          onChange={(e) => setLine(l.key, { bin: e.target.value })}
                        />
                      </td>
                    )}
                    <td>
                      <Input
                        className="!py-[3px]"
                        value={l.remarks}
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
            ? 'Yakin akan membatalkan dokumen ini? Stok akan dikembalikan seperti sebelum dokumen asal diposting.'
            : 'Yakin akan memposting dokumen ini? Setelah diposting, stok langsung berubah.'
        }
        details={
          isCancel && cancelPreview
            ? [
                { label: 'Dokumen asal', value: cancelPreview.document_number },
                { label: 'Movement', value: cancelPreview.cancel_label },
                { label: 'Material', value: `${cancelPreview.material_code} · ${cancelPreview.description}` },
                {
                  label: 'Quantity',
                  value: `${cancelPreview.qty.toLocaleString('de-DE')} ${cancelPreview.uom}`,
                },
                { label: 'Batch', value: cancelPreview.batch_number ?? '—' },
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
                ...(needsCc ? [{ label: 'Cost Center', value: costCenter || '—' }] : []),
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
