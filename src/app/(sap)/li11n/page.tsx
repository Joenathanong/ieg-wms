'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, Save, CheckCheck, RefreshCw, Plus, Trash2 } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Badge, Separator } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData } from '@/components/sap/hooks';
import { api, post, patch, fmtDate } from '@/lib/client';

interface Item {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  batch_number: string | null;
  book_qty: number;
  counted_qty: number | null;
  diff_qty: number;
  posted: boolean;
}

interface Doc {
  id: string;
  doc_number: string;
  bin_code: string;
  status: 'CREATED' | 'FROZEN' | 'COUNTED' | 'POSTED';
  planned_date: string;
  created_by: string;
  items: Item[];
}

interface DocRow {
  id: string;
  doc_number: string;
  bin_code: string;
  status: Doc['status'];
}

interface NewRow {
  key: string;
  material_code: string;
  batch_number: string;
  counted_qty: string;
}

export default function Li11nPage() {
  return (
    <Suspense fallback={<div className="p-4 text-2xs text-sap-muted">Loading ...</div>}>
      <Li11nInner />
    </Suspense>
  );
}

function Li11nInner() {
  const { setStatus } = useStatus();
  const { materials } = useMasterData();
  const sp = useSearchParams();

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docId, setDocId] = useState(sp.get('doc') ?? '');
  const [doc, setDoc] = useState<Doc | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<NewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadDocs = useCallback(async () => {
    const r = await api<DocRow[]>('/api/physinv');
    if (r.ok) setDocs((r.data ?? []).filter((d) => d.status !== 'POSTED'));
  }, []);

  const loadDoc = useCallback(
    async (id: string) => {
      if (!id) {
        setDoc(null);
        return;
      }
      setLoading(true);
      const r = await api<Doc>(`/api/physinv/${id}`);
      setLoading(false);
      if (!r.ok) return setStatus(r.message, 'E');
      const d = r.data!;
      setDoc(d);
      setCounts(Object.fromEntries(d.items.map((i) => [i.id, i.counted_qty === null ? '' : String(i.counted_qty)])));
      setExtra([]);
      setStatus(`Document ${d.doc_number} — bin ${d.bin_code} (${d.items.length} item)`, 'I');
    },
    [setStatus]
  );

  useEffect(() => {
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadDoc(docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  async function saveCount() {
    if (!doc) return;
    const items = [
      ...doc.items
        .filter((i) => counts[i.id] !== '' && counts[i.id] !== undefined)
        .map((i) => ({ id: i.id, material_code: i.material_code, batch_number: i.batch_number, counted_qty: Number(counts[i.id]) })),
      ...extra
        .filter((e) => e.material_code.trim() && e.counted_qty !== '')
        .map((e) => ({
          material_code: e.material_code.trim().toUpperCase(),
          batch_number: e.batch_number.trim().toUpperCase() || null,
          counted_qty: Number(e.counted_qty),
        })),
    ];

    if (items.length === 0) return setStatus('Enter at least one count result', 'E');

    setBusy(true);
    const r = await patch(`/api/physinv/${doc.id}`, { items });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) loadDoc(doc.id);
  }

  async function postDiff() {
    if (!doc) return;
    setBusy(true);
    const r = await post(`/api/physinv/${doc.id}/post`, {});
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      loadDocs();
      loadDoc(doc.id);
    }
  }

  const totalBook = doc?.items.reduce((a, i) => a + i.book_qty, 0) ?? 0;
  const totalCounted =
    doc?.items.reduce((a, i) => a + (counts[i.id] === '' || counts[i.id] === undefined ? i.book_qty : Number(counts[i.id])), 0) ?? 0;
  const totalDiff = totalCounted - totalBook;

  return (
    <div className="space-y-3">
      <Panel title="LI11N — Enter Physical Inventory Count" icon={<ClipboardList size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Field label="Physical Inventory Document" required>
            <Select value={docId} onChange={(e) => setDocId(e.target.value)}>
              <option value="">— pilih dokumen —</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.doc_number} · Bin {d.bin_code} · {d.status}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <Button onClick={() => { loadDocs(); loadDoc(docId); }} loading={loading}>
              <RefreshCw size={13} /> Refresh
            </Button>
          </div>
          {doc && (
            <div className="md:col-span-2 flex flex-wrap items-center gap-3 text-2xs font-mono text-sap-muted">
              <Badge value={doc.status} />
              <span>Bin: <b className="text-sap-text">{doc.bin_code}</b></span>
              <span>Planned: {fmtDate(doc.planned_date)}</span>
              <span>By: {doc.created_by}</span>
            </div>
          )}
        </div>
      </Panel>

      {doc && (
        <>
          <Panel title={`Count Items — ${doc.doc_number}`} bodyClassName="p-0">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 460px)' }}>
              <table className="sap-grid min-w-[900px]">
                <thead>
                  <tr>
                    <th className="w-[40px] text-center">#</th>
                    <th className="w-[150px]">Material</th>
                    <th className="w-[240px]">Description</th>
                    <th className="w-[140px]">Batch</th>
                    <th className="w-[95px] text-right">Book Qty</th>
                    <th className="w-[110px] text-right">Counted Qty</th>
                    <th className="w-[95px] text-right">Difference</th>
                    <th className="w-[60px]">UoM</th>
                    <th className="w-[80px] text-center">Posted</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items.length === 0 && extra.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-sap-muted">
                        Bin kosong saat di-freeze. Tambahkan item bila ditemukan barang fisik.
                      </td>
                    </tr>
                  )}
                  {doc.items.map((it, i) => {
                    const c = counts[it.id];
                    const diff = c === '' || c === undefined ? null : Number(c) - it.book_qty;
                    return (
                      <tr key={it.id}>
                        <td className="text-center font-mono text-sap-muted/60">{i + 1}</td>
                        <td className="font-mono">{it.material_code}</td>
                        <td className="text-sap-muted truncate max-w-[240px]">{it.description}</td>
                        <td className="font-mono">{it.batch_number || '—'}</td>
                        <td className="text-right font-mono tabular-nums">{it.book_qty}</td>
                        <td>
                          <Input
                            type="number"
                            min={0}
                            className="text-right !py-[3px]"
                            disabled={doc.status === 'POSTED' || it.posted}
                            value={c ?? ''}
                            onChange={(e) => setCounts((s) => ({ ...s, [it.id]: e.target.value }))}
                          />
                        </td>
                        <td className="text-right font-mono tabular-nums">
                          {diff === null ? (
                            <span className="text-sap-muted">—</span>
                          ) : (
                            <span className={diff > 0 ? 'text-[#8FE0A4]' : diff < 0 ? 'text-[#FF9CA0]' : 'text-sap-muted'}>
                              {diff > 0 ? '+' : ''}
                              {diff}
                            </span>
                          )}
                        </td>
                        <td className="font-mono text-sap-muted">{it.uom}</td>
                        <td className="text-center">
                          {it.posted ? (
                            <span className="sap-badge border-[#2c5c3d] bg-[#1e3a29] text-[#8FE0A4]">YES</span>
                          ) : (
                            <span className="text-sap-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {/* baris tambahan: barang ditemukan tapi tidak tercatat di sistem */}
                  {extra.map((e, i) => (
                    <tr key={e.key}>
                      <td className="text-center font-mono text-sap-blue">+{i + 1}</td>
                      <td>
                        <Input
                          list="dl-materials"
                          className="uppercase !py-[3px]"
                          value={e.material_code}
                          onChange={(ev) =>
                            setExtra((s) => s.map((x) => (x.key === e.key ? { ...x, material_code: ev.target.value } : x)))
                          }
                        />
                      </td>
                      <td className="text-sap-muted">
                        {materials.find((m) => m.material_code === e.material_code.trim().toUpperCase())?.description ?? '—'}
                      </td>
                      <td>
                        <Input
                          className="uppercase !py-[3px]"
                          value={e.batch_number}
                          onChange={(ev) =>
                            setExtra((s) => s.map((x) => (x.key === e.key ? { ...x, batch_number: ev.target.value } : x)))
                          }
                        />
                      </td>
                      <td className="text-right font-mono text-sap-muted">0</td>
                      <td>
                        <Input
                          type="number"
                          min={0}
                          className="text-right !py-[3px]"
                          value={e.counted_qty}
                          onChange={(ev) =>
                            setExtra((s) => s.map((x) => (x.key === e.key ? { ...x, counted_qty: ev.target.value } : x)))
                          }
                        />
                      </td>
                      <td className="text-right font-mono text-[#8FE0A4]">
                        {e.counted_qty ? `+${e.counted_qty}` : '—'}
                      </td>
                      <td></td>
                      <td className="text-center">
                        <button
                          type="button"
                          onClick={() => setExtra((s) => s.filter((x) => x.key !== e.key))}
                          className="text-sap-muted hover:text-sap-error p-1"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Toolbar>
            <Button
              onClick={() =>
                setExtra((s) => [...s, { key: Math.random().toString(36).slice(2), material_code: '', batch_number: '', counted_qty: '' }])
              }
              disabled={doc.status === 'POSTED'}
            >
              <Plus size={13} /> Add Unlisted Item
            </Button>
            <Button variant="primary" onClick={saveCount} loading={busy} disabled={doc.status === 'POSTED'}>
              <Save size={13} /> Save Count Result
            </Button>
            <Button
              variant="danger"
              onClick={postDiff}
              loading={busy}
              disabled={doc.status !== 'COUNTED'}
              title="Posting selisih via movement 701 / 702"
            >
              <CheckCheck size={13} /> Post Difference (701/702)
            </Button>
            <Separator />
            <span className="font-mono text-xxs text-sap-muted">
              Book <b className="text-sap-text">{totalBook}</b> · Counted{' '}
              <b className="text-sap-text">{totalCounted}</b> · Diff{' '}
              <b className={totalDiff > 0 ? 'text-[#8FE0A4]' : totalDiff < 0 ? 'text-[#FF9CA0]' : 'text-sap-text'}>
                {totalDiff > 0 ? '+' : ''}
                {totalDiff}
              </b>
            </span>
          </Toolbar>
        </>
      )}

      <datalist id="dl-materials">
        {materials.map((m) => (
          <option key={m.id} value={m.material_code}>
            {m.description}
          </option>
        ))}
      </datalist>
    </div>
  );
}
