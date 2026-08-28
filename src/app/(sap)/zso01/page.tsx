'use client';

/**
 * ZSO01 — Opname Terkelola (buat dokumen, pilih rak, tugaskan petugas).
 *
 * Bedanya dengan LI01N: di sana cakupan ditentukan sekaligus (satu zona, atau
 * seluruh gudang) lalu siapa pun boleh menghitung rak mana pun. Layar ini
 * dipakai untuk opname besar berpetugas banyak, jadi urutannya berbeda:
 *
 *   1. cari rak — berdasarkan MATERIAL (rak mana saja yang memuatnya) atau ZONA
 *   2. centang rak mana yang ikut di-freeze
 *   3. tugaskan tiap rak ke petugas
 *   4. tentukan pengaturan blind, lalu buka ronde 1
 *
 * Penugasan itulah yang membuat hitungan ronde kedua bisa dipercaya: siapa
 * menghitung apa tercatat sejak awal, sehingga ronde ulang bisa dipastikan
 * dikerjakan orang yang berbeda.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ClipboardList,
  Search,
  Users,
  Snowflake,
  EyeOff,
  Eye,
  Trash2,
  RotateCcw,
  X,
  Boxes,
} from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, ActionField } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useZones } from '@/components/sap/hooks';
import { ConfirmDialog } from '@/components/sap/Confirm';
import { api, post, qs } from '@/lib/client';
import { useMaterialCatalog } from '@/lib/catalog';

/**
 * Pemilih banyak material sekaligus.
 *
 * Ketik kode atau nama, pilih dari saran, lalu ketik lagi untuk material
 * berikutnya. Yang sudah terpilih menjadi chip dan tidak ditawarkan lagi.
 *
 * Sarannya dirender lewat portal dengan posisi fixed, sama seperti di ZREPL:
 * daftar yang muncul di dalam panel ber-overflow akan terpotong setinggi satu
 * baris dan tampak seperti tidak ada saran sama sekali.
 */
function MultiMaterialPicker({
  picked,
  onAdd,
  onRemove,
}: {
  picked: string[];
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
}) {
  const { materials } = useMaterialCatalog();
  const boxRef = useRef<HTMLDivElement>(null);
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const descOf = useMemo(
    () => new Map(materials.map((m) => [m.material_code, m.description])),
    [materials]
  );

  const hits = useMemo(() => {
    const t = term.trim().toUpperCase();
    if (!t) return [];
    return materials
      .filter((m) => !picked.includes(m.material_code))
      .filter(
        (m) =>
          m.material_code.toUpperCase().includes(t) || m.description.toUpperCase().includes(t)
      )
      .slice(0, 8);
  }, [materials, term, picked]);

  const place = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 280) });
  }, []);

  useEffect(() => {
    if (!open || hits.length === 0) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, hits.length, place]);

  function add(code: string) {
    onAdd(code);
    setTerm('');
    setOpen(false);
  }

  return (
    <div className="space-y-2">
      <div ref={boxRef} className="relative">
        <Input
          className="uppercase"
          placeholder="ketik kode / nama barang, lalu pilih"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            // Enter mengambil saran teratas — supaya bisa mengetik beberapa SKU
            // berturut-turut tanpa memindahkan tangan ke tetikus.
            if (e.key === 'Enter' && hits.length > 0) {
              e.preventDefault();
              add(hits[0].material_code);
            }
          }}
        />
        {open &&
          hits.length > 0 &&
          rect &&
          createPortal(
            <div
              style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width }}
              className="z-[95] max-h-[240px] overflow-auto sap-panel shadow-sap"
            >
              {hits.map((m) => (
                <button
                  key={m.material_code}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(m.material_code)}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-sap-hover border-b border-sap-border/50 last:border-0"
                >
                  <p className="font-mono text-2xs text-sap-blue">{m.material_code}</p>
                  <p className="text-xxs text-sap-muted truncate">
                    {m.description} · {m.uom}
                  </p>
                </button>
              ))}
            </div>,
            document.body
          )}
      </div>

      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((code) => (
            <span
              key={code}
              className="sap-badge border-sap-blue/50 bg-sap-blue/10 text-sap-text flex items-center gap-1.5"
              title={descOf.get(code) ?? ''}
            >
              <span className="font-mono">{code}</span>
              <button
                type="button"
                onClick={() => onRemove(code)}
                aria-label={`Hapus ${code}`}
                className="text-sap-muted hover:text-sap-errtext"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface Quant {
  id: string;
  material_code: string;
  description: string;
  bin_code: string;
  zone_id: string;
  batch_number: string;
  qty: number;
  uom: string;
}

interface BinRow {
  id: string;
  bin_code: string;
  zone_id: string;
  status: string;
}

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  is_active: boolean;
  so_enabled: boolean;
  role: string;
}

/** Satu rak calon opname, beserta ringkasan isinya. */
interface Candidate {
  bin_code: string;
  zone_id: string;
  materials: number;
  qty: number;
  sample: string;
}

export default function Zso01Page() {
  const { setStatus } = useStatus();
  const { zones } = useZones();

  const [mode, setMode] = useState<'MATERIAL' | 'ZONE'>('MATERIAL');
  /** daftar SKU yang menjadi cakupan opname — bisa lebih dari satu */
  const [skus, setSkus] = useState<string[]>([]);
  /** material -> petugas. Satu material tepat satu orang. */
  const [matAssign, setMatAssign] = useState<Record<string, string>>({});
  const [zone, setZone] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<UserRow[]>([]);
  const [showBookQty, setShowBookQty] = useState(false);
  const [showPrevRound, setShowPrevRound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadUsers = useCallback(async () => {
    const r = await api<UserRow[]>('/api/users');
    // Hanya user yang aktif DAN diizinkan opname yang boleh muncul sebagai
    // calon petugas. Menugaskan orang yang tidak boleh mengerjakan membuat rak
    // menggantung, dan itu baru ketahuan saat opname sudah berjalan.
    if (r.ok) setUsers((r.data ?? []).filter((u) => u.is_active && u.so_enabled));
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  /** Cari rak calon. Material -> lewat stok; Zona -> seluruh rak zona itu. */
  async function search() {
    setLoading(true);
    setCandidates([]);
    setPicked(new Set());
    setAssign({});

    if (mode === 'MATERIAL') {
      if (skus.length === 0) {
        setLoading(false);
        return setStatus('Pilih minimal satu material terlebih dahulu', 'E');
      }
      // Satu permintaan per SKU: parameter `material` mencocokkan PERSIS,
      // sedangkan pencarian bebas bisa ikut menyeret SKU lain yang kodenya
      // mengandung potongan yang sama — dan itu justru merusak fokus opname.
      const all: Quant[] = [];
      for (const code of skus) {
        const r = await api<Quant[]>('/api/stock/quants' + qs({ material: code, exclInterim: 1 }));
        if (!r.ok) {
          setLoading(false);
          return setStatus(r.message, 'E');
        }
        all.push(...(r.data ?? []));
      }
      setLoading(false);
      const r = { ok: true, data: all } as { ok: boolean; data: Quant[] };

      // Stok dikelompokkan per rak: satu rak dihitung sekali walaupun memuat
      // beberapa batch atau beberapa material sekaligus.
      const byBin = new Map<string, Candidate>();
      for (const q of r.data ?? []) {
        const cur = byBin.get(q.bin_code);
        if (cur) {
          cur.qty += q.qty;
          cur.materials += 1;
        } else {
          byBin.set(q.bin_code, {
            bin_code: q.bin_code,
            zone_id: q.zone_id,
            materials: 1,
            qty: q.qty,
            sample: `${q.material_code} · ${q.description}`,
          });
        }
      }
      const rows = [...byBin.values()].sort((a, b) =>
        a.bin_code.localeCompare(b.bin_code, 'id', { numeric: true })
      );
      setCandidates(rows);
      setStatus(
        rows.length > 0
          ? `${rows.length} rak memuat ${skus.length} material terpilih`
          : 'Tidak ada rak yang memuat material terpilih',
        rows.length > 0 ? 'S' : 'W'
      );
      return;
    }

    if (!zone) {
      setLoading(false);
      return setStatus('Pilih zona terlebih dahulu', 'E');
    }
    const r = await api<BinRow[]>('/api/bins' + qs({ zone }));
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    const rows = (r.data ?? []).map((b) => ({
      bin_code: b.bin_code,
      zone_id: b.zone_id,
      materials: 0,
      qty: 0,
      sample: b.status,
    }));
    setCandidates(rows);
    setStatus(rows.length > 0 ? `${rows.length} rak pada zona ${zone}` : 'Zona ini belum punya rak', rows.length > 0 ? 'S' : 'W');
  }

  function toggle(bin: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(bin)) {
        n.delete(bin);
        setAssign((a) => {
          const c = { ...a };
          delete c[bin];
          return c;
        });
      } else {
        n.add(bin);
      }
      return n;
    });
  }

  function pickAll() {
    setPicked(new Set(candidates.map((c) => c.bin_code)));
  }

  function clearAll() {
    setPicked(new Set());
    setAssign({});
  }

  /** Bagi rak terpilih rata ke beberapa petugas sekaligus. */
  function distribute(names: string[]) {
    if (names.length === 0) return;
    const list = [...picked].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
    const next: Record<string, string> = {};
    list.forEach((bin, i) => {
      next[bin] = names[i % names.length];
    });
    setAssign(next);
    setStatus(`${list.length} rak dibagi ke ${names.length} petugas`, 'S');
  }

  const pickedList = useMemo(
    () => [...picked].sort((a, b) => a.localeCompare(b, 'id', { numeric: true })),
    [picked]
  );

  const perUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const bin of pickedList) {
      const u = assign[bin];
      if (!u) continue;
      m.set(u, (m.get(u) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [pickedList, assign]);

  const unassigned = pickedList.filter((b) => !assign[b]).length;

  async function submit() {
    setConfirmOpen(false);
    setBusy(true);
    const r = await post('/api/physinv', {
      scope_type: 'BIN_LIST',
      bins: pickedList,
      // Cakupan material hanya dikirim pada mode MATERIAL. Pada mode ZONA
      // seluruh isi rak memang dihitung, jadi tidak ada daftar yang membatasi.
      ...(mode === 'MATERIAL'
        ? {
            materials: skus,
            material_assignments: skus
              .filter((c) => matAssign[c])
              .map((c) => ({ material_code: c, assigned_to: matAssign[c] })),
          }
        : {
            assignments: pickedList
              .filter((b) => assign[b])
              .map((b) => ({ bin_code: b, assigned_to: assign[b] })),
          }),
      round_options: { show_book_qty: showBookQty, show_prev_round: showPrevRound },
    });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setCandidates([]);
      setPicked(new Set());
      setAssign({});
      setMatAssign({});
      setSkus([]);
    }
  }

  return (
    <div className="space-y-3">
      <Panel
        title="ZSO01 — Opname Terkelola (pilih rak & tugaskan petugas)"
        icon={<ClipboardList size={13} className="text-sap-blue" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Cari berdasarkan">
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'MATERIAL' | 'ZONE')}>
              <option value="MATERIAL">Material — rak mana saja yang memuatnya</option>
              <option value="ZONE">Zona — seluruh rak pada satu zona</option>
            </Select>
          </Field>

          {mode === 'MATERIAL' ? (
            <Field
              label="Material"
              hint="ketik lalu pilih; ulangi untuk menambah SKU berikutnya"
              className="md:col-span-2"
            >
              <MultiMaterialPicker
                picked={skus}
                onAdd={(c) => setSkus((s) => (s.includes(c) ? s : [...s, c]))}
                onRemove={(c) => {
                  setSkus((s) => s.filter((x) => x !== c));
                  setMatAssign((a) => {
                    const n = { ...a };
                    delete n[c];
                    return n;
                  });
                }}
              />
            </Field>
          ) : (
            <Field label="Zona">
              <Select value={zone} onChange={(e) => setZone(e.target.value)}>
                <option value="">(pilih zona)</option>
                {zones.map((z) => (
                  <option key={z.zone_code} value={z.zone_code}>
                    {z.zone_code} — {z.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <ActionField>
            <Button variant="primary" onClick={search} loading={loading}>
              <Search size={13} /> Cari rak
            </Button>
          </ActionField>
        </div>
      </Panel>

      {candidates.length > 0 && (
        <Panel
          title={`Rak calon — ${picked.size} dari ${candidates.length} dipilih`}
          bodyClassName="p-0"
          actions={
            <>
              <Button onClick={pickAll}>Pilih semua</Button>
              <Button onClick={clearAll}>
                <RotateCcw size={13} /> Kosongkan
              </Button>
            </>
          }
        >
          <div className="max-h-[46dvh] overflow-auto">
            <table className="sap-grid">
              <thead>
                <tr>
                  <th className="w-[44px] text-center">Pilih</th>
                  <th className="w-[160px]">Rak</th>
                  <th className="w-[130px]">Zona</th>
                  <th className="w-[90px] text-right">Qty</th>
                  <th>Isi</th>
                  <th className="w-[190px]">Ditugaskan ke</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const on = picked.has(c.bin_code);
                  return (
                    <tr key={c.bin_code} className={on ? 'bg-sap-blue/10' : ''}>
                      <td className="text-center">
                        <input
                          type="checkbox"
                          className="accent-sap-blue w-4 h-4"
                          checked={on}
                          onChange={() => toggle(c.bin_code)}
                        />
                      </td>
                      <td className="font-mono text-sap-blue">{c.bin_code}</td>
                      <td className="font-mono text-sap-muted">{c.zone_id}</td>
                      <td className="text-right font-mono tabular-nums">
                        {c.qty > 0 ? c.qty.toLocaleString('de-DE') : '—'}
                      </td>
                      <td className="text-sap-muted truncate max-w-[260px]">{c.sample}</td>
                      <td>
                        <Select
                          className="!py-[3px]"
                          disabled={!on}
                          value={assign[c.bin_code] ?? ''}
                          onChange={(e) =>
                            setAssign((a) => ({ ...a, [c.bin_code]: e.target.value }))
                          }
                        >
                          <option value="">(belum ditugaskan)</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.username}>
                              {u.username} — {u.full_name}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {picked.size > 0 && mode === 'MATERIAL' && (
        <Panel
          title="Pembagian tugas per material"
          icon={<Boxes size={13} className="text-sap-blue" />}
        >
          <div className="space-y-3">
            {users.length === 0 && (
              <div className="rounded-sappanel border border-sap-warnborder bg-sap-warnbg text-sap-warntext px-3 py-2 text-2xs">
                Belum ada user yang diizinkan menerima tugas opname. Aktifkan{' '}
                <b>Boleh ditugaskan stock opname</b> pada user yang bersangkutan di <b>SU01</b>.
              </div>
            )}

            <p className="text-xxs text-sap-muted leading-relaxed">
              Satu material dikerjakan <b>satu orang</b>, tetapi satu orang boleh memegang beberapa
              material. Aturan ini ditegakkan sampai ke database — bukan hanya di layar ini.
              Alasannya: bila material yang sama dihitung dua orang di rak berbeda, tidak ada satu
              pun angka yang utuh untuk dibandingkan, dan selisih yang muncul berasal dari
              pembagian kerja, bukan dari kenyataan di gudang.
            </p>

            <table className="sap-grid">
              <thead>
                <tr>
                  <th className="w-[180px]">Material</th>
                  <th>Rak yang memuatnya</th>
                  <th className="w-[220px]">Ditugaskan ke</th>
                </tr>
              </thead>
              <tbody>
                {skus.map((code) => {
                  const bins = candidates.filter(
                    (c) => picked.has(c.bin_code) && c.sample.startsWith(code)
                  ).length;
                  return (
                    <tr key={code}>
                      <td className="font-mono text-sap-blue">{code}</td>
                      <td className="text-sap-muted font-mono text-xxs">
                        {bins > 0 ? `${bins} rak terpilih` : '—'}
                      </td>
                      <td>
                        <Select
                          className="!py-[3px]"
                          value={matAssign[code] ?? ''}
                          onChange={(e) =>
                            setMatAssign((a) => ({ ...a, [code]: e.target.value }))
                          }
                        >
                          <option value="">(belum ditugaskan)</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.username}>
                              {u.username} — {u.full_name}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {(() => {
              const per = new Map<string, number>();
              for (const c of skus) {
                const u = matAssign[c];
                if (!u) continue;
                per.set(u, (per.get(u) ?? 0) + 1);
              }
              const belum = skus.filter((c) => !matAssign[c]).length;
              return (
                <>
                  {per.size > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {[...per.entries()].map(([u, n]) => (
                        <span
                          key={u}
                          className="sap-badge border-sap-infoborder bg-sap-infobg text-sap-infotext"
                        >
                          {u} · {n} material
                        </span>
                      ))}
                    </div>
                  )}
                  {belum > 0 && (
                    <p className="text-2xs text-sap-warntext">
                      {belum} material belum ditugaskan — material tanpa petugas boleh dihitung
                      siapa saja.
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </Panel>
      )}

      {picked.size > 0 && mode === 'ZONE' && (
        <Panel title="Pembagian tugas" icon={<Users size={13} className="text-sap-blue" />}>
          <div className="space-y-3">
            <ActionField
              label="Bagi rata otomatis"
              hint="Rak terpilih dibagi bergiliran ke petugas yang dicentang. Pembagian tetap bisa disesuaikan satu per satu sesudahnya."
            >
              <div className="flex flex-wrap gap-1.5">
                {users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => distribute([u.username])}
                    className="sap-btn !py-[3px] !px-2 text-2xs"
                  >
                    Semua ke {u.username}
                  </button>
                ))}
                {users.length > 1 && (
                  <button
                    type="button"
                    onClick={() => distribute(users.map((u) => u.username))}
                    className="sap-btn sap-btn-primary !py-[3px] !px-2 text-2xs"
                  >
                    Bagi rata ke {users.length} petugas
                  </button>
                )}
              </div>
            </ActionField>

            {perUser.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {perUser.map(([u, n]) => (
                  <span
                    key={u}
                    className="sap-badge border-sap-infoborder bg-sap-infobg text-sap-infotext"
                  >
                    {u} · {n} rak
                  </span>
                ))}
              </div>
            )}

            {unassigned > 0 && (
              <p className="text-2xs text-sap-warntext">
                {unassigned} rak belum ditugaskan — rak tanpa petugas boleh dihitung siapa saja.
              </p>
            )}
          </div>
        </Panel>
      )}

      {picked.size > 0 && (
        <Panel
          title="Pengaturan ronde 1"
          icon={showBookQty || showPrevRound ? <Eye size={13} className="text-sap-warntext" /> : <EyeOff size={13} className="text-sap-oktext" />}
        >
          <div className="space-y-2">
            <label className="sap-control-row text-2xs cursor-pointer">
              <input
                type="checkbox"
                className="accent-sap-blue w-4 h-4"
                checked={showBookQty}
                onChange={(e) => setShowBookQty(e.target.checked)}
              />
              <span>Tampilkan jumlah menurut sistem kepada petugas</span>
            </label>
            <label className="sap-control-row text-2xs cursor-pointer">
              <input
                type="checkbox"
                className="accent-sap-blue w-4 h-4"
                checked={showPrevRound}
                onChange={(e) => setShowPrevRound(e.target.checked)}
              />
              <span>Tampilkan hasil ronde sebelumnya (tidak berlaku di ronde 1)</span>
            </label>
            <p className="text-xxs text-sap-muted leading-relaxed">
              Keduanya mati secara bawaan. Bila jumlah sistem terlihat, ada dorongan kuat bagi
              petugas untuk sekadar membenarkannya, dan selisih nyata tidak pernah ketahuan.
              Pilihan ini direkam pada rondenya, sehingga layar perbandingan nanti bisa menandai
              ronde mana yang tidak buta.
            </p>
          </div>
        </Panel>
      )}

      <Toolbar>
        <Button
          variant="primary"
          disabled={picked.size === 0}
          onClick={() => setConfirmOpen(true)}
        >
          <Snowflake size={13} /> Freeze &amp; buka ronde 1 ({picked.size} rak)
        </Button>
        <Button onClick={clearAll} disabled={picked.size === 0}>
          <Trash2 size={13} /> Batal pilih
        </Button>
      </Toolbar>

      <ConfirmDialog
        open={confirmOpen}
        title="Freeze rak & buka ronde 1"
        question={`${picked.size} rak akan di-freeze dan tidak bisa dipakai transaksi sampai opname diposting.`}
        details={[
          { label: 'Jumlah rak', value: picked.size },
          { label: 'Sudah ditugaskan', value: `${picked.size - unassigned} rak` },
          { label: 'Belum ditugaskan', value: `${unassigned} rak` },
          { label: 'Jumlah sistem', value: showBookQty ? 'Terlihat petugas' : 'Disembunyikan' },
        ]}
        confirmLabel="Freeze"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
