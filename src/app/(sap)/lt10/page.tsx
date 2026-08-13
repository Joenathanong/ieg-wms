'use client';

import { useMemo, useState } from 'react';
import { Layers3, Search, Save, CheckSquare, Square, Wand2, Info } from 'lucide-react';
import { Panel, Field, ActionField, Input, Button, Toolbar, Separator} from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useExecuteKey } from '@/components/sap/keynav';
import { useMasterData } from '@/components/sap/hooks';
import { api, post, fmtDate } from '@/lib/client';
import { WILDCARD_HINT } from '@/lib/like';

interface Quant {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  batch_number: string;
  exp_date: string | null;
  qty: number;
  bin_code: string;
}

interface RowState {
  checked: boolean;
  qty: string;
  target: string;
}

export default function Lt10Page() {
  const { setStatus } = useStatus();
  const { bins } = useMasterData();

  const [fBin, setFBin] = useState('');
  const [fMaterial, setFMaterial] = useState('');
  const [rows, setRows] = useState<Quant[]>([]);
  const [state, setState] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bulkTarget, setBulkTarget] = useState('');
  const [result, setResult] = useState<any[]>([]);

  // Enter / F8 = Execute (cari stok)
  useExecuteKey(() => {
    search();
  });

  async function search() {
    setLoading(true);
    setResult([]);
    const p = new URLSearchParams();
    if (fBin.trim()) p.set('bin', fBin.trim().toUpperCase());
    // q = cari kode ATAU deskripsi, mendukung wildcard '*'
    if (fMaterial.trim()) p.set('q', fMaterial.trim().toUpperCase());
    const r = await api<Quant[]>(`/api/stock/quants?${p.toString()}`);
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    const data = r.data ?? [];
    setRows(data);
    setState(
      Object.fromEntries(data.map((q) => [q.id, { checked: false, qty: String(q.qty), target: '' }]))
    );
    setStatus(r.message, data.length ? 'S' : 'W');
  }

  const selected = useMemo(() => rows.filter((r) => state[r.id]?.checked), [rows, state]);
  const allChecked = rows.length > 0 && selected.length === rows.length;

  function patch(id: string, p: Partial<RowState>) {
    setState((s) => ({ ...s, [id]: { ...s[id], ...p } }));
  }

  function applyBulkTarget() {
    if (!bulkTarget.trim()) return setStatus('Enter a destination bin first', 'E');
    const t = bulkTarget.trim().toUpperCase();
    setState((s) => {
      const n = { ...s };
      (selected.length ? selected : rows).forEach((r) => {
        n[r.id] = { ...n[r.id], target: t, checked: true };
      });
      return n;
    });
    setStatus(`Destination bin ${t} applied to ${(selected.length || rows.length)} line(s)`, 'I');
  }

  async function submit() {
    const items = selected.map((r) => ({
      material_code: r.material_code,
      qty: Number(state[r.id].qty),
      batch_number: r.batch_number || null,
      source_bin: r.bin_code,
      target_bin: state[r.id].target.trim().toUpperCase(),
    }));

    if (items.length === 0) return setStatus('No line item selected for transfer', 'E');
    for (const [i, it] of items.entries()) {
      if (!it.qty || it.qty <= 0) return setStatus(`Line ${i + 1}: invalid quantity`, 'E');
      if (!it.target_bin) return setStatus(`Line ${i + 1}: destination bin is missing`, 'E');
    }

    setBusy(true);
    const r = await post('/api/transfer', { items });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setResult(r.data?.documents ?? []);
      search();
    }
  }

  return (
    <div className="space-y-3">
      <Panel title="LT10 — Mass Bin Transfer (Movement 301)" icon={<Layers3 size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
          <Field label="Source Bin (kosongkan = semua)" hint={WILDCARD_HINT}>
            <Input
              list="dl-bins"
              className="uppercase"
              placeholder="mis. GB-A-*"
              value={fBin}
              onChange={(e) => setFBin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
          </Field>
          <Field label="Material / Description" hint={WILDCARD_HINT}>
            <Input
              className="uppercase"
              placeholder="kode atau deskripsi"
              value={fMaterial}
              onChange={(e) => setFMaterial(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
          </Field>
          <ActionField>
            <Button onClick={search} loading={loading}>
              <Search size={13} /> Execute (F8)
            </Button>
          </ActionField>
          <Field label="Destination Bin — Mass Assign">
            <Input
              list="dl-bins"
              className="uppercase"
              value={bulkTarget}
              onChange={(e) => setBulkTarget(e.target.value)}
            />
          </Field>
          <ActionField>
            <Button onClick={applyBulkTarget} disabled={rows.length === 0}>
              <Wand2 size={13} /> Apply to {selected.length || rows.length} line(s)
            </Button>
          </ActionField>
        </div>
      </Panel>

      <Panel title={`Transfer Work List (${selected.length}/${rows.length} selected)`} bodyClassName="p-0">
        <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
          <table className="sap-grid min-w-[1080px]">
            <thead>
              <tr>
                <th className="w-[38px] text-center">
                  <button
                    type="button"
                    onClick={() =>
                      setState((s) => {
                        const n = { ...s };
                        rows.forEach((r) => (n[r.id] = { ...n[r.id], checked: !allChecked }));
                        return n;
                      })
                    }
                    className="text-sap-muted hover:text-sap-blue"
                  >
                    {allChecked ? <CheckSquare size={13} /> : <Square size={13} />}
                  </button>
                </th>
                <th className="w-[40px] text-center">#</th>
                <th className="w-[140px]">Source Bin</th>
                <th className="w-[150px]">Material</th>
                <th className="w-[210px]">Description</th>
                <th className="w-[130px]">Batch</th>
                <th className="w-[105px]">Exp. Date</th>
                <th className="w-[80px] text-right">Avail.</th>
                <th className="w-[95px] text-right">Transfer Qty</th>
                <th className="w-[160px]">Destination Bin</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-6 text-center text-sap-muted">
                    Tekan Execute untuk menampilkan stok yang dapat dipindahkan
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const st = state[r.id] ?? { checked: false, qty: '', target: '' };
                return (
                  <tr key={r.id}>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => patch(r.id, { checked: !st.checked })}
                        className={st.checked ? 'text-sap-blue' : 'text-sap-muted hover:text-sap-blue'}
                      >
                        {st.checked ? <CheckSquare size={13} /> : <Square size={13} />}
                      </button>
                    </td>
                    <td className="text-center font-mono text-sap-muted/60">{i + 1}</td>
                    <td className="font-mono">{r.bin_code}</td>
                    <td className="font-mono">{r.material_code}</td>
                    <td className="text-sap-muted truncate max-w-[210px]">{r.description}</td>
                    <td className="font-mono">{r.batch_number || '—'}</td>
                    <td className="font-mono">{fmtDate(r.exp_date) || '—'}</td>
                    <td className="text-right font-mono tabular-nums">{r.qty}</td>
                    <td>
                      <Input
                        type="number"
                        min={1}
                        max={r.qty}
                        className="text-right !py-[3px]"
                        value={st.qty}
                        onChange={(e) => patch(r.id, { qty: e.target.value, checked: true })}
                      />
                    </td>
                    <td>
                      <Input
                        list="dl-bins"
                        className="uppercase !py-[3px]"
                        value={st.target}
                        onChange={(e) => patch(r.id, { target: e.target.value, checked: true })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Toolbar>
        <Button variant="primary" onClick={submit} loading={busy} disabled={selected.length === 0}>
          <Save size={13} /> Transfer {selected.length} Item(s)
        </Button>
        <Separator />
        <span className="text-xxs text-sap-muted flex items-center gap-1.5">
          <Info size={12} /> Seluruh baris diposting dalam satu transaction — jika satu baris gagal, semuanya di-rollback.
        </span>
      </Toolbar>

      {result.length > 0 && (
        <Panel title={`Transfer Orders Created (${result.length})`} bodyClassName="p-3">
          <div className="flex flex-wrap gap-2">
            {result.map((d: any) => (
              <span key={d.document_number} className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext !text-2xs">
                {d.document_number} · {d.material_code} · {d.source_bin} → {d.target_bin} ({d.qty})
              </span>
            ))}
          </div>
        </Panel>
      )}

      <datalist id="dl-bins">
        {bins.map((b) => (
          <option key={b.id} value={b.bin_code}>
            {b.zone_id} · {b.status}
          </option>
        ))}
      </datalist>
    </div>
  );
}
