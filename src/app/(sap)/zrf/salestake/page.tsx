'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Receipt,
  RefreshCw,
  ChevronRight,
  Plus,
  Save,
  Lock,
  ScanLine,
} from 'lucide-react';
import { PdtScreen, PdtInput, PdtButton, PdtRow, PdtMessage } from '@/components/pdt/ui';
import { api, post, patch, qs, fmtDate } from '@/lib/client';

interface Quant {
  material_code: string;
  description: string;
  uom: string;
  batch_number: string;
  exp_date: string | null;
  qty: number;
}

interface DocRow {
  id: string;
  doc_number: string;
  status: string;
  reference: string;
  bin_count: number;
  line_count: number;
  sold_total: number;
  surplus_total: number;
}

interface Doc extends DocRow {
  counted_bins: string[];
}

/**
 * ZRF09 — SO Penjualan.
 *
 * Barang di pick bin diambil oleh program picking di luar sistem ini, sehingga
 * saldo buku selalu lebih tinggi dari fisik. Operator menghitung sisa fisik,
 * dan SELISIHNYA diakui sebagai penjualan (movement 601).
 *
 * Dokumen sengaja dicicil per bin: satu shift bisa mengerjakan beberapa rak
 * saja, persis seperti cycle count.
 */
export default function ZrfSalesTakePage() {
  const [list, setList] = useState<DocRow[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [bin, setBin] = useState('');
  const [quants, setQuants] = useState<Quant[]>([]);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'S' | 'E' | 'W' | 'I' } | null>(null);
  const binRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    const r = await api<DocRow[]>('/api/salestake' + qs({ status: 'OPEN' }));
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });
    setList(r.data ?? []);
  }, []);

  const openDoc = useCallback(async (id: string) => {
    setLoading(true);
    const r = await api<Doc>(`/api/salestake/${id}`);
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });
    setDoc(r.data!);
    setBin('');
    setQuants([]);
    setActual({});
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const key = (q: Quant) => `${q.material_code}|${q.batch_number}`;

  /** Ambil isi pick bin — saldo buku ini yang dikunci sebagai pembanding. */
  async function loadBin() {
    const b = bin.trim().toUpperCase();
    if (!b) return setMsg({ text: 'Scan pick bin terlebih dahulu', type: 'E' });
    if (doc?.counted_bins.includes(b))
      return setMsg({ text: `Bin ${b} sudah dihitung di dokumen ini`, type: 'W' });

    setLoading(true);
    const r = await api<Quant[]>('/api/stock/quants' + qs({ bin: b }));
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });

    const rows = r.data ?? [];
    setQuants(rows);
    setActual(Object.fromEntries(rows.map((q) => [key(q), ''])));
    setMsg(
      rows.length === 0
        ? { text: `${b} kosong menurut sistem — tidak ada yang perlu dihitung.`, type: 'I' }
        : { text: `${b}: ${rows.length} baris. Isi sisa fisik tiap baris.`, type: 'S' }
    );
  }

  async function submitBin() {
    if (!doc) return;
    const b = bin.trim().toUpperCase();
    const lines = quants.map((q) => ({
      material_code: q.material_code,
      batch_number: q.batch_number || null,
      book_qty: q.qty,
      actual_qty: Number(actual[key(q)]),
    }));

    const kosong = quants.find((q) => actual[key(q)] === '' || actual[key(q)] === undefined);
    if (kosong)
      return setMsg({
        text: `Sisa fisik ${kosong.material_code} belum diisi. Isi 0 bila memang habis.`,
        type: 'E',
      });
    if (lines.some((l) => !Number.isFinite(l.actual_qty) || l.actual_qty < 0))
      return setMsg({ text: 'Ada qty yang tidak valid', type: 'E' });

    setBusy(true);
    const r = await post(`/api/salestake/${doc.id}/bin`, { bin_code: b, via_pdt: true, lines });
    setBusy(false);
    setMsg({ text: r.message, type: r.ok ? 'S' : 'E' });
    if (r.ok) {
      setBin('');
      setQuants([]);
      setActual({});
      await openDoc(doc.id);
    }
  }

  async function createDoc() {
    setBusy(true);
    const r = await post('/api/salestake', { reference: reference.trim() });
    setBusy(false);
    setMsg({ text: r.message, type: r.ok ? 'S' : 'E' });
    if (r.ok) {
      setReference('');
      await loadList();
    }
  }

  async function closeDoc() {
    if (!doc) return;
    setBusy(true);
    const r = await patch(`/api/salestake/${doc.id}`, { status: 'CLOSED' });
    setBusy(false);
    setMsg({ text: r.message, type: r.ok ? 'S' : 'E' });
    if (r.ok) {
      setDoc(null);
      await loadList();
    }
  }

  /* ------------------------------- daftar dokumen ------------------------------- */
  if (!doc) {
    return (
      <PdtScreen title="SO Penjualan" code="ZRF09">
        {msg && <PdtMessage text={msg.text} type={msg.type} />}

        <div className="rounded-[3px] border border-sap-border bg-sap-panelalt px-3 py-2 space-y-2">
          <p className="text-xxs text-sap-muted">Buka dokumen baru untuk shift / periode ini</p>
          <PdtInput
            label="Referensi (mis. SHIFT-1)"
            value={reference}
            onChange={(e) => setReference(e.target.value.toUpperCase())}
          />
          <PdtButton variant="primary" onClick={createDoc} loading={busy}>
            <Plus size={16} /> Buat dokumen SO
          </PdtButton>
        </div>

        <PdtButton onClick={loadList} loading={loading}>
          <RefreshCw size={16} /> Refresh
        </PdtButton>

        <div className="space-y-1.5 max-h-[42dvh] overflow-auto">
          {list.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => openDoc(d.id)}
              className="w-full text-left rounded-[3px] border border-sap-border bg-sap-panelalt px-3 py-2.5
                         hover:border-sap-blue/60 flex items-center gap-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-sap-blue">{d.doc_number}</p>
                <p className="text-2xs text-sap-text truncate">{d.reference || '(tanpa referensi)'}</p>
                <p className="text-xxs text-sap-muted font-mono">
                  {d.bin_count} bin · penjualan {d.sold_total}
                  {d.surplus_total > 0 ? ` · lebih ${d.surplus_total}` : ''}
                </p>
              </div>
              <ChevronRight size={18} className="text-sap-muted shrink-0" />
            </button>
          ))}
          {list.length === 0 && !loading && (
            <p className="text-2xs text-sap-muted text-center py-4">
              Belum ada dokumen SO terbuka.
            </p>
          )}
        </div>
      </PdtScreen>
    );
  }

  /* ------------------------------- layar hitung ------------------------------- */
  return (
    <PdtScreen
      title="SO Penjualan"
      code="ZRF09"
      footer={
        <button type="button" onClick={() => setDoc(null)} className="text-2xs text-sap-blue">
          ← kembali ke daftar dokumen
        </button>
      }
    >
      {msg && <PdtMessage text={msg.text} type={msg.type} />}

      <div className="rounded-[3px] border border-sap-border bg-sap-panelalt px-3 py-2">
        <PdtRow label="Dokumen" value={doc.doc_number} accent />
        {doc.reference && <PdtRow label="Referensi" value={doc.reference} />}
        <PdtRow label="Bin selesai" value={`${doc.counted_bins.length}`} />
        <PdtRow label="Penjualan" value={`${doc.sold_total}`} />
        {doc.surplus_total > 0 && <PdtRow label="Kelebihan" value={`${doc.surplus_total}`} />}
      </div>

      <PdtInput
        ref={binRef}
        label="Pick bin"
        value={bin}
        onChange={(e) => setBin(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            loadBin();
          }
        }}
        hint="Ketuk field lalu scan. Saldo buku dikunci saat bin dibuka."
      />

      <PdtButton onClick={loadBin} loading={loading}>
        <ScanLine size={16} /> Tampilkan isi bin
      </PdtButton>

      {quants.length > 0 && (
        <>
          <div className="space-y-2 max-h-[40dvh] overflow-auto">
            {quants.map((q) => {
              const v = actual[key(q)];
              const diff = v === '' || v === undefined ? null : q.qty - Number(v);
              return (
                <div
                  key={key(q)}
                  className="rounded-[3px] border border-sap-border bg-sap-panelalt px-3 py-2 space-y-1.5"
                >
                  <p className="font-mono text-sm text-sap-blue">{q.material_code}</p>
                  <p className="text-2xs text-sap-text truncate">{q.description}</p>
                  <p className="text-xxs text-sap-muted font-mono">
                    {q.batch_number || 'no batch'}
                    {q.exp_date ? ` · ED ${fmtDate(q.exp_date)}` : ''} · buku {q.qty} {q.uom}
                  </p>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Sisa fisik"
                    value={v ?? ''}
                    onChange={(e) => setActual((s) => ({ ...s, [key(q)]: e.target.value }))}
                    className="w-full bg-sap-cmd border-2 border-sap-border focus:border-sap-blue outline-none
                               rounded-[3px] px-3 py-2 text-base font-mono text-right"
                  />
                  {diff !== null && (
                    <p
                      className={`text-xxs font-mono text-right ${
                        diff > 0 ? 'text-sap-oktext' : diff < 0 ? 'text-sap-warntext' : 'text-sap-muted'
                      }`}
                    >
                      {diff > 0
                        ? `terjual ${diff}`
                        : diff < 0
                          ? `fisik lebih ${-diff} → penyesuaian 701`
                          : 'tidak ada selisih'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <PdtButton variant="primary" onClick={submitBin} loading={busy}>
            <Save size={16} /> Posting bin ini
          </PdtButton>
        </>
      )}

      <PdtButton onClick={closeDoc} loading={busy}>
        <Lock size={16} /> Tutup dokumen
      </PdtButton>

      <p className="text-xxs text-sap-muted text-center">
        <Receipt size={11} className="inline mr-1" />
        Selisih buku − fisik diposting sebagai goods issue penjualan (601).
      </p>
    </PdtScreen>
  );
}
