'use client';
import { useState, useRef, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Scan, AlertTriangle, CheckCircle2, XCircle, Package } from 'lucide-react';
import { parseBarcode } from '@/lib/utils/barcode';
import { cn } from '@/lib/utils/cn';
import toast from 'react-hot-toast';

interface ParsedResult {
  sapCode: string;
  batch: string;
  qtyCarton: number;
  description: string;
}

const LARGE_CARTON_THRESHOLD = 480;

export default function ReceivingPage() {
  const [noPO,    setNoPO]    = useState('');
  const [noSJ,    setNoSJ]    = useState('');
  const [shift,   setShift]   = useState(() => typeof window !== 'undefined' ? localStorage.getItem('current_shift') ?? 'Shift 1' : 'Shift 1');
  const [rawCode, setRawCode] = useState('');
  const [parsed,  setParsed]  = useState<ParsedResult | null>(null);
  const [qtyBox,  setQtyBox]  = useState('');
  const [customCarton, setCustomCarton] = useState('');
  const [showCartonWarning, setShowCartonWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastGR, setLastGR]   = useState<{sapCode:string; total:number; slot:number} | null>(null);

  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { barcodeRef.current?.focus(); }, []);

  const handleBarcodeInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const val = rawCode.trim();
      if (!val) return;
      const result = parseBarcode(val);
      if (!result) { toast.error('Format barcode tidak dikenali'); return; }
      setParsed(result);
      setQtyBox('');
      setCustomCarton('');
      if (result.qtyCarton > LARGE_CARTON_THRESHOLD) {
        setShowCartonWarning(true);
      } else {
        setShowCartonWarning(false);
      }
    }
  };

  const effectiveCarton = customCarton ? parseInt(customCarton) : parsed?.qtyCarton ?? 0;
  const totalQty = qtyBox && effectiveCarton ? parseInt(qtyBox) * effectiveCarton : 0;

  const handleSubmit = async () => {
    if (!noPO || !noSJ) { toast.error('No PO dan No Surat Jalan wajib diisi'); return; }
    if (!parsed)        { toast.error('Scan barcode terlebih dahulu'); return; }
    if (!qtyBox || parseInt(qtyBox) <= 0) { toast.error('Jumlah box harus diisi'); return; }
    if (totalQty <= 0)  { toast.error('Total QTY tidak valid'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/gr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noPO, noSJ, shift,
          sapCode:   parsed.sapCode,
          ocsCode:   '',  // server will resolve via master_items
          batch:     parsed.batch,
          qtyCarton: effectiveCarton,
          qtyBox:    parseInt(qtyBox),
          totalQty,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast.success(`GR berhasil! Slot ${data.slot} → ${totalQty.toLocaleString()} PC`);
      setLastGR({ sapCode: parsed.sapCode, total: totalQty, slot: data.slot });

      // Reset for next scan
      setRawCode('');
      setParsed(null);
      setQtyBox('');
      setCustomCarton('');
      setShowCartonWarning(false);
      barcodeRef.current?.focus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'GR gagal');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-lg mx-auto space-y-4">
        <h1 className="text-xl font-bold text-[rgb(var(--text))]">PDA Receiving</h1>

        {/* Last GR success banner */}
        {lastGR && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3 flex items-center gap-3">
            <CheckCircle2 size={18} className="text-green-600 dark:text-green-400 shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-green-700 dark:text-green-400">GR #{lastGR.slot} berhasil</span>
              <span className="text-green-600 dark:text-green-500"> · {lastGR.sapCode} · {lastGR.total.toLocaleString()} PC</span>
            </div>
          </div>
        )}

        {/* Session info */}
        <div className="bg-[rgb(var(--surface))] rounded-xl border border-[rgb(var(--border))] p-4 space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Info Sesi</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">No PO *</label>
              <input value={noPO} onChange={e => setNoPO(e.target.value)}
                placeholder="contoh: 1023"
                className="w-full px-3 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">No Surat Jalan *</label>
              <input value={noSJ} onChange={e => setNoSJ(e.target.value)}
                placeholder="contoh: SJ-001/VI/2026"
                className="w-full px-3 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">Shift</label>
              <select value={shift} onChange={e => { setShift(e.target.value); localStorage.setItem('current_shift', e.target.value); }}
                className="w-full px-3 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                {['Shift 1','Shift 2','Shift 3','Non Shift'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Barcode scan */}
        <div className="bg-[rgb(var(--surface))] rounded-xl border border-[rgb(var(--border))] p-4 space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-2">
            <Scan size={14} /> Scan Barcode
          </p>
          <div className="relative">
            <input
              ref={barcodeRef}
              value={rawCode}
              onChange={e => setRawCode(e.target.value)}
              onKeyDown={handleBarcodeInput}
              placeholder="Arahkan scanner ke barcode atau ketik manual, tekan Enter…"
              className="w-full px-3 py-3 rounded-lg border-2 border-brand-400 bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
              autoFocus
            />
          </div>

          {/* Parsed result */}
          {parsed && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs text-muted block">SAP Code</span>
                  <span className="font-mono font-bold text-[rgb(var(--text))]">{parsed.sapCode}</span>
                </div>
                <div>
                  <span className="text-xs text-muted block">Batch</span>
                  <span className="font-mono text-[rgb(var(--text))]">{parsed.batch}</span>
                </div>
                <div>
                  <span className="text-xs text-muted block">Isi / Karton</span>
                  <span className="font-bold text-[rgb(var(--text))]">{parsed.qtyCarton} PC</span>
                </div>
                <div>
                  <span className="text-xs text-muted block">Deskripsi</span>
                  <span className="text-[rgb(var(--text))] text-xs">{parsed.description || '—'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Warning popup */}
          {showCartonWarning && parsed && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-500 shrink-0" />
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                  Isi karton &gt; {LARGE_CARTON_THRESHOLD} PC — Periksa ulang!
                </p>
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-500">
                Barcode menunjukkan <b>{parsed.qtyCarton} PC</b> per karton. Jika tidak sesuai, input manual:
              </p>
              <div>
                <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">Isi Box (manual)</label>
                <input type="number" value={customCarton} onChange={e => setCustomCarton(e.target.value)}
                  placeholder={String(parsed.qtyCarton)}
                  className="w-full px-3 py-2 rounded-lg border border-amber-300 bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
            </div>
          )}
        </div>

        {/* Qty input */}
        {parsed && (
          <div className="bg-[rgb(var(--surface))] rounded-xl border border-[rgb(var(--border))] p-4 space-y-3">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-2">
              <Package size={14}/> Input Jumlah
            </p>
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">
                Jumlah Box / Palet *
              </label>
              <input
                type="number" value={qtyBox}
                onChange={e => setQtyBox(e.target.value)}
                placeholder="contoh: 2 (untuk 2 palet)"
                min="1"
                className="w-full px-3 py-3 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 text-lg font-bold"
              />
            </div>

            {totalQty > 0 && (
              <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-xl p-4 text-center">
                <p className="text-xs text-muted mb-1">Total QTY yang akan di-GR</p>
                <p className="text-3xl font-black text-brand-600 dark:text-brand-400">
                  {totalQty.toLocaleString()} <span className="text-base font-semibold">PC</span>
                </p>
                <p className="text-xs text-muted mt-1">
                  {qtyBox} box × {effectiveCarton} PC/box
                </p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || totalQty <= 0 || !noPO || !noSJ}
              className={cn(
                'w-full py-4 rounded-xl text-base font-bold text-white transition-colors',
                submitting || totalQty <= 0 || !noPO || !noSJ
                  ? 'bg-slate-300 dark:bg-slate-600 cursor-not-allowed'
                  : 'bg-brand-600 hover:bg-brand-700 active:bg-brand-800'
              )}
            >
              {submitting ? 'Menyimpan…' : 'SIMPAN GR'}
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
