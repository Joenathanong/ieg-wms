'use client';

import { useRef, useState } from 'react';
import { ArrowLeftRight, Search, Save } from 'lucide-react';
import { PdtScreen, PdtInput, PdtButton, PdtRow, PdtMessage } from '@/components/pdt/ui';
import { api, post, fmtDate } from '@/lib/client';

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

export default function ZrfTransferPage() {
  const [sourceBin, setSourceBin] = useState('');
  const [quants, setQuants] = useState<Quant[]>([]);
  const [sel, setSel] = useState<Quant | null>(null);
  const [qty, setQty] = useState('');
  const [targetBin, setTargetBin] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'S' | 'E' | 'W' | 'I' } | null>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  async function scan() {
    const b = sourceBin.trim().toUpperCase();
    if (!b) return setMsg({ text: 'Scan bin asal terlebih dahulu', type: 'E' });
    setLoading(true);
    setSel(null);
    const r = await api<Quant[]>(`/api/stock/quants?bin=${encodeURIComponent(b)}`);
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });
    setQuants(r.data ?? []);
    setMsg({ text: r.message, type: (r.data?.length ?? 0) > 0 ? 'S' : 'W' });
  }

  async function submit() {
    if (!sel) return setMsg({ text: 'Pilih stok yang akan dipindah', type: 'E' });
    const n = Number(qty);
    if (!n || n <= 0) return setMsg({ text: 'Quantity tidak valid', type: 'E' });
    if (n > sel.qty) return setMsg({ text: `Maksimum ${sel.qty}`, type: 'E' });
    if (!targetBin.trim()) return setMsg({ text: 'Scan bin tujuan', type: 'E' });

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
      scan();
    }
  }

  return (
    <PdtScreen title="Bin Transfer" code="ZRF04">
      {msg && <PdtMessage text={msg.text} type={msg.type} />}

      <PdtInput
        label="Scan bin asal"
        autoFocus
        value={sourceBin}
        onChange={(e) => setSourceBin(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && scan()}
      />
      <PdtButton onClick={scan} loading={loading}>
        <Search size={16} /> Tampilkan isi rak
      </PdtButton>

      {quants.length > 0 && !sel && (
        <div className="space-y-1.5 max-h-[38vh] overflow-auto">
          {quants.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => {
                setSel(q);
                setQty(String(q.qty));
                setTimeout(() => targetRef.current?.focus(), 50);
              }}
              className="w-full text-left rounded-[3px] border border-sap-border bg-sap-panelalt px-3 py-2 hover:border-sap-blue/60"
            >
              <p className="font-mono text-sm text-sap-blue">{q.material_code}</p>
              <p className="text-2xs text-sap-text truncate">{q.description}</p>
              <p className="text-xxs text-sap-muted font-mono">
                {q.batch_number || 'no batch'} · {q.qty} {q.uom}
                {q.exp_date ? ` · exp ${fmtDate(q.exp_date)}` : ''}
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
            <PdtRow label="Tersedia" value={`${sel.qty} ${sel.uom}`} />
            <PdtRow label="Dari" value={sel.bin_code} />
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
            label="Scan bin tujuan"
            value={targetBin}
            onChange={(e) => setTargetBin(e.target.value.toUpperCase())}
          />

          <div className="grid grid-cols-2 gap-2">
            <PdtButton onClick={() => setSel(null)}>Batal</PdtButton>
            <PdtButton variant="primary" onClick={submit} loading={busy}>
              <ArrowLeftRight size={16} /> Transfer
            </PdtButton>
          </div>
        </>
      )}
    </PdtScreen>
  );
}
