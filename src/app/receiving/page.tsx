'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Scan, AlertTriangle, CheckCircle2, Package, ClipboardList, Pencil, X, Clock } from 'lucide-react';
import { parseBarcode } from '@/lib/utils/barcode';
import { cn } from '@/lib/utils/cn';
import toast from 'react-hot-toast';
import type { GRRecord } from '@/types';

interface ParsedResult {
  sapCode: string;
  batch: string;
  qtyCarton: number;
  description: string;
}

const LARGE_CARTON_THRESHOLD = 480;

// ---------- Edit Modal ----------

function EditModal({
  record,
  onClose,
  onSaved,
}: {
  record: GRRecord & { id: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qtyBox,    setQtyBox]    = useState(String(record.qtyBox));
  const [qtyCarton, setQtyCarton] = useState(String(record.qtyCarton));
  const [saving,    setSaving]    = useState(false);

  const newTotal = parseInt(qtyBox) > 0 && parseInt(qtyCarton) > 0
    ? parseInt(qtyBox) * parseInt(qtyCarton) : 0;

  const handleSave = async () => {
    if (newTotal <= 0) { toast.error('Total tidak valid'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/gr', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:       record.id,
          qtyBox:   parseInt(qtyBox),
          qtyCarton:parseInt(qtyCarton),
          totalQty: newTotal,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('GR berhasil diperbarui');
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-[rgb(var(--surface))] rounded-2xl border border-[rgb(var(--border))] w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgb(var(--border))]">
          <h3 className="font-semibold text-[rgb(var(--text))]">Edit GR</h3>
          <button onClick={onClose}><X size={18} className="text-muted" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-xs space-y-1 text-muted">
            <p><span className="font-medium">No PO:</span> {record.noPO} &nbsp;·&nbsp; <span className="font-medium">SJ:</span> {record.noSJ}</p>
            <p><span className="font-medium">SAP:</span> {record.sapCode} &nbsp;·&nbsp; <span className="font-medium">Batch:</span> {record.batch}</p>
            <p><span className="font-medium">Slot:</span> Received #{record.receivedSlot} &nbsp;·&nbsp; <span className="font-medium">Tgl:</span> {record.date}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">Jumlah Box</label>
              <input type="number" min="1" value={qtyBox} onChange={e => setQtyBox(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-bold" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--text))] mb-1">Isi / Box (PC)</label>
              <input type="number" min="1" value={qtyCarton} onChange={e => setQtyCarton(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>

          {newTotal > 0 && (
            <div className="text-center bg-brand-50 dark:bg-brand-900/20 rounded-xl p-3">
              <p className="text-xs text-muted mb-0.5">Total QTY baru (untuk entri ini)</p>
              <p className="text-2xl font-black text-brand-600 dark:text-brand-400">{newTotal.toLocaleString()} PC</p>
              {newTotal !== record.totalQty && (
                <p className="text-xs text-muted mt-0.5">
                  Sebelumnya: {record.totalQty.toLocaleString()} PC
                  {' '}({newTotal > record.totalQty ? '+' : ''}{(newTotal - record.totalQty).toLocaleString()})
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[rgb(var(--border))] text-sm font-medium text-muted">
              Batal
            </button>
            <button onClick={handleSave} disabled={saving || newTotal <= 0}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-bold transition-colors">
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- History Tab ----------

function HistoryTab() {
  const [records,   setRecords]   = useState<(GRRecord & { id: string })[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editTarget,setEditTarget] = useState<(GRRecord & { id: string }) | null>(null);
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/gr?date=${dateFilter}&limit=100`);
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, [dateFilter]);

  useEffect(() => { load(); }, [load]);

  const fmt = (ts: string) =>
    new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="date" value={dateFilter}
          onChange={e => setDateFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button onClick={load} className="px-3 py-2 rounded-lg border border-[rgb(var(--border))] text-sm text-muted hover:text-[rgb(var(--text))] transition-colors">
          Refresh
        </button>
        <span className="text-xs text-muted ml-auto">{records.length} record</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-7 w-7 border-2 border-brand-600 border-t-transparent" />
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-10 text-muted text-sm">Tidak ada GR pada tanggal ini.</div>
      ) : (
        <div className="space-y-2">
          {records.map((r) => (
            <div key={r.id}
              className="bg-[rgb(var(--surface))] border border-[rgb(var(--border))] rounded-xl p-4 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-[rgb(var(--text))]">{r.sapCode}</span>
                  <span className="text-xs bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 px-2 py-0.5 rounded-full font-medium">
                    Slot #{r.receivedSlot}
                  </span>
                  {r.editedAt && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                      Diedit
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted mt-1 space-y-0.5">
                  <p>PO: {r.noPO} &nbsp;·&nbsp; SJ: {r.noSJ}</p>
                  <p>Batch: {r.batch} &nbsp;·&nbsp; {r.qtyBox} box × {r.qtyCarton} PC</p>
                  <p className="font-semibold text-[rgb(var(--text))]">{r.totalQty.toLocaleString()} PC total</p>
                  <p className="flex items-center gap-1">
                    <Clock size={10}/> {fmt(r.timestamp)} · {r.operatorName}
                  </p>
                  {r.editedAt && r.editedBy && (
                    <p className="text-amber-600 dark:text-amber-400">
                      Edit: {fmt(r.editedAt)} oleh {r.editedBy}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setEditTarget(r)}
                className="p-2 rounded-lg hover:bg-[rgb(var(--bg))] text-muted hover:text-brand-600 transition-colors shrink-0"
                title="Edit">
                <Pencil size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {editTarget && (
        <EditModal
          record={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

// ---------- Input Tab ----------

function InputTab() {
  const shift = typeof window !== 'undefined'
    ? localStorage.getItem('current_shift') ?? 'Shift 1'
    : 'Shift 1';

  const [noPO,    setNoPO]    = useState('');
  const [noSJ,    setNoSJ]    = useState('');
  const [rawCode, setRawCode] = useState('');
  const [parsed,  setParsed]  = useState<ParsedResult | null>(null);
  const [qtyBox,  setQtyBox]  = useState('');
  const [customCarton, setCustomCarton] = useState('');
  const [showCartonWarning, setShowCartonWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastGR, setLastGR] = useState<{ sapCode: string; total: number; slot: number; merged: boolean } | null>(null);

  const barcodeRef = useRef<HTMLInputElement>(null);
  useEffect(() => { barcodeRef.current?.focus(); }, []);

  const handleBarcodeInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const val = rawCode.trim();
    if (!val) return;
    const result = parseBarcode(val);
    if (!result) { toast.error('Format barcode tidak dikenali'); return; }
    setParsed(result);
    setQtyBox('');
    setCustomCarton('');
    setShowCartonWarning(result.qtyCarton > LARGE_CARTON_THRESHOLD);
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
          ocsCode:   '',
          batch:     parsed.batch,
          qtyCarton: effectiveCarton,
          qtyBox:    parseInt(qtyBox),
          totalQty,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const msg = data.merged
        ? `Ditambahkan ke Slot ${data.slot} → total slot terbaru`
        : `GR baru Slot ${data.slot} → ${totalQty.toLocaleString()} PC`;
      toast.success(msg);
      setLastGR({ sapCode: parsed.sapCode, total: totalQty, slot: data.slot, merged: data.merged });

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
    <div className="space-y-4">
      {/* Last GR success banner */}
      {lastGR && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-3 flex items-center gap-3">
          <CheckCircle2 size={18} className="text-green-600 dark:text-green-400 shrink-0" />
          <div className="text-sm">
            <span className="font-semibold text-green-700 dark:text-green-400">
              {lastGR.merged ? `Slot ${lastGR.slot} diperbarui` : `GR #${lastGR.slot} berhasil`}
            </span>
            <span className="text-green-600 dark:text-green-500">
              {' '}· {lastGR.sapCode} · +{lastGR.total.toLocaleString()} PC
            </span>
          </div>
        </div>
      )}

      {/* Session info */}
      <div className="bg-[rgb(var(--surface))] rounded-xl border border-[rgb(var(--border))] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Info Sesi</p>
          <span className="text-xs px-2.5 py-1 bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 rounded-full font-medium">
            {shift}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        </div>
      </div>

      {/* Barcode scan */}
      <div className="bg-[rgb(var(--surface))] rounded-xl border border-[rgb(var(--border))] p-4 space-y-3">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-2">
          <Scan size={14} /> Scan Barcode
        </p>
        <input
          ref={barcodeRef}
          value={rawCode}
          onChange={e => setRawCode(e.target.value)}
          onKeyDown={handleBarcodeInput}
          placeholder="Arahkan scanner ke barcode atau ketik manual, tekan Enter…"
          className="w-full px-3 py-3 rounded-lg border-2 border-brand-400 bg-[rgb(var(--bg))] text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
          autoFocus
        />

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
                <span className="text-xs text-muted block">Isi / Box</span>
                <span className="font-bold text-[rgb(var(--text))]">{parsed.qtyCarton} PC</span>
              </div>
              <div>
                <span className="text-xs text-muted block">Deskripsi</span>
                <span className="text-[rgb(var(--text))] text-xs">{parsed.description || '—'}</span>
              </div>
            </div>
          </div>
        )}

        {showCartonWarning && parsed && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-500 shrink-0" />
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                Isi box &gt; {LARGE_CARTON_THRESHOLD} PC — Periksa ulang!
              </p>
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Barcode menunjukkan <b>{parsed.qtyCarton} PC</b> per box. Jika tidak sesuai, input manual:
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
              Jumlah Box *
            </label>
            <input
              type="number" value={qtyBox}
              onChange={e => setQtyBox(e.target.value)}
              placeholder="contoh: 2"
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

          {noSJ && (
            <p className="text-xs text-muted bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
              SJ <b>{noSJ}</b> hari ini → semua scan masuk ke slot yang sama secara otomatis
            </p>
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
  );
}

// ---------- Main Page ----------

export default function ReceivingPage() {
  const [tab, setTab] = useState<'input' | 'history'>('input');

  return (
    <AppShell>
      <div className="max-w-lg mx-auto space-y-4">
        <h1 className="text-xl font-bold text-[rgb(var(--text))]">PDA Receiving</h1>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-[rgb(var(--surface))] border border-[rgb(var(--border))] rounded-xl">
          {[
            { key: 'input',   label: 'Input GR',  icon: Scan },
            { key: 'history', label: 'Riwayat',   icon: ClipboardList },
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key as typeof tab)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors',
                tab === key
                  ? 'bg-[rgb(var(--bg))] text-[rgb(var(--text))] shadow-sm'
                  : 'text-muted hover:text-[rgb(var(--text))]'
              )}>
              <Icon size={15}/> {label}
            </button>
          ))}
        </div>

        {tab === 'input' ? <InputTab /> : <HistoryTab />}
      </div>
    </AppShell>
  );
}
