'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, Save, RefreshCw, ChevronRight, Plus, Trash2, PackageX, ListChecks } from 'lucide-react';
import { PdtScreen, PdtInput, PdtButton, PdtRow, PdtMessage } from '@/components/pdt/ui';
import { api, patch, fmtDateTime } from '@/lib/client';
import { resolveScan } from '@/lib/barcode';
import { fillMfg, DEFAULT_SHELF_LIFE_YEARS } from '@/lib/shelflife';

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

interface BinStat {
  bin_code: string;
  counted_at: string | null;
  counted_by: string | null;
}

interface Doc {
  id: string;
  doc_number: string;
  scope_value: string;
  frozen_bins: string[];
  status: string;
  items: Item[];
  bins: BinStat[];
}

interface DocRow {
  id: string;
  doc_number: string;
  scope_value: string;
  bin_count: number;
  bins_counted: number;
  item_count: number;
  status: string;
}

/** baris material yang ditemukan fisik tapi tidak ada di snapshot */
interface Extra {
  key: string;
  material_code: string;
  batch_number: string;
  mfg_date: string;
  exp_date: string;
  qty: string;
}

/**
 * ZRF05 — Physical Inventory Count (PDT).
 *
 * Opname besar dikerjakan banyak orang sekaligus dan tidak berurutan, jadi
 * layar ini berpusat pada DAFTAR KERJA: bin mana yang belum dihitung. Setiap
 * bin yang selesai ditandai lengkap dengan jam dan nama penghitungnya.
 *
 * Satu pallet bisa memuat lebih dari satu material, karena itu operator juga
 * bisa menambahkan material yang tidak ada di snapshot langsung dari sini.
 */
export default function ZrfCountPage() {
  const [list, setList] = useState<DocRow[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [bin, setBin] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<Extra[]>([]);
  const [showOutstanding, setShowOutstanding] = useState(false);
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
    setExtras([]);
    setBin('');
    setTimeout(() => binRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const binCode = bin.trim().toUpperCase();
  const binItems = doc ? doc.items.filter((i) => i.bin_code === binCode) : [];
  const binStat = doc?.bins.find((b) => b.bin_code === binCode) ?? null;
  const inScope = !!doc && doc.frozen_bins.includes(binCode);

  const outstanding = doc ? doc.bins.filter((b) => b.counted_at === null) : [];
  const doneCount = doc ? doc.bins.length - outstanding.length : 0;

  /** Kumpulkan payload: baris snapshot + baris temuan, lalu tandai bin selesai. */
  async function submit(markEmpty = false) {
    if (!doc || !inScope) return;

    const items: Record<string, unknown>[] = binItems
      .filter((i) => markEmpty || (counts[i.id] !== undefined && counts[i.id] !== ''))
      .map((i) => ({
        id: i.id,
        bin_code: i.bin_code,
        material_code: i.material_code,
        batch_number: i.batch_number,
        counted_qty: markEmpty ? 0 : Number(counts[i.id]),
      }));

    if (!markEmpty) {
      for (const e of extras) {
        const code = e.material_code.trim().toUpperCase();
        if (!code) return setMsg({ text: 'Material temuan belum diisi', type: 'E' });
        const n = Number(e.qty);
        if (!e.qty || !Number.isFinite(n) || n < 0)
          return setMsg({ text: `Qty temuan ${code} tidak valid`, type: 'E' });
        items.push({
          bin_code: binCode,
          material_code: code,
          batch_number: e.batch_number.trim().toUpperCase() || null,
          mfg_date: e.mfg_date || null,
          exp_date: e.exp_date || null,
          counted_qty: n,
        });
      }
    }

    if (items.length === 0 && !markEmpty)
      return setMsg({ text: 'Belum ada qty yang diisi', type: 'E' });

    setBusy(true);
    const r = await patch(`/api/physinv/${doc.id}`, { items, counted_bins: [binCode] });
    setBusy(false);
    setMsg({ text: r.message, type: r.ok ? 'S' : 'E' });
    if (r.ok) {
      await openDoc(doc.id);
      binRef.current?.focus();
    }
  }

  /** Scan barcode material pada baris temuan -> resolve ke kode material. */
  async function resolveExtra(key: string, raw: string) {
    const v = raw.trim();
    if (!v) return;
    const rs = await resolveScan(v);
    if (!rs.ok) return setMsg({ text: rs.message ?? 'Barcode tidak dikenal', type: 'E' });
    setExtras((s) =>
      s.map((e) =>
        e.key === key
          ? { ...e, material_code: rs.material_code, batch_number: rs.batch_number || e.batch_number }
          : e
      )
    );
  }

  /* ------------------------------- daftar dokumen ------------------------------- */
  if (!doc) {
    return (
      <PdtScreen title="Stock Count" code="ZRF05">
        {msg && <PdtMessage text={msg.text} type={msg.type} />}
        <PdtButton onClick={loadList} loading={loading}>
          <RefreshCw size={16} /> Refresh
        </PdtButton>
        <div className="space-y-1.5 max-h-[52dvh] overflow-auto">
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
                <p className="text-2xs text-sap-text truncate">{d.scope_value}</p>
                <p className="text-xxs text-sap-muted font-mono">
                  {d.bins_counted}/{d.bin_count} bin selesai · {d.item_count} line · {d.status}
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

  /* ------------------------------- layar hitung ------------------------------- */
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

      <div className="rounded-[3px] border border-sap-border bg-sap-panelalt px-3 py-2">
        <PdtRow label="Dokumen" value={doc.doc_number} accent />
        <PdtRow label="Progres bin" value={`${doneCount} / ${doc.bins.length} selesai`} />
        <PdtRow label="Belum dihitung" value={`${outstanding.length}`} />
      </div>

      <PdtButton onClick={() => setShowOutstanding((v) => !v)}>
        <ListChecks size={16} /> {showOutstanding ? 'Tutup' : 'Lihat'} bin belum dihitung
      </PdtButton>

      {showOutstanding && (
        <div className="space-y-1 max-h-[30dvh] overflow-auto">
          {outstanding.map((b) => (
            <button
              key={b.bin_code}
              type="button"
              onClick={() => {
                setBin(b.bin_code);
                setShowOutstanding(false);
              }}
              className="w-full text-left rounded-[3px] border border-sap-border bg-sap-panelalt
                         px-3 py-2 font-mono text-sm hover:border-sap-blue/60"
            >
              {b.bin_code}
            </button>
          ))}
          {outstanding.length === 0 && (
            <p className="text-2xs text-sap-oktext text-center py-3">
              Semua bin sudah dihitung. Posting selisih dilakukan admin di LI11N.
            </p>
          )}
        </div>
      )}

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

      {binCode !== '' && !inScope && (
        <PdtMessage
          text={`Bin ${binCode} tidak termasuk dokumen ini. Barang di rak lain diproses lewat dokumen opname tersendiri (LI01N).`}
          type="E"
        />
      )}

      {binCode !== '' && inScope && (
        <>
          {binStat?.counted_at && (
            <PdtMessage
              text={`Bin ini sudah dihitung ${fmtDateTime(binStat.counted_at)} oleh ${binStat.counted_by ?? '-'}. Menyimpan lagi akan menimpa hasilnya.`}
              type="W"
            />
          )}

          {binItems.length === 0 && extras.length === 0 && (
            <PdtMessage
              text="Bin ini kosong menurut sistem. Kalau memang kosong, tekan Bin kosong. Kalau ada barang, tambahkan lewat Tambah temuan."
              type="I"
            />
          )}

          <div className="space-y-2 max-h-[34dvh] overflow-auto">
            {binItems.map((it) => (
              <div key={it.id} className="rounded-[3px] border border-sap-border bg-sap-panelalt px-3 py-2 space-y-1.5">
                <p className="font-mono text-sm text-sap-blue">{it.material_code}</p>
                <p className="text-2xs text-sap-text truncate">{it.description}</p>
                <p className="text-xxs text-sap-muted font-mono">
                  {it.batch_number || 'no batch'} · book {it.book_qty} {it.uom}
                  {it.counted_qty !== null ? ` · tercatat ${it.counted_qty}` : ''}
                </p>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="Qty fisik"
                  disabled={it.posted}
                  value={counts[it.id] ?? ''}
                  onChange={(e) => setCounts((s) => ({ ...s, [it.id]: e.target.value }))}
                  className="w-full bg-sap-cmd border-2 border-sap-border focus:border-sap-blue outline-none
                             rounded-[3px] px-3 py-2 text-base font-mono text-right"
                />
              </div>
            ))}

            {/* baris temuan — material yang tidak ada di snapshot (pallet campur) */}
            {extras.map((e) => (
              <div
                key={e.key}
                className="rounded-[3px] border-2 border-sap-warnborder bg-sap-warnbg/40 px-3 py-2 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xxs uppercase tracking-wide text-sap-warntext">Temuan</span>
                  <button
                    type="button"
                    onClick={() => setExtras((s) => s.filter((x) => x.key !== e.key))}
                    className="text-sap-muted p-1"
                    aria-label="Hapus baris temuan"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <PdtInput
                  label="Material / barcode"
                  value={e.material_code}
                  onChange={(ev) =>
                    setExtras((s) =>
                      s.map((x) =>
                        x.key === e.key ? { ...x, material_code: ev.target.value.toUpperCase() } : x
                      )
                    )
                  }
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') resolveExtra(e.key, (ev.target as HTMLInputElement).value);
                  }}
                />
                <PdtInput
                  label="Batch (kosongkan bila tidak ada)"
                  value={e.batch_number}
                  onChange={(ev) =>
                    setExtras((s) =>
                      s.map((x) =>
                        x.key === e.key ? { ...x, batch_number: ev.target.value.toUpperCase() } : x
                      )
                    )
                  }
                />
                <PdtInput
                  label="Expired Date"
                  type="date"
                  hint="Kosongkan bila material tidak punya masa simpan."
                  value={e.exp_date}
                  onChange={(ev) =>
                    setExtras((s) =>
                      s.map((x) =>
                        x.key === e.key
                          ? {
                              ...x,
                              exp_date: ev.target.value,
                              mfg_date: fillMfg(ev.target.value, x.mfg_date),
                            }
                          : x
                      )
                    )
                  }
                />
                <PdtInput
                  label="Manufacturing Date"
                  type="date"
                  hint={`Otomatis: expired date − ${DEFAULT_SHELF_LIFE_YEARS} tahun.`}
                  value={e.mfg_date}
                  onChange={(ev) =>
                    setExtras((s) =>
                      s.map((x) => (x.key === e.key ? { ...x, mfg_date: ev.target.value } : x))
                    )
                  }
                />
                <PdtInput
                  label="Qty fisik"
                  type="number"
                  inputMode="numeric"
                  value={e.qty}
                  onChange={(ev) =>
                    setExtras((s) =>
                      s.map((x) => (x.key === e.key ? { ...x, qty: ev.target.value } : x))
                    )
                  }
                />
              </div>
            ))}
          </div>

          <PdtButton
            onClick={() =>
              setExtras((s) => [
                ...s,
                {
                  key: Math.random().toString(36).slice(2),
                  material_code: '',
                  batch_number: '',
                  mfg_date: '',
                  exp_date: '',
                  qty: '',
                },
              ])
            }
          >
            <Plus size={16} /> Tambah temuan (material lain di bin ini)
          </PdtButton>

          <div className="grid grid-cols-2 gap-2">
            <PdtButton onClick={() => submit(true)} loading={busy}>
              <PackageX size={16} /> Bin kosong
            </PdtButton>
            <PdtButton variant="primary" onClick={() => submit(false)} loading={busy}>
              <Save size={16} /> Simpan & selesai
            </PdtButton>
          </div>
        </>
      )}

      <p className="text-xxs text-sap-muted text-center">
        <ClipboardList size={11} className="inline mr-1" />
        Posting selisih (701/702) dilakukan admin di LI11N.
      </p>
    </PdtScreen>
  );
}
