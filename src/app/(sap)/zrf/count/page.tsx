'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, Save, RefreshCw, ChevronRight, Plus, Trash2, PackageX, ListChecks, Replace } from 'lucide-react';
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
  round: number;
  /** true = jumlah menurut sistem sengaja tidak dikirim ke layar ini */
  blind_book: boolean;
  /** true = dokumen dikelola ZSO01, raknya bertuan */
  managed: boolean;
  /** true = penugasan memakai satuan material, bukan rak */
  by_material: boolean;
  /** material yang jadi cakupan; kosong = seluruh isi rak */
  scope_materials: string[];
  /** jumlah material lain yang ada di rak tetapi di luar cakupan */
  out_of_scope: { bin_code: string; materials: number }[];
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
  round: number;
  managed: boolean;
}

/** baris material yang ditemukan fisik tapi tidak ada di snapshot */
interface Extra {
  key: string;
  material_code: string;
  batch_number: string;
  mfg_date: string;
  exp_date: string;
  qty: string;
  /**
   * Penanda pasangan koreksi batch. Baris batch lama (dihitung 0) dan baris
   * batch pengganti berbagi nilai ini, sehingga laporan bisa mengenalinya
   * sebagai SATU kekeliruan batch, bukan dua temuan terpisah.
   */
  swap_group?: string;
  /** batch lama yang digantikan — hanya untuk ditampilkan di layar */
  swap_from?: string;
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
 *
 * Sejak ada opname terkelola (ZSO01), layar ini hanya menampilkan rak yang
 * DITUGASKAN ke petugas yang sedang login. Rak tanpa penugasan tetap terlihat
 * semua orang, jadi dokumen LI01N lama tidak berubah perilakunya.
 *
 * Bila rondenya buta, jumlah menurut sistem tidak dikirim sama sekali dari
 * server — bukan sekadar disembunyikan dari tampilan, karena angka yang
 * terkirim tetap terbaca lewat panel jaringan peramban.
 */
export default function ZrfCountPage() {
  const [list, setList] = useState<DocRow[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [bin, setBin] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<Extra[]>([]);
  /** id baris snapshot -> penanda pasangan koreksi batch */
  const [swapMark, setSwapMark] = useState<Record<string, string>>({});
  const [showOutstanding, setShowOutstanding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'S' | 'E' | 'W' | 'I' } | null>(null);
  const binRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    // ?mine=1 -> hanya dokumen yang ada jatahnya untuk user ini
    const r = await api<DocRow[]>('/api/physinv?mine=1');
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });
    setList((r.data ?? []).filter((d) => d.status === 'FROZEN' || d.status === 'COUNTED'));
  }, []);

  const openDoc = useCallback(async (id: string) => {
    setLoading(true);
    const r = await api<Doc>(`/api/physinv/${id}?mine=1`);
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

  /**
   * SATU KARTU UNTUK SKU YANG TIDAK BISA DIBEDAKAN
   * ===========================================================================
   *
   * Beberapa SKU sengaja dipelihara dengan deskripsi yang sama. Pada barang
   * lepas, petugas tidak punya cara apa pun untuk tahu botol di tangannya milik
   * SKU yang mana — yang tertempel hanya barcode produk / QR B-POM, dan itu
   * cuma menunjuk SKU yang kebetulan memegang barcode tersebut.
   *
   * Tanpa penggabungan ini, layar menampilkan DUA KARTU BERISI DESKRIPSI YANG
   * SAMA PERSIS dan petugas harus membagi hitungannya di antara keduanya. Yang
   * rusak bukan angkanya — reklasifikasi 309 saat posting sudah merapikan
   * bukunya — melainkan KESEPAKATANNYA: konsensus dihitung per (rak, material,
   * batch), jadi ronde 1 yang menaruh 140 di SKU-A dan ronde 2 yang menaruh 140
   * di SKU-B tidak pernah menghasilkan satu baris pun dengan tiga suara. Ketiga
   * orang menghitung angka yang sama, tetapi dokumennya terkunci UNRESOLVED.
   *
   * Karena itu SISTEM yang memilih SKU-nya, bukan petugas, dan pilihannya sama
   * di setiap ronde: buku terbesar, seri diputus kode material. Angka masuk ke
   * SKU itu, anggota lain nol, dan 309 saat posting memindahkan bukunya.
   */
  interface CountGroup {
    key: string;
    anchor: Item;
    members: Item[];
    book_qty: number;
    grouped: boolean;
  }

  const binGroups: CountGroup[] = (() => {
    const map = new Map<string, Item[]>();
    for (const i of binItems) {
      const k = `${i.batch_number ?? ''}|${(i.description ?? '').trim().toUpperCase()}`;
      const arr = map.get(k);
      if (arr) arr.push(i);
      else map.set(k, [i]);
    }
    return [...map.entries()].map(([key, members]) => {
      // book_qty adalah snapshot saat freeze — nilainya sama di semua ronde,
      // jadi jangkarnya pasti sama pula. Itu syaratnya, bukan kebetulan.
      const sorted = [...members].sort(
        (a, b) => b.book_qty - a.book_qty || (a.material_code < b.material_code ? -1 : 1)
      );
      return {
        key,
        anchor: sorted[0],
        members: sorted,
        book_qty: members.reduce((t, m) => t + m.book_qty, 0),
        grouped: members.length > 1,
      };
    });
  })();

  const outOfScopeHere = doc?.out_of_scope.find((o) => o.bin_code === binCode)?.materials ?? 0;

  const outstanding = doc ? doc.bins.filter((b) => b.counted_at === null) : [];
  const doneCount = doc ? doc.bins.length - outstanding.length : 0;

  /** Kumpulkan payload: baris snapshot + baris temuan, lalu tandai bin selesai. */
  async function submit(markEmpty = false) {
    if (!doc || !inScope) return;

    const items: Record<string, unknown>[] = [];
    for (const g of binGroups) {
      const raw = counts[g.anchor.id];
      const filled = raw !== undefined && raw !== '';
      if (!markEmpty && !filled) continue;

      items.push({
        id: g.anchor.id,
        bin_code: g.anchor.bin_code,
        material_code: g.anchor.material_code,
        batch_number: g.anchor.batch_number,
        counted_qty: markEmpty ? 0 : Number(raw),
        ...(swapMark[g.anchor.id] ? { swap_group: swapMark[g.anchor.id] } : {}),
      });

      /**
       * Anggota lain dikirim NOL, bukan dibiarkan kosong.
       *
       * Baris yang tidak dikirim dianggap belum dihitung, dan baris yang belum
       * dihitung tidak akan pernah menghasilkan selisih negatif untuk
       * dipasangkan — reklasifikasi 309-nya kehilangan lawan, dan seluruh angka
       * di SKU jangkar terbaca sebagai selisih lebih yang sesungguhnya.
       */
      for (const m of g.members) {
        if (m.id === g.anchor.id) continue;
        items.push({
          id: m.id,
          bin_code: m.bin_code,
          material_code: m.material_code,
          batch_number: m.batch_number,
          counted_qty: 0,
        });
      }
    }

    if (!markEmpty) {
      for (const e of extras) {
        const code = e.material_code.trim().toUpperCase();
        if (!code) return setMsg({ text: 'Material temuan belum diisi', type: 'E' });
        // Ditahan di layar juga, bukan hanya di server: pesan di sini muncul
        // sebelum petugas mengetik qty dan tanggal, jadi tidak ada usaha yang
        // terbuang.
        if (doc.scope_materials.length > 0 && !doc.scope_materials.includes(code))
          return setMsg({
            text: `Material ${code} di luar cakupan opname ini — tidak perlu dihitung.`,
            type: 'E',
          });
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
          ...(e.swap_group ? { swap_group: e.swap_group } : {}),
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

  /**
   * Ganti batch — barangnya ada, batasnya yang salah catat.
   *
   * Sekali tekan mengerjakan dua hal sekaligus: batch lama dinolkan dan baris
   * batch pengganti dibuat. Dikerjakan berpasangan karena mengerjakan
   * setengahnya justru merusak stok — kalau hanya batch penggantinya yang
   * ditambahkan tanpa menolkan yang lama, stok material itu jadi berganda.
   */
  function swapBatch(it: Item) {
    const group = `SW${Date.now().toString(36).toUpperCase()}`;
    setCounts((c) => ({ ...c, [it.id]: '0' }));
    setExtras((s) => [
      ...s,
      {
        key: `x${Date.now()}`,
        material_code: it.material_code,
        batch_number: '',
        mfg_date: '',
        exp_date: '',
        qty: '',
        swap_group: group,
        swap_from: it.batch_number || '(tanpa batch)',
      },
    ]);
    setSwapMark((m) => ({ ...m, [it.id]: group }));
    setMsg({
      text: `Batch ${it.batch_number || '(tanpa batch)'} dinolkan. Isi batch penggantinya di baris temuan di bawah.`,
      type: 'I',
    });
  }

  /** Scan barcode material pada baris temuan -> resolve ke kode material. */
  async function resolveExtra(key: string, raw: string) {
    const v = raw.trim();
    if (!v) return;
    const rs = await resolveScan(v);
    if (!rs.ok) return setMsg({ text: rs.message ?? 'Barcode tidak dikenal', type: 'E' });

    /**
     * Barcode item tidak bisa membedakan SKU yang deskripsinya sama, dan
     * hasilnya jatuh seluruhnya ke SKU yang kebetulan memegang barcode itu.
     * Petugas diberi tahu SEKARANG, saat kartonnya masih di tangan dan kode
     * master box masih bisa discan — setelah barisnya tersimpan, tidak ada lagi
     * yang menunjukkan bahwa angkanya bisa jatuh ke SKU yang keliru.
     */
    if (rs.twins && rs.twins.length > 0) setMsg({ text: rs.message ?? '', type: 'W' });

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
              className="w-full text-left rounded-sappanel border border-sap-border bg-sap-panelalt px-3 py-2.5
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

      <div className="rounded-sappanel border border-sap-border bg-sap-panelalt px-3 py-2">
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
              className="w-full text-left rounded-sappanel border border-sap-border bg-sap-panelalt
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
          text={
            doc?.by_material
              ? `Rak ${binCode} tidak memuat material yang menjadi jatah Anda pada ronde ${doc.round}. Material lain di rak ini dikerjakan petugas lain.`
              : doc?.managed
                ? `Rak ${binCode} bukan jatah Anda pada ronde ${doc.round}, atau tidak termasuk dokumen ini. Minta admin menugaskan ulang di ZSO01 bila memang perlu Anda hitung.`
                : `Bin ${binCode} tidak termasuk dokumen ini. Barang di rak lain diproses lewat dokumen opname tersendiri (LI01N).`
          }
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

          {outOfScopeHere > 0 && (
            <PdtMessage
              text={`${outOfScopeHere} SKU lain ada di rak ini tetapi DI LUAR cakupan opname — jangan dihitung, jangan ditambahkan sebagai temuan.`}
              type="I"
            />
          )}

          {binItems.length === 0 && extras.length === 0 && (
            <PdtMessage
              text={
                doc.blind_book
                  ? 'Tidak ada baris untuk rak ini. Kalau rak memang kosong, tekan Bin kosong. Kalau ada barang, tambahkan lewat Tambah temuan.'
                  : 'Bin ini kosong menurut sistem. Kalau memang kosong, tekan Bin kosong. Kalau ada barang, tambahkan lewat Tambah temuan.'
              }
              type="I"
            />
          )}

          <div className="space-y-2 max-h-[34dvh] overflow-auto">
            {binGroups.map((g) => {
              const it = g.anchor;
              return (
                <div
                  key={g.key}
                  className={`rounded-sappanel border px-3 py-2 space-y-1.5 ${
                    g.grouped
                      ? 'border-sap-infoborder bg-sap-infobg/30'
                      : 'border-sap-border bg-sap-panelalt'
                  }`}
                >
                  <p className="font-mono text-sm text-sap-blue">{it.material_code}</p>
                  <p className="text-2xs text-sap-text truncate">{it.description}</p>

                  {g.grouped && (
                    <p className="text-xxs text-sap-infotext leading-snug">
                      {g.members.length} SKU berdeskripsi sama digabung jadi satu hitungan (
                      {g.members.map((m) => m.material_code).join(', ')}). Hitung SELURUH barang
                      dengan deskripsi ini di rak — jangan dipisah per kode, karena pada barang
                      lepas kodenya memang tidak bisa dibedakan. Sistem yang membagi bukunya.
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xxs text-sap-muted font-mono min-w-0 truncate">
                      {it.batch_number || 'no batch'}
                      {doc.blind_book ? ' · buta' : ` · book ${g.book_qty} ${it.uom}`}
                      {it.counted_qty !== null ? ` · tercatat ${it.counted_qty}` : ''}
                    </p>
                    {/*
                      Ganti batch sengaja TIDAK ditawarkan untuk kartu gabungan.
                      Reklasifikasi SKU memasangkan selisih pada batch yang sama;
                      bila jangkarnya pindah ke batch baru sementara kembarannya
                      ternol di batch lama, pasangannya tidak ketemu dan keduanya
                      terbaca sebagai selisih stok sungguhan. Batch yang keliru
                      pada SKU sekelompok dibetulkan setelah posting lewat MIGO
                      Ubah Batch.
                    */}
                    {!g.grouped && !it.posted && !swapMark[it.id] && (
                      <button
                        type="button"
                        onClick={() => swapBatch(it)}
                        title="Barangnya ada, tapi batch-nya berbeda dari catatan"
                        className="sap-btn !py-[3px] !px-2 text-xxs shrink-0"
                      >
                        <Replace size={12} /> Ganti batch
                      </button>
                    )}
                    {swapMark[it.id] && (
                      <span className="sap-badge border-sap-infoborder bg-sap-infobg text-sap-infotext shrink-0">
                        diganti
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder={g.grouped ? 'Qty fisik (semua SKU)' : 'Qty fisik'}
                    disabled={it.posted}
                    value={counts[it.id] ?? ''}
                    onChange={(e) => setCounts((s) => ({ ...s, [it.id]: e.target.value }))}
                    className="w-full bg-sap-cmd border-2 border-sap-border focus:border-sap-blue outline-none
                               rounded-sappanel px-3 py-2 text-base font-mono text-right"
                  />
                </div>
              );
            })}

            {/* baris temuan — material yang tidak ada di snapshot (pallet campur) */}
            {extras.map((e) => (
              <div
                key={e.key}
                className="rounded-sappanel border-2 border-sap-warnborder bg-sap-warnbg/40 px-3 py-2 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xxs uppercase tracking-wide text-sap-warntext">
                    {e.swap_from ? `Pengganti batch ${e.swap_from}` : 'Temuan'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setExtras((s) => s.filter((x) => x.key !== e.key));
                      // Membatalkan baris pengganti harus ikut melepas penanda
                      // di baris asalnya, kalau tidak batch lama tetap ternol
                      // tanpa ada penggantinya — dan stok jadi berkurang diam-diam.
                      if (e.swap_group) {
                        setSwapMark((m) => {
                          const n = { ...m };
                          for (const k of Object.keys(n)) if (n[k] === e.swap_group) delete n[k];
                          return n;
                        });
                      }
                    }}
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
