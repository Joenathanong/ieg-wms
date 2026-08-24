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

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Search,
  Users,
  Snowflake,
  EyeOff,
  Eye,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, ActionField } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useZones } from '@/components/sap/hooks';
import { ConfirmDialog } from '@/components/sap/Confirm';
import { api, post, qs } from '@/lib/client';

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
  const [material, setMaterial] = useState('');
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
    if (r.ok) setUsers((r.data ?? []).filter((u) => u.is_active));
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
      const term = material.trim();
      if (!term) {
        setLoading(false);
        return setStatus('Isi kode atau nama material terlebih dahulu', 'E');
      }
      const r = await api<Quant[]>('/api/stock/quants' + qs({ q: term, exclInterim: 1 }));
      setLoading(false);
      if (!r.ok) return setStatus(r.message, 'E');

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
        rows.length > 0 ? `${rows.length} rak memuat material ini` : 'Tidak ada rak yang memuatnya',
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
      assignments: pickedList
        .filter((b) => assign[b])
        .map((b) => ({ bin_code: b, assigned_to: assign[b] })),
      round_options: { show_book_qty: showBookQty, show_prev_round: showPrevRound },
    });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setCandidates([]);
      setPicked(new Set());
      setAssign({});
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
            <Field label="Material" hint="kode atau nama barang, mendukung * ">
              <Input
                className="uppercase"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
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

      {picked.size > 0 && (
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
