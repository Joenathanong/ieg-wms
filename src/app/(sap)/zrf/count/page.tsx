'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, Save, RefreshCw, ChevronRight } from 'lucide-react';
import { PdtScreen, PdtInput, PdtButton, PdtRow, PdtMessage } from '@/components/pdt/ui';
import { api, patch } from '@/lib/client';

interface Item {
  id: string;
  bin_code: string;
  material_code: string;
  description: string;
  uom: string;
  batch_number: string | null;
  book_qty: number;
  counted_qty: number | null;
  posted: boolean;
}

interface Doc {
  id: string;
  doc_number: string;
  scope_value: string;
  frozen_bins: string[];
  status: string;
  items: Item[];
}

interface DocRow {
  id: string;
  doc_number: string;
  scope_value: string;
  bin_count: number;
  item_count: number;
  status: string;
}

export default function ZrfCountPage() {
  const [list, setList] = useState<DocRow[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [bin, setBin] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'S' | 'E' | 'W' | 'I' } | null>(null);
  const binRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    const r = await api<DocRow[]>('/api/physinv');
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });
    setList((r.data ?? []).filter((d) => d.status === 'FROZEN' || d.status === 'COUNTED'));
  }, []);

  const openDoc = useCallback(async (id: string) => {
    setLoading(true);
    const r = await api<Doc>(`/api/physinv/${id}`);
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });
    setDoc(r.data!);
    setCounts({});
    setBin('');
    setTimeout(() => binRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const binItems = doc
    ? doc.items.filter((i) => i.bin_code === bin.trim().toUpperCase())
    : [];

  async function save() {
    if (!doc) return;
    const items = binItems
      .filter((i) => counts[i.id] !== undefined && counts[i.id] !== '')
      .map((i) => ({
        id: i.id,
        bin_code: i.bin_code,
        material_code: i.material_code,
        batch_number: i.batch_number,
        counted_qty: Number(counts[i.id]),
      }));

    if (items.length === 0) return setMsg({ text: 'Belum ada qty yang diisi', type: 'E' });

    setBusy(true);
    const r = await patch(`/api/physinv/${doc.id}`, { items });
    setBusy(false);
    setMsg({ text: r.message, type: r.ok ? 'S' : 'E' });
    if (r.ok) {
      await openDoc(doc.id);
      setBin('');
      binRef.current?.focus();
    }
  }

  if (!doc) {
    return (
      <PdtScreen title="Stock Count" code="ZRF05">
        {msg && <PdtMessage text={msg.text} type={msg.type} />}
        <PdtButton onClick={loadList} loading={loading}>
          <RefreshCw size={16} /> Refresh
        </PdtButton>
        <div className="space-y-1.5 max-h-[52vh] overflow-auto">
          {list.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => openDoc(d.id)}
              className="w-full text-left rounded-[3px] border border-sap-border bg-[#242934] px-3 py-2.5
                         hover:border-sap-blue/60 flex items-center gap-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-sap-blue">{d.doc_number}</p>
                <p className="text-2xs text-sap-text truncate">{d.scope_value}</p>
                <p className="text-xxs text-sap-muted font-mono">
                  {d.bin_count} bin · {d.item_count} line · {d.status}
                </p>
              </div>
              <ChevronRight size={18} className="text-sap-muted shrink-0" />
            </button>
          ))}
          {list.length === 0 && !loading && (
            <p className="text-2xs text-sap-muted text-center py-4">
              Tidak ada dokumen stock opname terbuka. Buat dulu lewat LI01N.
            </p>
          )}
        </div>
      </PdtScreen>
    );
  }

  return (
    <PdtScreen
      title="Stock Count"
      code="ZRF05"
      footer={
        <button type="button" onClick={() => setDoc(null)} className="text-2xs text-sap-blue">
          ← kembali ke daftar dokumen
        </button>
      }
    >
      {msg && <PdtMessage text={msg.text} type={msg.type} />}

      <div className="rounded-[3px] border border-sap-border bg-[#242934] px-3 py-2">
        <PdtRow label="Dokumen" value={doc.doc_number} accent />
        <PdtRow label="Bin" value={`${doc.frozen_bins.length}`} />
        <PdtRow label="Line" value={`${doc.items.length}`} />
        <PdtRow label="Terhitung" value={`${doc.items.filter((i) => i.counted_qty !== null).length}`} />
      </div>

      <PdtInput
        ref={binRef}
        label="Scan bin yang dihitung"
        list="dl-pi-bins"
        value={bin}
        onChange={(e) => setBin(e.target.value.toUpperCase())}
      />
      <datalist id="dl-pi-bins">
        {doc.frozen_bins.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>

      {bin.trim() !== '' && (
        <>
          {!doc.frozen_bins.includes(bin.trim().toUpperCase()) ? (
            <PdtMessage text={`Bin ${bin.toUpperCase()} tidak termasuk dokumen ini`} type="E" />
          ) : binItems.length === 0 ? (
            <PdtMessage text="Bin ini kosong di sistem. Selisih plus diinput lewat LI11N di desktop." type="W" />
          ) : (
            <div className="space-y-2 max-h-[36vh] overflow-auto">
              {binItems.map((it) => (
                <div key={it.id} className="rounded-[3px] border border-sap-border bg-[#242934] px-3 py-2 space-y-1.5">
                  <p className="font-mono text-sm text-sap-blue">{it.material_code}</p>
                  <p className="text-2xs text-sap-text truncate">{it.description}</p>
                  <p className="text-xxs text-sap-muted font-mono">
                    {it.batch_number || 'no batch'} · book {it.book_qty} {it.uom}
                    {it.counted_qty !== null ? ` · sudah dihitung ${it.counted_qty}` : ''}
                  </p>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Qty fisik"
                    disabled={it.posted}
                    value={counts[it.id] ?? ''}
                    onChange={(e) => setCounts((s) => ({ ...s, [it.id]: e.target.value }))}
                    className="w-full bg-[#12161d] border-2 border-sap-border focus:border-sap-blue outline-none
                               rounded-[3px] px-3 py-2 text-base font-mono text-right"
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <PdtButton variant="primary" onClick={save} loading={busy} disabled={binItems.length === 0}>
        <Save size={16} /> Simpan hasil bin ini
      </PdtButton>

      <p className="text-xxs text-sap-muted text-center">
        <ClipboardList size={11} className="inline mr-1" />
        Posting selisih (701/702) dilakukan admin di LI11N.
      </p>
    </PdtScreen>
  );
}
