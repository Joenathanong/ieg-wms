'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PackageCheck, Search, Save, RefreshCw, Info, Wand2, CheckSquare, Square } from 'lucide-react';
import { Panel, Field, Input, Button, Toolbar, Separator } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData } from '@/components/sap/hooks';
import { api, post, fmtDate } from '@/lib/client';

interface Suggestion {
  bin_code: string;
  zone_id: string;
  qty?: number;
  exp_date?: string | null;
}

interface Item {
  id: string;
  line_no: number;
  material_code: string;
  description: string;
  uom: string;
  batch_number: string | null;
  mfg_date: string | null;
  exp_date: string | null;
  pack_code: string | null;
  qty: number;
  qty_confirmed: number;
  qty_open: number;
  source_bin: string | null;
  target_bin: string | null;
  status: string;
  suggestions: Suggestion[];
}

interface Doc {
  id: string;
  tr_number: string;
  tr_type: 'PUTAWAY' | 'PICK' | 'INTERNAL';
  status: string;
  ref_doc: string | null;
  reference: string | null;
  created_by: string;
  created_at: string;
  items: Item[];
}

interface LineState {
  checked: boolean;
  qty: string;
  bin: string;
}

export default function Lb12Page() {
  return (
    <Suspense fallback={<div className="p-4 text-2xs text-sap-muted">Loading ...</div>}>
      <Lb12Inner />
    </Suspense>
  );
}

function Lb12Inner() {
  const { setStatus } = useStatus();
  const { bins } = useMasterData();
  const sp = useSearchParams();

  const [trInput, setTrInput] = useState(sp.get('tr') ?? '');
  const [doc, setDoc] = useState<Doc | null>(null);
  const [state, setState] = useState<Record<string, LineState>>({});
  const [bulkBin, setBulkBin] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (key: string) => {
      if (!key.trim()) return;
      setLoading(true);
      const r = await api<Doc>(`/api/tr/${encodeURIComponent(key.trim().toUpperCase())}`);
      setLoading(false);
      if (!r.ok) {
        setDoc(null);
        return setStatus(r.message, 'E');
      }
      const d = r.data!;
      setDoc(d);
      setState(
        Object.fromEntries(
          d.items.map((i) => [
            i.id,
            {
              checked: i.qty_open > 0,
              qty: String(i.qty_open),
              bin:
                i.status === 'CLOSED'
                  ? (d.tr_type === 'PICK' ? (i.source_bin ?? '') : (i.target_bin ?? ''))
                  : (i.suggestions[0]?.bin_code ?? ''),
            },
          ])
        )
      );
      setStatus(`${d.tr_number} — ${d.tr_type}, ${d.items.filter((i) => i.qty_open > 0).length} line terbuka`, 'I');
    },
    [setStatus]
  );

  useEffect(() => {
    const t = sp.get('tr');
    if (t) load(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(id: string, p: Partial<LineState>) {
    setState((s) => ({ ...s, [id]: { ...s[id], ...p } }));
  }

  function applyBulk() {
    if (!bulkBin.trim()) return setStatus('Isi storage bin terlebih dahulu', 'E');
    const b = bulkBin.trim().toUpperCase();
    setState((s) => {
      const n = { ...s };
      (doc?.items ?? []).forEach((i) => {
        if (i.qty_open > 0) n[i.id] = { ...n[i.id], bin: b, checked: true };
      });
      return n;
    });
    setStatus(`Bin ${b} diterapkan ke semua line terbuka`, 'I');
  }

  function applySuggestions() {
    setState((s) => {
      const n = { ...s };
      (doc?.items ?? []).forEach((i) => {
        if (i.qty_open > 0 && i.suggestions[0]) {
          n[i.id] = { ...n[i.id], bin: i.suggestions[0].bin_code, checked: true };
        }
      });
      return n;
    });
    setStatus('Saran bin sistem diterapkan', 'I');
  }

  async function confirm() {
    if (!doc) return;
    const lines = doc.items
      .filter((i) => i.qty_open > 0 && state[i.id]?.checked)
      .map((i) => ({ item_id: i.id, qty: Number(state[i.id].qty), bin: state[i.id].bin.trim().toUpperCase() }));

    if (lines.length === 0) return setStatus('Tidak ada line yang dipilih untuk dikonfirmasi', 'E');
    for (const [idx, l] of lines.entries()) {
      if (!l.qty || l.qty <= 0) return setStatus(`Line ${idx + 1}: quantity tidak valid`, 'E');
      if (!l.bin) return setStatus(`Line ${idx + 1}: storage bin belum diisi`, 'E');
    }

    setBusy(true);
    const r = await post(`/api/tr/${doc.id}/confirm`, { lines });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) load(doc.tr_number);
  }

  const isPick = doc?.tr_type === 'PICK';
  const binLabel = isPick ? 'Source Bin (ambil dari)' : 'Destination Bin (simpan ke)';
  const openLines = (doc?.items ?? []).filter((i) => i.qty_open > 0);
  const selected = openLines.filter((i) => state[i.id]?.checked);

  return (
    <div className="space-y-3">
      <Panel title="LB12 — Process Transfer Requirement (Put-away / Picking)" icon={<PackageCheck size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <Field label="Transfer Requirement" required>
            <Input
              className="uppercase"
              placeholder="TR00000101"
              value={trInput}
              onChange={(e) => setTrInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load(trInput)}
            />
          </Field>
          <div>
            <Button variant="primary" onClick={() => load(trInput)} loading={loading}>
              <Search size={13} /> Display
            </Button>
          </div>
          {doc && (
            <div className="md:col-span-3 flex flex-wrap items-center gap-3 text-2xs font-mono text-sap-muted">
              <span className="sap-badge border-[#2b5480] bg-[#1c3450] text-[#9DC0FF]">{doc.tr_type}</span>
              <span className="sap-badge border-[#3f4657] bg-[#2c313d] text-sap-muted">{doc.status}</span>
              {doc.ref_doc && <span>Mat.Doc: <b className="text-sap-text">{doc.ref_doc}</b></span>}
              {doc.reference && <span>Ref: {doc.reference}</span>}
              <span>By: {doc.created_by}</span>
              <Link href="/lb10" className="text-sap-blue hover:underline">← kembali ke LB10</Link>
            </div>
          )}
        </div>

        {doc && (
          <div className="mt-3 flex items-start gap-2 px-2.5 py-2 rounded-[2px] border border-sap-blue/40 bg-sap-blue/10 text-2xs text-[#9DC0FF]">
            <Info size={13} className="shrink-0 mt-[1px]" />
            {doc.tr_type === 'PUTAWAY' ? (
              <span>
                Put-away: stok dipindahkan dari bin interim <b>{doc.items[0]?.source_bin}</b> ke rak yang Anda
                tentukan. Movement 301, stok global (IM) tidak berubah.
              </span>
            ) : doc.tr_type === 'PICK' ? (
              <span>
                Picking: pilih rak asal untuk tiap line. Saat seluruh line selesai, sistem otomatis memposting{' '}
                <b>goods issue 201</b> dari bin interim <b>{doc.items[0]?.target_bin}</b>.
              </span>
            ) : (
              <span>Pemindahan internal — movement 301 antar bin.</span>
            )}
          </div>
        )}
      </Panel>

      {doc && (
        <>
          <Toolbar>
            <Input
              list="dl-bins"
              className="!w-[190px] uppercase"
              placeholder={binLabel}
              value={bulkBin}
              onChange={(e) => setBulkBin(e.target.value)}
            />
            <Button onClick={applyBulk} disabled={openLines.length === 0}>
              <Wand2 size={13} /> Apply ke semua line
            </Button>
            <Button onClick={applySuggestions} disabled={openLines.length === 0}>
              <Wand2 size={13} /> Pakai saran sistem
            </Button>
            <Separator />
            <Button onClick={() => load(doc.tr_number)} loading={loading}>
              <RefreshCw size={13} /> Refresh
            </Button>
          </Toolbar>

          <Panel title={`Lines — ${doc.tr_number} (${selected.length}/${openLines.length} dipilih)`} bodyClassName="p-0">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 420px)' }}>
              <table className="sap-grid min-w-[1100px]">
                <thead>
                  <tr>
                    <th className="w-[38px] text-center">
                      <button
                        type="button"
                        onClick={() =>
                          setState((s) => {
                            const all = openLines.every((i) => s[i.id]?.checked);
                            const n = { ...s };
                            openLines.forEach((i) => (n[i.id] = { ...n[i.id], checked: !all }));
                            return n;
                          })
                        }
                        className="text-sap-muted hover:text-sap-blue"
                      >
                        {openLines.length > 0 && openLines.every((i) => state[i.id]?.checked) ? (
                          <CheckSquare size={13} />
                        ) : (
                          <Square size={13} />
                        )}
                      </button>
                    </th>
                    <th className="w-[46px] text-center">Line</th>
                    <th className="w-[150px]">Material</th>
                    <th className="w-[200px]">Description</th>
                    <th className="w-[130px]">Batch</th>
                    <th className="w-[105px]">Exp. Date</th>
                    <th className="w-[120px]">Packaging</th>
                    <th className="w-[85px] text-right">Qty</th>
                    <th className="w-[85px] text-right">Open</th>
                    <th className="w-[95px] text-right">Confirm Qty</th>
                    <th className="w-[170px]">{binLabel}</th>
                    <th className="w-[130px]">Saran</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items.map((it) => {
                    const st = state[it.id] ?? { checked: false, qty: '', bin: '' };
                    const done = it.qty_open <= 0;
                    return (
                      <tr key={it.id} className={done ? 'opacity-50' : undefined}>
                        <td className="text-center">
                          {done ? (
                            <span className="text-[#8FE0A4]">✓</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => patch(it.id, { checked: !st.checked })}
                              className={st.checked ? 'text-sap-blue' : 'text-sap-muted hover:text-sap-blue'}
                            >
                              {st.checked ? <CheckSquare size={13} /> : <Square size={13} />}
                            </button>
                          )}
                        </td>
                        <td className="text-center font-mono text-sap-muted/60">{it.line_no}</td>
                        <td className="font-mono">{it.material_code}</td>
                        <td className="text-sap-muted truncate max-w-[200px]">{it.description}</td>
                        <td className="font-mono">{it.batch_number || '—'}</td>
                        <td className="font-mono">{fmtDate(it.exp_date) || '—'}</td>
                        <td className="font-mono text-sap-muted">{it.pack_code || '—'}</td>
                        <td className="text-right font-mono tabular-nums">{it.qty}</td>
                        <td className="text-right font-mono tabular-nums text-[#F3C77B]">{it.qty_open}</td>
                        <td>
                          <Input
                            type="number"
                            min={1}
                            max={it.qty_open}
                            disabled={done}
                            className="text-right !py-[3px]"
                            value={st.qty}
                            onChange={(e) => patch(it.id, { qty: e.target.value, checked: true })}
                          />
                        </td>
                        <td>
                          <Input
                            list={`dl-sug-${it.id}`}
                            disabled={done}
                            className="uppercase !py-[3px]"
                            value={st.bin}
                            onChange={(e) => patch(it.id, { bin: e.target.value, checked: true })}
                          />
                          <datalist id={`dl-sug-${it.id}`}>
                            {it.suggestions.map((s) => (
                              <option key={s.bin_code} value={s.bin_code}>
                                {s.zone_id}
                                {s.qty !== undefined ? ` · ${s.qty} pcs` : ''}
                              </option>
                            ))}
                            {bins
                              .filter((b) => !b.is_interim && b.status !== 'BLOCKED')
                              .map((b) => (
                                <option key={b.id} value={b.bin_code}>
                                  {b.zone_id} · {b.status}
                                </option>
                              ))}
                          </datalist>
                        </td>
                        <td className="font-mono text-xxs text-sap-muted truncate max-w-[130px]">
                          {it.suggestions.slice(0, 2).map((s) => s.bin_code).join(', ') || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Toolbar>
            <Button variant="primary" onClick={confirm} loading={busy} disabled={selected.length === 0}>
              <Save size={13} /> Confirm {selected.length} line(s)
            </Button>
            <Separator />
            <span className="text-xxs text-sap-muted">
              Konfirmasi parsial diperbolehkan — sisa qty tetap terbuka di LB10.
            </span>
          </Toolbar>
        </>
      )}

      <datalist id="dl-bins">
        {bins
          .filter((b) => !b.is_interim && b.status !== 'BLOCKED')
          .map((b) => (
            <option key={b.id} value={b.bin_code}>
              {b.zone_id} · {b.status}
            </option>
          ))}
      </datalist>
    </div>
  );
}
