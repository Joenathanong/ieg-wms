'use client';

import { useCallback, useEffect, useState } from 'react';
import { PackageMinus, RefreshCw, Send } from 'lucide-react';
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

/**
 * ZRF07 — Goods Issue (201) dari bin transit-out.
 * Barang yang sudah dipicking (ZRF03 / LB12) dikeluarkan dari sini.
 */
export default function ZrfGiPage() {
  const [rows, setRows] = useState<Quant[]>([]);
  const [sel, setSel] = useState<Quant | null>(null);
  const [qty, setQty] = useState('');
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'S' | 'E' | 'W' | 'I' } | null>(null);
  const [giBin, setGiBin] = useState('TRN-OUT-01');

  const load = useCallback(async () => {
    setLoading(true);
    const cfg = await api<Record<string, string>>('/api/settings');
    const bin = cfg.ok ? (cfg.data?.DEFAULT_GI_BIN ?? 'TRN-OUT-01') : 'TRN-OUT-01';
    setGiBin(bin);
    const r = await api<Quant[]>(`/api/stock/quants?bin=${encodeURIComponent(bin)}`);
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });
    setRows(r.data ?? []);
    setSel(null);
    if ((r.data?.length ?? 0) === 0)
      setMsg({ text: `${bin} kosong — lakukan picking dulu di ZRF03.`, type: 'I' });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!sel) return setMsg({ text: 'Pilih barang yang akan dikeluarkan', type: 'E' });
    const n = Number(qty);
    if (!n || n <= 0) return setMsg({ text: 'Quantity tidak valid', type: 'E' });
    if (n > sel.qty) return setMsg({ text: `Maksimum ${sel.qty}`, type: 'E' });

    setBusy(true);
    const r = await post('/api/migo', {
      movement_type: '201',
      mode: 'ISSUE',
      reference,
      items: [
        {
          material_code: sel.material_code,
          qty: n,
          batch_number: sel.batch_number || null,
        },
      ],
    });
    setBusy(false);
    setMsg({ text: r.message, type: r.ok ? 'S' : 'E' });
    if (r.ok) {
      setQty('');
      load();
    }
  }

  return (
    <PdtScreen
      title="Goods Issue"
      code="ZRF07"
      footer={<p className="text-xxs text-sap-muted">Sumber: bin transit-out {giBin}</p>}
    >
      {msg && <PdtMessage text={msg.text} type={msg.type} />}

      <PdtButton onClick={load} loading={loading}>
        <RefreshCw size={16} /> Refresh isi {giBin}
      </PdtButton>

      {!sel && (
        <div className="space-y-1.5 max-h-[46vh] overflow-auto">
          {rows.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => {
                setSel(q);
                setQty(String(q.qty));
              }}
              className="w-full text-left rounded-[3px] border border-sap-border bg-[#242934] px-3 py-2 hover:border-sap-blue/60"
            >
              <p className="font-mono text-sm text-sap-blue">{q.material_code}</p>
              <p className="text-2xs text-sap-text truncate">{q.description}</p>
              <p className="text-xxs text-sap-muted font-mono">
                {q.batch_number || 'no batch'} · {q.qty} {q.uom}
                {q.exp_date ? ` · exp ${fmtDate(q.exp_date)}` : ''}
              </p>
            </button>
          ))}
          {rows.length === 0 && !loading && (
            <p className="text-2xs text-sap-muted text-center py-4">
              Tidak ada barang siap kirim di {giBin}.
            </p>
          )}
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
            label="Quantity keluar"
            type="number"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <PdtInput
            label="Reference / DO"
            value={reference}
            onChange={(e) => setReference(e.target.value.toUpperCase())}
          />

          <div className="grid grid-cols-2 gap-2">
            <PdtButton onClick={() => setSel(null)}>Batal</PdtButton>
            <PdtButton variant="danger" onClick={submit} loading={busy}>
              <Send size={16} /> Post GI
            </PdtButton>
          </div>
        </>
      )}

      <p className="text-xxs text-sap-muted text-center">
        <PackageMinus size={11} className="inline mr-1" />
        Movement 201 — Stock IM &amp; WM berkurang di layar ini.
      </p>
    </PdtScreen>
  );
}
