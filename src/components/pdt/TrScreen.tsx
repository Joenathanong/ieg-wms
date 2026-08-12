'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PackageCheck, RefreshCw, Check, ChevronRight } from 'lucide-react';
import { PdtScreen, PdtInput, PdtButton, PdtRow, PdtMessage } from './ui';
import { api, post, fmtDate } from '@/lib/client';

interface Suggestion {
  bin_code: string;
  zone_id: string;
  qty?: number;
}

interface Item {
  id: string;
  line_no: number;
  material_code: string;
  description: string;
  uom: string;
  batch_number: string | null;
  exp_date: string | null;
  pack_code: string | null;
  qty: number;
  qty_open: number;
  source_bin: string | null;
  target_bin: string | null;
  suggestions: Suggestion[];
}

interface Doc {
  id: string;
  tr_number: string;
  tr_type: string;
  status: string;
  ref_doc: string | null;
  items: Item[];
}

interface ListRow {
  id: string;
  tr_number: string;
  materials: string;
  description: string;
  total_qty: number;
  confirmed_qty: number;
  open_lines: number;
  item_count: number;
}

export function TrScreen({
  type,
  code,
  title,
  binLabel,
}: {
  type: 'PUTAWAY' | 'PICK';
  code: string;
  title: string;
  binLabel: string;
}) {
  const [list, setList] = useState<ListRow[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [active, setActive] = useState<Item | null>(null);
  const [bin, setBin] = useState('');
  const [qty, setQty] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'S' | 'E' | 'W' | 'I' } | null>(null);
  const binRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    const r = await api<ListRow[]>(`/api/tr?type=${type}`);
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });
    setList(r.data ?? []);
    if ((r.data ?? []).length === 0) setMsg({ text: 'Tidak ada pekerjaan terbuka', type: 'I' });
  }, [type]);

  const openDoc = useCallback(async (key: string) => {
    setLoading(true);
    const r = await api<Doc>(`/api/tr/${encodeURIComponent(key)}`);
    setLoading(false);
    if (!r.ok) {
      setMsg({ text: r.message, type: 'E' });
      return;
    }
    const d = r.data!;
    setDoc(d);
    const next = d.items.find((i) => i.qty_open > 0) ?? null;
    setActive(next);
    setBin(next?.suggestions[0]?.bin_code ?? '');
    setQty(next ? String(next.qty_open) : '');
    if (!next) setMsg({ text: `${d.tr_number} sudah selesai`, type: 'S' });
    setTimeout(() => binRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  async function confirm() {
    if (!doc || !active) return;
    if (!bin.trim()) return setMsg({ text: 'Scan bin terlebih dahulu', type: 'E' });
    const n = Number(qty);
    if (!n || n <= 0) return setMsg({ text: 'Quantity tidak valid', type: 'E' });
    if (n > active.qty_open) return setMsg({ text: `Maksimum ${active.qty_open}`, type: 'E' });

    setBusy(true);
    const r = await post(`/api/tr/${doc.id}/confirm`, {
      via_pdt: true,
      lines: [{ item_id: active.id, qty: n, bin: bin.trim().toUpperCase() }],
    });
    setBusy(false);
    setMsg({ text: r.message, type: r.ok ? 'S' : 'E' });

    if (r.ok) {
      if (r.data?.tr_closed) {
        setDoc(null);
        setActive(null);
        loadList();
      } else {
        openDoc(doc.tr_number);
      }
    }
  }

  /* ---------------- daftar pekerjaan ---------------- */
  if (!doc) {
    return (
      <PdtScreen title={title} code={code}>
        {msg && <PdtMessage text={msg.text} type={msg.type} />}

        <PdtInput
          label="Scan / ketik nomor TR"
          placeholder="TR00000101"
          onKeyDown={(e) => {
            if (e.key === 'Enter') openDoc((e.target as HTMLInputElement).value.trim().toUpperCase());
          }}
        />

        <PdtButton onClick={loadList} loading={loading}>
          <RefreshCw size={16} /> Refresh daftar
        </PdtButton>

        <div className="space-y-1.5 max-h-[46vh] overflow-auto">
          {list.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openDoc(t.tr_number)}
              className="w-full text-left rounded-[3px] border border-sap-border bg-[#242934]
                         px-3 py-2.5 hover:border-sap-blue/60 flex items-center gap-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-sap-blue">{t.tr_number}</p>
                <p className="text-2xs text-sap-text truncate">
                  {t.materials} · {t.description}
                </p>
                <p className="text-xxs text-sap-muted font-mono">
                  {t.confirmed_qty}/{t.total_qty} pcs · {t.open_lines} dari {t.item_count} line terbuka
                </p>
              </div>
              <ChevronRight size={18} className="text-sap-muted shrink-0" />
            </button>
          ))}
          {list.length === 0 && !loading && (
            <p className="text-2xs text-sap-muted text-center py-4">Tidak ada pekerjaan terbuka.</p>
          )}
        </div>
      </PdtScreen>
    );
  }

  /* ---------------- proses satu line ---------------- */
  return (
    <PdtScreen
      title={title}
      code={code}
      back="/zrf"
      footer={
        <button
          type="button"
          onClick={() => {
            setDoc(null);
            setActive(null);
            loadList();
          }}
          className="text-2xs text-sap-blue"
        >
          ← kembali ke daftar pekerjaan
        </button>
      }
    >
      {msg && <PdtMessage text={msg.text} type={msg.type} />}

      <div className="rounded-[3px] border border-sap-border bg-[#242934] px-3 py-2">
        <PdtRow label="TR" value={doc.tr_number} accent />
        {doc.ref_doc && <PdtRow label="Mat. Doc" value={doc.ref_doc} />}
        <PdtRow label="Sisa line" value={`${doc.items.filter((i) => i.qty_open > 0).length} / ${doc.items.length}`} />
      </div>

      {active ? (
        <>
          <div className="rounded-[3px] border border-sap-blue/40 bg-sap-blue/10 px-3 py-2">
            <PdtRow label="Line" value={`${active.line_no} / ${doc.items.length}`} />
            <PdtRow label="Material" value={active.material_code} accent />
            <PdtRow label="Deskripsi" value={active.description} />
            {active.batch_number && <PdtRow label="Batch" value={active.batch_number} />}
            {active.exp_date && <PdtRow label="Expired" value={fmtDate(active.exp_date)} />}
            {active.pack_code && <PdtRow label="Kemasan" value={active.pack_code} />}
            <PdtRow label="Qty terbuka" value={`${active.qty_open} ${active.uom}`} accent />
            {type === 'PUTAWAY' && active.source_bin && <PdtRow label="Dari" value={active.source_bin} />}
            {type === 'PICK' && active.target_bin && <PdtRow label="Ke" value={active.target_bin} />}
          </div>

          <PdtInput
            ref={binRef}
            label={binLabel}
            list="dl-pdt-sug"
            value={bin}
            onChange={(e) => setBin(e.target.value.toUpperCase())}
            hint={
              active.suggestions.length > 0
                ? `Saran: ${active.suggestions.slice(0, 3).map((s) => s.bin_code + (s.qty ? `(${s.qty})` : '')).join(', ')}`
                : undefined
            }
          />

          <PdtInput
            label="Quantity"
            type="number"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />

          <PdtButton variant="primary" onClick={confirm} loading={busy}>
            <Check size={16} /> Confirm line {active.line_no}
          </PdtButton>

          <datalist id="dl-pdt-sug">
            {active.suggestions.map((s) => (
              <option key={s.bin_code} value={s.bin_code}>
                {s.zone_id}
                {s.qty ? ` · ${s.qty}` : ''}
              </option>
            ))}
          </datalist>
        </>
      ) : (
        <PdtMessage text={`${doc.tr_number} sudah selesai seluruhnya.`} type="S" />
      )}

      <PdtButton onClick={() => openDoc(doc.tr_number)} loading={loading}>
        <PackageCheck size={16} /> Refresh TR
      </PdtButton>
    </PdtScreen>
  );
}
