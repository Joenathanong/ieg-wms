'use client';

import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Separator, Badge } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData } from '@/components/sap/hooks';
import { post } from '@/lib/client';

/* --------------------------------------------------------------- */

const MOVEMENTS = [
  { code: '101', label: '101 — Goods Receipt (GR)', dir: 'IN' },
  { code: '201', label: '201 — Goods Issue (GI)', dir: 'OUT' },
  { code: '551', label: '551 — Scrapping / Adjustment (-)', dir: 'OUT' },
  { code: '701', label: '701 — Phys. Inv. Difference (+)', dir: 'IN' },
  { code: '702', label: '702 — Phys. Inv. Difference (-)', dir: 'OUT' },
] as const;

interface Line {
  key: string;
  material_code: string;
  qty: string;
  batch_number: string;
  mfg_date: string;
  exp_date: string;
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
  bin: '',
  remarks: '',
});

export default function MigoPage() {
  const { setStatus } = useStatus();
  const { materials, bins } = useMasterData();

  const [movement, setMovement] = useState<string>('101');
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<{ line: number; material_code: string; document_number: string }[]>([]);

  const dir = MOVEMENTS.find((m) => m.code === movement)?.dir ?? 'IN';
  const isInbound = dir === 'IN';

  const matMap = useMemo(() => new Map(materials.map((m) => [m.material_code, m])), [materials]);

  function setLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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
        target_bin: isInbound ? l.bin.trim().toUpperCase() : null,
        source_bin: isInbound ? null : l.bin.trim().toUpperCase(),
        remarks: l.remarks.trim() || null,
      }));

    if (items.length === 0) {
      setStatus('Enter at least one line item', 'E');
      return;
    }
    for (const [i, it] of items.entries()) {
      if (!it.material_code) return setStatus(`Line ${i + 1}: material number is missing`, 'E');
      if (!it.qty || it.qty <= 0) return setStatus(`Line ${i + 1}: quantity must be greater than zero`, 'E');
      const bin = isInbound ? it.target_bin : it.source_bin;
      if (!bin) return setStatus(`Line ${i + 1}: ${isInbound ? 'destination' : 'source'} storage bin is missing`, 'E');
    }

    setBusy(true);
    const r = await post('/api/migo', { movement_type: movement, doc_date: docDate, reference, items });
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
            <Select value={movement} onChange={(e) => setMovement(e.target.value)}>
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

          <Field label="Reference / Delivery Note">
            <Input
              value={reference}
              placeholder="mis. DO-2026-00123"
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>

          <Field label="Stock Effect">
            <div className="flex items-center gap-2 h-[27px]">
              {isInbound ? (
                <span className="sap-badge border-[#2c5c3d] bg-[#1e3a29] text-[#8FE0A4] gap-1">
                  <ArrowDownToLine size={11} /> IM + / WM +
                </span>
              ) : (
                <span className="sap-badge border-[#7f2529] bg-[#3d1a1c] text-[#FF9CA0] gap-1">
                  <ArrowUpFromLine size={11} /> IM − / WM −
                </span>
              )}
              <span className="text-xxs text-sap-muted">
                {isInbound ? 'Target bin → OCCUPIED' : 'Source bin → EMPTY jika qty 0'}
              </span>
            </div>
          </Field>
        </div>
      </Panel>

      {/* ITEM TABLE */}
      <Panel
        title={`Line Items (${lines.length})`}
        icon={<ClipboardCheck size={13} className="text-sap-blue" />}
        bodyClassName="p-0"
        actions={
          <>
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
                <th className="w-[190px]">Material</th>
                <th className="w-[230px]">Description</th>
                <th className="w-[95px] text-right">Quantity</th>
                <th className="w-[60px]">UoM</th>
                <th className="w-[150px]">Batch</th>
                <th className="w-[130px]">Mfg. Date</th>
                <th className="w-[130px]">Exp. Date</th>
                <th className="w-[160px]">{isInbound ? 'Destination Bin' : 'Source Bin'}</th>
                <th className="w-[170px]">Item Text</th>
                <th className="w-[44px]"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const mat = matMap.get(l.material_code.trim().toUpperCase());
                const batchDisabled = mat ? !mat.is_batch_managed : false;
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
                    <td className="text-sap-muted truncate max-w-[230px]">{mat?.description ?? '—'}</td>
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
                    <td>
                      <Input
                        type="date"
                        className="!py-[3px]"
                        disabled={!isInbound}
                        value={l.mfg_date}
                        onChange={(e) => setLine(l.key, { mfg_date: e.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        type="date"
                        className="!py-[3px]"
                        disabled={!isInbound}
                        value={l.exp_date}
                        onChange={(e) => setLine(l.key, { exp_date: e.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        list="dl-bins"
                        className="uppercase !py-[3px]"
                        value={l.bin}
                        onChange={(e) => setLine(l.key, { bin: e.target.value })}
                      />
                    </td>
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
          <Save size={13} /> Post (Ctrl+S)
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
        <Panel title="Posted Material Documents" icon={<ClipboardCheck size={13} className="text-sap-success" />}>
          <div className="flex flex-wrap gap-2">
            {posted.map((d) => (
              <span
                key={d.document_number}
                className="sap-badge border-[#2c5c3d] bg-[#1e3a29] text-[#8FE0A4] gap-1.5 !text-2xs"
              >
                {d.document_number}
                <span className="text-sap-muted">· {d.material_code}</span>
              </span>
            ))}
          </div>
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
    </div>
  );
}
