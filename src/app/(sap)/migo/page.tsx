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
} from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Separator } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData } from '@/components/sap/hooks';
import { post } from '@/lib/client';
import { ZONE_GROUPS } from '@/lib/zones';

/* --------------------------------------------------------------- */

const MOVEMENTS = [
  { code: '101', label: '101 — Goods Receipt (GR)', mode: 'TR_IN' },
  { code: '201', label: '201 — Goods Issue (GI)', mode: 'TR_OUT' },
  { code: '551', label: '551 — Scrapping / Adjustment (-)', mode: 'DIRECT_MIN' },
  { code: '701', label: '701 — Phys. Inv. Difference (+)', mode: 'DIRECT_PLUS' },
  { code: '702', label: '702 — Phys. Inv. Difference (-)', mode: 'DIRECT_MIN' },
] as const;

type Mode = (typeof MOVEMENTS)[number]['mode'];

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

  const [movement, setMovement] = useState<string>('101');
  const [giMode, setGiMode] = useState<'REQUEST' | 'ISSUE'>('REQUEST');
  const [zoneGroup, setZoneGroup] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<PostedDoc[]>([]);

  const mode: Mode = MOVEMENTS.find((m) => m.code === movement)?.mode ?? 'TR_IN';
  const isGiIssue = mode === 'TR_OUT' && giMode === 'ISSUE';
  // ISSUE mengeluarkan stok dari bin interim GI, jadi tidak perlu input bin manual
  const isTwoStep = mode === 'TR_IN' || mode === 'TR_OUT';
  const isInbound = mode === 'TR_IN' || mode === 'DIRECT_PLUS';

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
    setPosted([]);
    setStatus('Entry screen has been reset', 'I');
  }

  async function submit() {
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

    if (items.length === 0) return setStatus('Enter at least one line item', 'E');
    for (const [i, it] of items.entries()) {
      if (!it.material_code) return setStatus(`Line ${i + 1}: material number is missing`, 'E');
      if (!it.qty || it.qty <= 0) return setStatus(`Line ${i + 1}: quantity must be greater than zero`, 'E');
      if (!isTwoStep && !it.bin) return setStatus(`Line ${i + 1}: storage bin is missing`, 'E');
    }

    setBusy(true);
    const r = await post('/api/migo', {
      movement_type: movement,
      doc_date: docDate,
      reference,
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

  return (
    <div className="space-y-3">
      {/* HEADER DATA */}
      <Panel title="MIGO — Goods Movement · Header Data" icon={<PackagePlus size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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

          <Field label="Document Date" required>
            <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </Field>

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

          <Field label="Reference / Delivery Note">
            <Input
              value={reference}
              placeholder="mis. DO-2026-00123"
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>

          <Field label="Processing Level">
            <div className="flex items-center gap-2 h-[27px]">
              {mode === 'TR_IN' && (
                <span className="sap-badge border-[#2c5c3d] bg-[#1e3a29] text-[#8FE0A4] gap-1">
                  <ArrowDownToLine size={11} /> IM + → GR ZONE
                </span>
              )}
              {mode === 'TR_OUT' && giMode === 'REQUEST' && (
                <span className="sap-badge border-[#2b5480] bg-[#1c3450] text-[#9DC0FF] gap-1">
                  <ArrowUpFromLine size={11} /> REQUEST ONLY
                </span>
              )}
              {mode === 'TR_OUT' && giMode === 'ISSUE' && (
                <span className="sap-badge border-[#7f2529] bg-[#3d1a1c] text-[#FF9CA0] gap-1">
                  <ArrowUpFromLine size={11} /> IM − / WM − @ GI ZONE
                </span>
              )}
              {mode === 'DIRECT_PLUS' && (
                <span className="sap-badge border-[#2c5c3d] bg-[#1e3a29] text-[#8FE0A4]">IM + / WM +</span>
              )}
              {mode === 'DIRECT_MIN' && (
                <span className="sap-badge border-[#7f2529] bg-[#3d1a1c] text-[#FF9CA0]">IM − / WM −</span>
              )}
            </div>
          </Field>
        </div>

        {isTwoStep && (
          <div className="mt-3 flex items-start gap-2 px-2.5 py-2 rounded-[2px] border border-sap-blue/40 bg-sap-blue/10 text-2xs text-[#9DC0FF]">
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

      {/* ITEM TABLE */}
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
                      <Input
                        className="uppercase !py-[3px]"
                        disabled={batchDisabled}
                        placeholder={batchDisabled ? 'n/a' : ''}
                        value={l.batch_number}
                        onChange={(e) => setLine(l.key, { batch_number: e.target.value })}
                      />
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
                          <span className="text-[#8FE0A4]">
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

      {/* TOOLBAR */}
      <Toolbar>
        <Button variant="primary" onClick={submit} loading={busy}>
          <Save size={13} /> Post
        </Button>
        <Button onClick={reset}>
          <RotateCcw size={13} /> Reset
        </Button>
        <Separator />
        <span className="text-xxs text-sap-muted flex items-center gap-1.5">
          <Info size={12} />
          Semua item diposting dalam satu database transaction — bila satu baris gagal, seluruh dokumen dibatalkan.
        </span>
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
                  <td className="font-mono text-[#8FE0A4]">{d.document_number ?? '—'}</td>
                  <td className="font-mono text-[#9DC0FF]">{d.tr_number ?? '—'}</td>
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
    </div>
  );
}
