'use client';

/**
 * ZSO02 — Monitor & Kelola Opname.
 *
 * Layar tempat supervisor melihat hasil tiap ronde berdampingan, membuka ronde
 * berikutnya, dan menugaskan ulang raknya.
 *
 * Angka diterima ketika dua ronde oleh ORANG BERBEDA sepakat. Karena itu tiap
 * kolom ronde menampilkan nama penghitungnya, bukan hanya jumlahnya — tanpa
 * nama, kesepakatan tidak bisa dinilai.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GitCompare,
  RefreshCw,
  PlayCircle,
  CheckCircle2,
  Gavel,
  Save,
  BarChart3,
  Maximize2,
  X,
  Download,
  AlertTriangle,
  EyeOff,
  Eye,
} from 'lucide-react';
import { Panel, Input, Button, Toolbar, ActionField, Select, exportCsv } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { ConfirmDialog } from '@/components/sap/Confirm';
import { api, post, patch, qs, fmtDateTime } from '@/lib/client';
import { Bar, Composition, DailyChart, Histogram } from '@/components/sap/OpnameCharts';
import { AGREEMENT_REQUIRED, tally, type LineStatus } from '@/lib/consensus';

interface DocRow {
  id: string;
  doc_number: string;
  scope_value: string;
  status: string;
  round: number;
  managed: boolean;
  bin_count: number;
  bins_counted: number;
}

interface RoundInfo {
  round: number;
  show_book_qty: boolean;
  show_prev_round: boolean;
  opened_at: string;
  opened_by: string;
  not_blind: boolean;
  bins: number;
  counted: number;
}

interface Line {
  bin_code: string;
  material_code: string;
  description: string;
  batch_number: string;
  uom: string;
  book_qty: number;
  rounds: { round: number; counted_qty: number | null; counted_by: string | null }[];
  status: LineStatus;
  final_round: number | null;
  final_qty: number | null;
  diff_qty: number | null;
  needs_recount: boolean;
}

interface Compare {
  doc_number: string;
  status: string;
  current_round: number;
  rounds: RoundInfo[];
  lines: Line[];
  scope_materials: string[];
  by_material: boolean;
  assigns: { material_code: string; assigned_to: string }[];
  materials_need_recount: { material_code: string; open_lines: number }[];
  bins_need_recount: { bin_code: string; open_lines: number }[];
  summary: {
    total: number;
    consensus: number;
    settled: number;
    manual: number;
    unresolved: number;
    not_counted: number;
  };
}

interface Dash {
  doc_count: number;
  open_docs: number;
  bins_assigned: number;
  bins_counted: number;
  counters: { username: string; assigned: number; counted: number; docs: number; pct: number }[];
  rounds_open: { doc_number: string; round: number; bins: number; counted: number }[];
  findings: {
    diff_plus: number;
    diff_minus: number;
    swap_qty: number;
    new_found: number;
    lines_total: number;
    lines_unresolved: number;
    lines_done: number;
    lines_not_counted: number;
    buckets: { label: string; n: number }[];
  };
}

interface Monitor {
  docs: { doc_number: string; round: number; status: string; assigned: number; counted: number }[];
  counters: { username: string; assigned: number; counted: number; pct: number }[];
  zones: { zone: string; assigned: number; counted: number; pct: number }[];
  daily: { day: string; counted: number }[];
  totals: { assigned: number; counted: number };
}

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  is_active: boolean;
  so_enabled: boolean;
}

const STATUS_LABEL: Record<LineStatus, { text: string; cls: string }> = {
  CONSENSUS: { text: 'SEPAKAT', cls: 'border-sap-okborder bg-sap-okbg text-sap-oktext' },
  SETTLED_NO_DIFF: { text: 'COCOK', cls: 'border-sap-okborder bg-sap-okbg text-sap-oktext' },
  MANUAL: { text: 'DITETAPKAN', cls: 'border-sap-infoborder bg-sap-infobg text-sap-infotext' },
  UNRESOLVED: { text: 'BELUM SEPAKAT', cls: 'border-sap-warnborder bg-sap-warnbg text-sap-warntext' },
  NOT_COUNTED: { text: 'BELUM DIHITUNG', cls: 'border-sap-neutralborder bg-sap-neutralbg text-sap-muted' },
};

export default function Zso02Page() {
  const { setStatus } = useStatus();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [sel, setSel] = useState<string>('');
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState<Record<string, string>>({});
  /** untuk dokumen bercakupan material: material terpilih & petugasnya */
  const [pickMat, setPickMat] = useState<Set<string>>(new Set());
  const [matAssign, setMatAssign] = useState<Record<string, string>>({});
  const [showBookQty, setShowBookQty] = useState(false);
  const [showPrevRound, setShowPrevRound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** angka final yang diketik supervisor, per kunci baris */
  const [decide, setDecide] = useState<Record<string, string>>({});
  const [postOpen, setPostOpen] = useState(false);
  const [dash, setDash] = useState<Dash | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [who, setWho] = useState('');
  const [mon, setMon] = useState<Monitor | null>(null);
  const [wall, setWall] = useState(false);
  const [monAt, setMonAt] = useState('');

  const loadDocs = useCallback(async () => {
    const r = await api<DocRow[]>('/api/physinv');
    if (r.ok) setDocs((r.data ?? []).filter((d) => d.status !== 'POSTED'));
  }, []);

  const loadUsers = useCallback(async () => {
    const r = await api<UserRow[]>('/api/users');
    // Hanya user yang aktif DAN diizinkan opname yang boleh muncul sebagai
    // calon petugas. Menugaskan orang yang tidak boleh mengerjakan membuat rak
    // menggantung, dan itu baru ketahuan saat opname sudah berjalan.
    if (r.ok) setUsers((r.data ?? []).filter((u) => u.is_active && u.so_enabled));
  }, []);

  const loadDash = useCallback(async () => {
    const r = await api<Dash>(
      '/api/physinv/dashboard' +
        qs({ from: from || '', to: to || '', user: who || '' })
    );
    if (r.ok) setDash(r.data ?? null);
  }, [from, to, who]);

  useEffect(() => {
    loadDocs();
    loadUsers();
  }, [loadDocs, loadUsers]);

  useEffect(() => {
    loadDash();
  }, [loadDash]);

  const loadMon = useCallback(async () => {
    const r = await api<Monitor>('/api/physinv/monitor' + qs({ user: who || '' }));
    if (r.ok) {
      setMon(r.data ?? null);
      setMonAt(new Date().toLocaleTimeString('id-ID', { hour12: false }));
    }
  }, [who]);

  useEffect(() => {
    loadMon();
  }, [loadMon]);

  /**
   * Penyegaran otomatis layar pantau.
   *
   * Hanya berjalan saat layar penuh dibuka DAN tabnya sedang terlihat. Memantau
   * layar yang tidak dilihat siapa pun hanya membakar kuota database tanpa ada
   * yang membacanya — dan layar pantau biasanya ditinggal menyala berjam-jam.
   *
   * Yang disegarkan cuma endpoint ringan (tabel rak, ratusan baris). Angka
   * temuan tetap dari endpoint berat dan tidak ikut irama satu menit ini.
   */
  useEffect(() => {
    if (!wall) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      void loadMon();
    }, 60_000);
    return () => clearInterval(id);
  }, [wall, loadMon]);

  const openDoc = useCallback(
    async (id: string) => {
      if (!id) return;
      setLoading(true);
      const r = await api<Compare>(`/api/physinv/${id}/compare`);
      setLoading(false);
      if (!r.ok) return setStatus(r.message, 'E');
      setCmp(r.data ?? null);
      // Rak yang selisih dicentang otomatis; supervisor masih bisa menambah.
      setPick(new Set((r.data?.bins_need_recount ?? []).map((b) => b.bin_code)));
      // Material yang masih berselisih dicentang otomatis, sama seperti rak.
      setPickMat(new Set((r.data?.materials_need_recount ?? []).map((m) => m.material_code)));
      setAssign({});
      // Penugasan ronde berjalan dipakai sebagai isian awal — supervisor tinggal
      // memindahkan yang perlu diganti, bukan mengisi ulang semuanya.
      setMatAssign(
        Object.fromEntries((r.data?.assigns ?? []).map((a) => [a.material_code, a.assigned_to]))
      );
      setDecide({});
      setStatus(r.message, 'S');
    },
    [setStatus]
  );

  const allBins = useMemo(() => {
    if (!cmp) return [];
    const set = new Set(cmp.lines.map((l) => l.bin_code));
    return [...set].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
  }, [cmp]);

  const allMaterials = useMemo(() => {
    if (!cmp) return [];
    const set = new Set(cmp.lines.map((l) => l.material_code));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [cmp]);

  const descOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of cmp?.lines ?? []) if (!m.has(l.material_code)) m.set(l.material_code, l.description);
    return m;
  }, [cmp]);

  /** Petugas yang pernah menghitung material ini di ronde mana pun. */
  function pastCountersOfMaterial(code: string): string[] {
    const names = new Set<string>();
    for (const l of cmp?.lines ?? []) {
      if (l.material_code !== code) continue;
      for (const r of l.rounds) if (r.counted_by) names.add(r.counted_by);
    }
    return [...names];
  }

  const matNeedSet = useMemo(
    () => new Set((cmp?.materials_need_recount ?? []).map((m) => m.material_code)),
    [cmp]
  );

  const needSet = useMemo(
    () => new Set((cmp?.bins_need_recount ?? []).map((b) => b.bin_code)),
    [cmp]
  );

  function toggle(bin: string) {
    setPick((s) => {
      const n = new Set(s);
      if (n.has(bin)) n.delete(bin);
      else n.add(bin);
      return n;
    });
  }

  function distribute(names: string[]) {
    if (names.length === 0) return;
    if (cmp?.by_material) {
      // Satuan pembagiannya material, bukan rak — satu material utuh ke satu
      // orang, di seluruh rak tempat ia berada.
      const list = [...pickMat].sort((a, b) => a.localeCompare(b));
      const next: Record<string, string> = {};
      list.forEach((code, i) => {
        next[code] = names[i % names.length];
      });
      setMatAssign(next);
      setStatus(`${list.length} material dibagi ke ${names.length} petugas`, 'S');
      return;
    }
    const list = [...pick].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
    const next: Record<string, string> = {};
    list.forEach((bin, i) => {
      next[bin] = names[i % names.length];
    });
    setAssign(next);
    setStatus(`${list.length} rak dibagi ke ${names.length} petugas`, 'S');
  }

  /** Petugas yang pernah menghitung rak ini — dipakai memberi peringatan. */
  function pastCounters(bin: string): string[] {
    if (!cmp) return [];
    const names = new Set<string>();
    for (const l of cmp.lines) {
      if (l.bin_code !== bin) continue;
      for (const r of l.rounds) if (r.counted_by) names.add(r.counted_by);
    }
    return [...names];
  }

  async function openRound() {
    setConfirmOpen(false);
    if (!cmp || !sel) return;
    setBusy(true);
    // Untuk dokumen bercakupan material, rak yang ikut ronde berikutnya
    // diturunkan dari material terpilih — bukan dipilih terpisah, supaya tidak
    // mungkin ada material terpilih yang raknya tertinggal.
    const binsForRound = cmp.by_material
      ? [...new Set(cmp.lines.filter((l) => pickMat.has(l.material_code)).map((l) => l.bin_code))]
      : [...pick];

    const r = await post(`/api/physinv/${sel}/round`, {
      bins: binsForRound.map((b) => ({
        bin_code: b,
        assigned_to: cmp.by_material ? '' : assign[b] ?? '',
      })),
      ...(cmp.by_material
        ? {
            material_assignments: [...pickMat]
              .filter((c) => matAssign[c])
              .map((c) => ({ material_code: c, assigned_to: matAssign[c] })),
          }
        : {}),
      show_book_qty: showBookQty,
      show_prev_round: showPrevRound,
    });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      await openDoc(sel);
      await loadDocs();
    }
  }

  const unresolvedLines = useMemo(
    () => (cmp?.lines ?? []).filter((l) => l.status === 'UNRESOLVED'),
    [cmp]
  );

  const decidedCount = Object.values(decide).filter((v) => v.trim() !== '').length;

  /** Posting hanya boleh saat tidak ada lagi baris yang diperselisihkan. */
  const readyToPost = !!cmp && cmp.summary.unresolved === 0 && cmp.status === 'COUNTED';

  async function saveDecisions() {
    if (!cmp || !sel) return;
    const decisions = (cmp.lines ?? [])
      .map((l) => {
        const k = `${l.bin_code}|${l.material_code}|${l.batch_number}`;
        const v = decide[k];
        if (!v || v.trim() === '') return null;
        return {
          bin_code: l.bin_code,
          material_code: l.material_code,
          batch_number: l.batch_number || null,
          qty: Number(v),
        };
      })
      .filter(Boolean);
    if (decisions.length === 0) return;

    setBusy(true);
    const r = await patch(`/api/physinv/${sel}/resolve`, { decisions });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) await openDoc(sel);
  }

  /**
   * Export hasil perbandingan ke CSV.
   *
   * Kolom rondenya dibangun dinamis mengikuti jumlah ronde yang benar-benar ada
   * pada dokumen ini — dokumen dua ronde tidak menghasilkan kolom ronde tiga
   * yang kosong. Nama penghitung ikut dibawa: tanpa itu, angka-angka di
   * spreadsheet kehilangan konteks siapa yang melaporkannya.
   */
  function exportCompare() {
    if (!cmp) return;
    const cols = [
      { key: 'bin_code', header: 'Rak', exportValue: (l: Line) => l.bin_code },
      { key: 'material_code', header: 'Material', exportValue: (l: Line) => l.material_code },
      { key: 'description', header: 'Deskripsi', exportValue: (l: Line) => l.description },
      { key: 'batch_number', header: 'Batch', exportValue: (l: Line) => l.batch_number },
      { key: 'uom', header: 'UoM', exportValue: (l: Line) => l.uom },
      { key: 'book_qty', header: 'Jumlah Sistem', exportValue: (l: Line) => l.book_qty },
      ...cmp.rounds.flatMap((r) => [
        {
          key: `r${r.round}`,
          header: `Ronde ${r.round}`,
          exportValue: (l: Line) => l.rounds.find((x) => x.round === r.round)?.counted_qty ?? '',
        },
        {
          key: `r${r.round}by`,
          header: `Ronde ${r.round} — Petugas`,
          exportValue: (l: Line) => l.rounds.find((x) => x.round === r.round)?.counted_by ?? '',
        },
      ]),
      { key: 'status', header: 'Status', exportValue: (l: Line) => STATUS_LABEL[l.status].text },
      { key: 'final_round', header: 'Ronde Final', exportValue: (l: Line) => l.final_round ?? '' },
      { key: 'final_qty', header: 'Jumlah Final', exportValue: (l: Line) => l.final_qty ?? '' },
      { key: 'diff_qty', header: 'Selisih', exportValue: (l: Line) => l.diff_qty ?? '' },
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    exportCsv(`opname_${cmp.doc_number}_${stamp}.csv`, cols, cmp.lines);
    setStatus(`${cmp.lines.length} baris diexport.`, 'S');
  }

  async function postDoc() {
    setPostOpen(false);
    if (!sel) return;
    setBusy(true);
    const r = await post(`/api/physinv/${sel}/post`, {});
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setCmp(null);
      setSel('');
      await loadDocs();
    }
  }

  const repeatWarnings = cmp?.by_material
    ? [...pickMat].filter((c) => matAssign[c] && pastCountersOfMaterial(c).includes(matAssign[c]))
    : [...pick].filter((b) => assign[b] && pastCounters(b).includes(assign[b]));

  const roundPickCount = cmp?.by_material ? pickMat.size : pick.size;

  return (
    <div className="space-y-3">
      <Panel
        title="Dashboard Opname"
        icon={<BarChart3 size={13} className="text-sap-blue" />}
        actions={
          <>
            <Button onClick={() => setWall(true)}>
              <Maximize2 size={13} /> Layar pantau
            </Button>
            <Button
              onClick={() => {
                loadDash();
                loadMon();
              }}
            >
              <RefreshCw size={13} /> Segarkan
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <ActionField label="Dari tanggal">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </ActionField>
          <ActionField label="Sampai tanggal">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </ActionField>
          <ActionField label="Petugas">
            <Select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">(semua petugas)</option>
              {users.map((u) => (
                <option key={u.id} value={u.username}>
                  {u.username} — {u.full_name}
                </option>
              ))}
            </Select>
          </ActionField>
        </div>

        {!dash ? (
          <p className="text-2xs text-sap-muted">Memuat ringkasan …</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <p className="text-2xs font-semibold">Progres per petugas</p>
              {dash.counters.length === 0 ? (
                <p className="text-xxs text-sap-muted">
                  Belum ada rak yang ditugaskan pada rentang ini.
                </p>
              ) : (
                dash.counters.map((c) => (
                  <Bar
                    key={c.username}
                    label={`${c.username} · ${c.docs} dokumen`}
                    value={c.counted}
                    max={c.assigned}
                    right={`${c.counted}/${c.assigned} rak · ${c.pct}%`}
                    tone={c.pct >= 100 ? 'ok' : 'blue'}
                  />
                ))
              )}

              {dash.rounds_open.length > 0 && (
                <>
                  <p className="text-2xs font-semibold pt-2">Ronde berjalan</p>
                  {dash.rounds_open.map((r) => (
                    <Bar
                      key={r.doc_number}
                      label={`${r.doc_number} · ronde ${r.round}`}
                      value={r.counted}
                      max={r.bins}
                      right={`${r.counted}/${r.bins} rak`}
                    />
                  ))}
                </>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-2xs font-semibold">Temuan</p>
              {(() => {
                const f = dash.findings;
                const max = Math.max(f.diff_plus, f.diff_minus, f.swap_qty, f.new_found, 1);
                return (
                  <>
                    <Bar label="Selisih lebih" value={f.diff_plus} max={max} right={`+${f.diff_plus}`} tone="ok" />
                    <Bar label="Selisih kurang" value={f.diff_minus} max={max} right={`-${f.diff_minus}`} tone="err" />
                    <Bar label="Tertukar batch" value={f.swap_qty} max={max} right={`${f.swap_qty}`} tone="warn" />
                    <Bar label="Temuan tidak tercatat" value={f.new_found} max={max} right={`${f.new_found}`} tone="warn" />
                    <p className="text-xxs text-sap-muted leading-relaxed pt-1">
                      <b>Tertukar batch</b> dipisahkan dari selisih stok dengan sengaja: barangnya
                      utuh, hanya catatan batch-nya keliru. Digabungkan, satu kekeliruan batch
                      terhitung dua kali — sekali kurang dan sekali lebih — dan akurasi opname
                      terlihat dua kali lebih buruk daripada kenyataannya. Angka ini tetap perlu
                      dipantau karena batch yang salah membuat pengambilan FEFO meleset tanpa
                      memicu selisih stok apa pun.
                    </p>
                    {f.lines_unresolved > 0 && (
                      <p className="text-xxs text-sap-warntext">
                        {f.lines_unresolved} dari {f.lines_total} baris belum sepakat dan belum
                        terhitung dalam angka di atas.
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}

        {dash && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4 pt-4 border-t border-sap-border">
            <div className="space-y-2">
              <p className="text-2xs font-semibold">Komposisi status baris</p>
              <Composition
                done={dash.findings.lines_done}
                unresolved={dash.findings.lines_unresolved}
                notCounted={dash.findings.lines_not_counted}
              />
            </div>
            <div className="space-y-2">
              <p className="text-2xs font-semibold">Rak selesai per hari</p>
              <DailyChart data={mon?.daily ?? []} />
            </div>
            <div className="space-y-2">
              <p className="text-2xs font-semibold">Sebaran besaran selisih (unit)</p>
              <Histogram data={dash.findings.buckets} />
              <p className="text-xxs text-sap-muted leading-relaxed">
                Banyak selisih kecil menunjuk ke ketelitian menghitung; sedikit selisih besar lebih
                sering berarti barang benar-benar berpindah atau hilang. Dua penyebab berbeda,
                penanganannya juga berbeda.
              </p>
            </div>
          </div>
        )}

        {mon && mon.zones.length > 0 && (
          <div className="mt-4 pt-4 border-t border-sap-border space-y-2">
            <p className="text-2xs font-semibold">Progres per zona — yang paling tertinggal di atas</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              {mon.zones.map((z) => (
                <Bar
                  key={z.zone}
                  label={z.zone}
                  value={z.counted}
                  max={z.assigned}
                  right={`${z.counted}/${z.assigned} rak · ${z.pct}%`}
                  tone={z.pct >= 100 ? 'ok' : z.pct < 40 ? 'warn' : 'blue'}
                />
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="ZSO02 — Monitor & Kelola Opname" icon={<GitCompare size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ActionField label="Dokumen opname">
            <Select
              value={sel}
              onChange={(e) => {
                setSel(e.target.value);
                setCmp(null);
                openDoc(e.target.value);
              }}
            >
              <option value="">(pilih dokumen)</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.doc_number} · ronde {d.round} · {d.bins_counted}/{d.bin_count} rak
                  {d.managed ? ' · terkelola' : ''}
                </option>
              ))}
            </Select>
          </ActionField>
          <ActionField>
            <Button onClick={() => openDoc(sel)} loading={loading} disabled={!sel}>
              <RefreshCw size={13} /> Muat ulang
            </Button>
          </ActionField>
        </div>
      </Panel>

      {cmp && (
        <>
          <Panel title={`Ronde — ${cmp.doc_number}`} bodyClassName="p-3">
            <div className="flex flex-wrap gap-1.5">
              {cmp.rounds.map((r) => (
                <span
                  key={r.round}
                  className={`sap-badge ${
                    r.round === cmp.current_round
                      ? 'border-sap-blue bg-sap-blue/15 text-sap-blue'
                      : 'border-sap-neutralborder bg-sap-neutralbg text-sap-muted'
                  }`}
                  title={`Dibuka ${fmtDateTime(r.opened_at)} oleh ${r.opened_by}`}
                >
                  Ronde {r.round} · {r.counted}/{r.bins} rak
                  {r.not_blind ? ' · NON-BLIND' : ''}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <span className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext">
                Sepakat {cmp.summary.consensus}
              </span>
              <span className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext">
                Cocok sistem {cmp.summary.settled}
              </span>
              <span className="sap-badge border-sap-warnborder bg-sap-warnbg text-sap-warntext">
                Belum sepakat {cmp.summary.unresolved}
              </span>
              <span className="sap-badge border-sap-neutralborder bg-sap-neutralbg text-sap-muted">
                Belum dihitung {cmp.summary.not_counted}
              </span>
            </div>
            {cmp.rounds.some((r) => r.not_blind) && (
              <p className="text-xxs text-sap-warntext mt-2 flex items-start gap-1.5">
                <AlertTriangle size={12} className="shrink-0 mt-[1px]" />
                Ada ronde yang menampilkan jumlah sistem kepada petugas. Kesepakatan yang melibatkan
                ronde itu bobot buktinya lebih lemah — petugas bisa saja sekadar membenarkan angka
                yang sudah terlihat.
              </p>
            )}
          </Panel>

          <Panel
            title={`Perbandingan hasil — ${cmp.lines.length} baris`}
            bodyClassName="p-0"
            actions={
              <Button onClick={exportCompare}>
                <Download size={13} /> Export Excel
              </Button>
            }
          >
            <div className="overflow-auto max-h-[52dvh]">
              <table className="sap-grid">
                <thead>
                  <tr>
                    <th className="w-[130px]">Rak</th>
                    <th className="w-[130px]">Material</th>
                    <th className="w-[170px]">Deskripsi</th>
                    <th className="w-[120px]">Batch</th>
                    <th className="w-[80px] text-right">Sistem</th>
                    {cmp.rounds.map((r) => (
                      <th key={r.round} className="w-[110px] text-right">
                        Ronde {r.round}
                      </th>
                    ))}
                    <th className="w-[130px] text-center">Status</th>
                    <th className="w-[80px] text-right">Selisih</th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.lines.map((l, i) => {
                    const st = STATUS_LABEL[l.status];
                    return (
                      <tr
                        key={`${l.bin_code}|${l.material_code}|${l.batch_number}|${i}`}
                        className={l.needs_recount ? 'bg-sap-warnbg/30' : ''}
                      >
                        <td className="font-mono text-sap-blue">{l.bin_code}</td>
                        <td className="font-mono">{l.material_code}</td>
                        <td className="text-sap-muted truncate max-w-[170px]">{l.description}</td>
                        <td className="font-mono">{l.batch_number || '—'}</td>
                        <td className="text-right font-mono tabular-nums">{l.book_qty}</td>
                        {cmp.rounds.map((r) => {
                          const v = l.rounds.find((x) => x.round === r.round);
                          const isFinal = l.final_round === r.round;
                          return (
                            <td
                              key={r.round}
                              className={`text-right font-mono tabular-nums ${
                                isFinal ? 'text-sap-oktext font-semibold' : ''
                              }`}
                              title={v?.counted_by ? `dihitung ${v.counted_by}` : undefined}
                            >
                              {v?.counted_qty ?? '—'}
                              {v?.counted_by && (
                                <span className="block text-xxs text-sap-muted/70 font-normal">
                                  {v.counted_by}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center">
                          <span className={`sap-badge ${st.cls}`}>{st.text}</span>
                        </td>
                        <td
                          className={`text-right font-mono tabular-nums ${
                            l.diff_qty === null
                              ? 'text-sap-muted'
                              : l.diff_qty === 0
                                ? ''
                                : l.diff_qty > 0
                                  ? 'text-sap-oktext'
                                  : 'text-sap-errtext'
                          }`}
                        >
                          {l.diff_qty === null ? '—' : l.diff_qty > 0 ? `+${l.diff_qty}` : l.diff_qty}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title={
              cmp.by_material
                ? `Buka ronde ${cmp.current_round + 1} — ${pickMat.size} material dipilih`
                : `Buka ronde ${cmp.current_round + 1} — ${pick.size} rak dipilih`
            }
            icon={<PlayCircle size={13} className="text-sap-blue" />}
          >
            <div className="space-y-3">
              <p className="text-xxs text-sap-muted leading-relaxed">
                {cmp.by_material
                  ? 'Material yang masih ada baris belum sepakat sudah dicentang otomatis, dan penugasan ronde berjalan dipakai sebagai isian awal. Satu material tetap dikerjakan satu orang — pindahkan yang perlu diganti supaya hitungan berikutnya datang dari orang lain.'
                  : 'Rak yang masih ada baris belum sepakat sudah dicentang otomatis. Anda tetap bisa menambah rak lain yang ingin diperiksa ulang.'}
              </p>

              <div className="max-h-[26dvh] overflow-auto border border-sap-border rounded-[3px]">
                {cmp.by_material ? (
                  <table className="sap-grid">
                    <thead>
                      <tr>
                        <th className="w-[44px] text-center">Pilih</th>
                        <th className="w-[150px]">Material</th>
                        <th className="w-[190px]">Deskripsi</th>
                        <th className="w-[110px] text-right">Baris terbuka</th>
                        <th className="w-[170px]">Pernah dihitung</th>
                        <th className="w-[190px]">Ditugaskan ke</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allMaterials.map((code) => {
                        const on = pickMat.has(code);
                        const open = cmp.materials_need_recount.find(
                          (x) => x.material_code === code
                        );
                        const past = pastCountersOfMaterial(code);
                        const clash = on && matAssign[code] && past.includes(matAssign[code]);
                        return (
                          <tr
                            key={code}
                            className={clash ? 'bg-sap-warnbg/40' : on ? 'bg-sap-blue/10' : ''}
                          >
                            <td className="text-center">
                              <input
                                type="checkbox"
                                className="accent-sap-blue w-4 h-4"
                                checked={on}
                                onChange={() =>
                                  setPickMat((s2) => {
                                    const n = new Set(s2);
                                    if (n.has(code)) n.delete(code);
                                    else n.add(code);
                                    return n;
                                  })
                                }
                              />
                            </td>
                            <td className="font-mono text-sap-blue">
                              {code}
                              {matNeedSet.has(code) && (
                                <span className="ml-1.5 sap-badge border-sap-warnborder bg-sap-warnbg text-sap-warntext">
                                  selisih
                                </span>
                              )}
                            </td>
                            <td className="text-sap-muted truncate max-w-[190px]">
                              {descOf.get(code) ?? ''}
                            </td>
                            <td className="text-right font-mono tabular-nums">
                              {open?.open_lines ?? 0}
                            </td>
                            <td className="font-mono text-xxs text-sap-muted">
                              {past.length > 0 ? past.join(', ') : '—'}
                            </td>
                            <td>
                              <Select
                                className="!py-[3px]"
                                disabled={!on}
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
                ) : (
                <table className="sap-grid">
                  <thead>
                    <tr>
                      <th className="w-[44px] text-center">Pilih</th>
                      <th className="w-[150px]">Rak</th>
                      <th className="w-[110px] text-right">Baris terbuka</th>
                      <th className="w-[180px]">Pernah dihitung</th>
                      <th className="w-[190px]">Ditugaskan ke</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allBins.map((bin) => {
                      const on = pick.has(bin);
                      const open = cmp.bins_need_recount.find((x) => x.bin_code === bin);
                      const past = pastCounters(bin);
                      const clash = on && assign[bin] && past.includes(assign[bin]);
                      return (
                        <tr key={bin} className={clash ? 'bg-sap-warnbg/40' : on ? 'bg-sap-blue/10' : ''}>
                          <td className="text-center">
                            <input
                              type="checkbox"
                              className="accent-sap-blue w-4 h-4"
                              checked={on}
                              onChange={() => toggle(bin)}
                            />
                          </td>
                          <td className="font-mono text-sap-blue">
                            {bin}
                            {needSet.has(bin) && (
                              <span className="ml-1.5 sap-badge border-sap-warnborder bg-sap-warnbg text-sap-warntext">
                                selisih
                              </span>
                            )}
                          </td>
                          <td className="text-right font-mono tabular-nums">{open?.open_lines ?? 0}</td>
                          <td className="font-mono text-xxs text-sap-muted">
                            {past.length > 0 ? past.join(', ') : '—'}
                          </td>
                          <td>
                            <Select
                              className="!py-[3px]"
                              disabled={!on}
                              value={assign[bin] ?? ''}
                              onChange={(e) => setAssign((a) => ({ ...a, [bin]: e.target.value }))}
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
                )}
              </div>

              <ActionField label="Bagi rata otomatis">
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

              {repeatWarnings.length > 0 && (
                <div className="rounded-[3px] border border-sap-warnborder bg-sap-warnbg text-sap-warntext px-3 py-2 text-2xs">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle size={12} /> Penghitung berulang
                  </p>
                  <p className="mt-1 leading-relaxed">
                    {repeatWarnings.join(', ')} akan dihitung orang yang sudah pernah
                    menghitungnya. Tetap boleh, tetapi hitungannya <b>tidak menambah bukti</b> —
                    aturan sepakat menghitung jumlah ORANG yang berbeda, jadi ronde itu terbuang
                    tanpa mendekatkan baris mana pun ke ambang {AGREEMENT_REQUIRED} orang.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="sap-control-row text-2xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-sap-blue w-4 h-4"
                    checked={showBookQty}
                    onChange={(e) => setShowBookQty(e.target.checked)}
                  />
                  {showBookQty ? <Eye size={12} className="text-sap-warntext" /> : <EyeOff size={12} className="text-sap-oktext" />}
                  <span>Tampilkan jumlah sistem kepada petugas ronde ini</span>
                </label>
                <label className="sap-control-row text-2xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-sap-blue w-4 h-4"
                    checked={showPrevRound}
                    onChange={(e) => setShowPrevRound(e.target.checked)}
                  />
                  <span>Tampilkan hasil ronde sebelumnya</span>
                </label>
              </div>
            </div>
          </Panel>

          {unresolvedLines.length > 0 && (
            <Panel
              title={`Keputusan supervisor — ${unresolvedLines.length} baris belum sepakat`}
              icon={<Gavel size={13} className="text-sap-warntext" />}
              bodyClassName="p-0"
            >
              <p className="px-3 pt-3 text-xxs text-sap-muted leading-relaxed">
                Baris di bawah tidak pernah punya dua ronde yang sepakat. Pilihan pertama tetap{' '}
                <b>membuka ronde berikutnya</b> — hitungan ketiga sering menyelesaikannya sendiri.
                Tetapkan angka manual hanya bila penghitungan ulang tidak mungkin lagi; angkanya
                disimpan sebagai keputusan tersendiri dan hasil tiap ronde tetap utuh sebagai jejak.
              </p>
              <table className="sap-grid mt-2">
                <thead>
                  <tr>
                    <th className="w-[120px]">Rak</th>
                    <th className="w-[130px]">Material</th>
                    <th className="w-[110px]">Batch</th>
                    <th className="w-[70px] text-right">Sistem</th>
                    <th>Hasil tiap ronde</th>
                    <th className="w-[150px]">Angka final</th>
                  </tr>
                </thead>
                <tbody>
                  {unresolvedLines.map((l) => {
                    const k = `${l.bin_code}|${l.material_code}|${l.batch_number}`;
                    return (
                      <tr key={k}>
                        <td className="font-mono text-sap-blue">{l.bin_code}</td>
                        <td className="font-mono">{l.material_code}</td>
                        <td className="font-mono">{l.batch_number || '—'}</td>
                        <td className="text-right font-mono tabular-nums">{l.book_qty}</td>
                        <td className="text-xxs font-mono text-sap-muted">
                          <div className="flex flex-wrap gap-1">
                            {l.rounds
                              .filter((r) => r.counted_qty !== null)
                              .map((r) => (
                                <button
                                  key={r.round}
                                  type="button"
                                  onClick={() =>
                                    setDecide((d) => ({ ...d, [k]: String(r.counted_qty) }))
                                  }
                                  title="Pakai angka ronde ini"
                                  className="sap-btn !py-[2px] !px-1.5 text-xxs"
                                >
                                  R{r.round}: {r.counted_qty} ({r.counted_by ?? '-'})
                                </button>
                              ))}
                          </div>
                          {/* Seberapa dekat tiap angka ke ambang kesepakatan —
                              supaya supervisor tahu satu ronde lagi mungkin cukup. */}
                          <div className="mt-1 text-xxs text-sap-muted/80">
                            {tally(l.rounds).map((t) => (
                              <span key={t.qty} className="mr-2">
                                {t.qty} → {t.voters.length}/{AGREEMENT_REQUIRED} orang
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <Input
                            type="number"
                            min={0}
                            className="text-right !py-[3px]"
                            value={decide[k] ?? ''}
                            onChange={(e) => setDecide((d) => ({ ...d, [k]: e.target.value }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="p-2 border-t border-sap-border">
                <Button onClick={saveDecisions} loading={busy} disabled={decidedCount === 0}>
                  <Save size={13} /> Simpan {decidedCount} keputusan
                </Button>
              </div>
            </Panel>
          )}

          <Toolbar>
            <Button variant="primary" disabled={roundPickCount === 0} onClick={() => setConfirmOpen(true)}>
              <PlayCircle size={13} /> Buka ronde {cmp.current_round + 1} ({roundPickCount})
            </Button>
            <Button
              variant={readyToPost ? 'primary' : 'default'}
              disabled={!readyToPost}
              onClick={() => setPostOpen(true)}
            >
              <CheckCircle2 size={13} /> Posting penyesuaian
            </Button>
            {readyToPost && (
              <span className="text-2xs text-sap-oktext flex items-center gap-1.5">
                Semua baris sudah punya angka final.
              </span>
            )}
          </Toolbar>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`Buka ronde ${(cmp?.current_round ?? 0) + 1}`}
        question={
          cmp?.by_material
            ? `${pickMat.size} material akan dihitung ulang pada ronde ${(cmp?.current_round ?? 0) + 1}.`
            : `${pick.size} rak akan dihitung ulang pada ronde ${(cmp?.current_round ?? 0) + 1}.`
        }
        details={[
          {
            label: cmp?.by_material ? 'Material dipilih' : 'Rak dipilih',
            value: roundPickCount,
          },
          { label: 'Penghitung berulang', value: repeatWarnings.length },
          { label: 'Jumlah sistem', value: showBookQty ? 'Terlihat petugas' : 'Disembunyikan' },
          { label: 'Hasil ronde lalu', value: showPrevRound ? 'Terlihat petugas' : 'Disembunyikan' },
        ]}
        confirmLabel="Buka ronde"
        busy={busy}
        onConfirm={openRound}
        onCancel={() => setConfirmOpen(false)}
      />

      {wall && mon && (
        <div className="fixed inset-0 z-[95] bg-sap-bg overflow-auto">
          <div className="sticky top-0 flex items-center gap-3 px-4 py-2.5 bg-sap-titlebar border-b border-sap-border">
            <BarChart3 size={16} className="text-sap-blue" />
            <span className="text-2xs font-semibold uppercase tracking-wide">
              Layar Pantau Opname
            </span>
            <span className="text-xxs text-sap-muted font-mono">
              diperbarui {monAt} · otomatis tiap 1 menit
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button onClick={loadMon}>
                <RefreshCw size={13} /> Segarkan
              </Button>
              <Button onClick={() => setWall(false)}>
                <X size={13} /> Tutup
              </Button>
            </div>
          </div>

          <div className="p-5 space-y-6 max-w-[1400px] mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Rak ditugaskan', value: mon.totals.assigned },
                { label: 'Rak selesai', value: mon.totals.counted },
                {
                  label: 'Progres',
                  value: `${mon.totals.assigned === 0 ? 0 : Math.round((mon.totals.counted / mon.totals.assigned) * 100)}%`,
                },
                { label: 'Opname berjalan', value: mon.docs.length },
              ].map((k) => (
                <div key={k.label} className="sap-panel p-4">
                  <p className="text-xxs text-sap-muted uppercase tracking-wide">{k.label}</p>
                  <p className="text-2xl font-mono text-sap-text mt-1">{k.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="sap-panel p-4 space-y-3">
                <p className="text-2xs font-semibold">Progres per petugas</p>
                {mon.counters.length === 0 ? (
                  <p className="text-xxs text-sap-muted">Belum ada rak yang ditugaskan.</p>
                ) : (
                  mon.counters.map((c) => (
                    <Bar
                      key={c.username}
                      label={c.username}
                      value={c.counted}
                      max={c.assigned}
                      right={`${c.counted}/${c.assigned} · ${c.pct}%`}
                      tone={c.pct >= 100 ? 'ok' : 'blue'}
                    />
                  ))
                )}
              </div>

              <div className="sap-panel p-4 space-y-3">
                <p className="text-2xs font-semibold">Progres per zona</p>
                {mon.zones.map((z) => (
                  <Bar
                    key={z.zone}
                    label={z.zone}
                    value={z.counted}
                    max={z.assigned}
                    right={`${z.counted}/${z.assigned} · ${z.pct}%`}
                    tone={z.pct >= 100 ? 'ok' : z.pct < 40 ? 'warn' : 'blue'}
                  />
                ))}
              </div>
            </div>

            <div className="sap-panel p-4 space-y-2">
              <p className="text-2xs font-semibold">Rak selesai per hari</p>
              <DailyChart data={mon.daily} />
            </div>

            <div className="sap-panel p-0">
              <table className="sap-grid">
                <thead>
                  <tr>
                    <th>Dokumen</th>
                    <th className="w-[90px] text-center">Ronde</th>
                    <th className="w-[110px] text-right">Rak</th>
                    <th className="w-[110px] text-right">Selesai</th>
                    <th className="w-[100px] text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {mon.docs.map((d) => (
                    <tr key={d.doc_number}>
                      <td className="font-mono text-sap-blue">{d.doc_number}</td>
                      <td className="text-center font-mono">{d.round}</td>
                      <td className="text-right font-mono tabular-nums">{d.assigned}</td>
                      <td className="text-right font-mono tabular-nums">{d.counted}</td>
                      <td className="text-right font-mono tabular-nums">
                        {d.assigned === 0 ? 0 : Math.round((d.counted / d.assigned) * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={postOpen}
        title="Posting penyesuaian opname"
        question={`Selisih dokumen ${cmp?.doc_number ?? ''} akan diposting ke stok dan seluruh rak dilepas dari freeze.`}
        details={[
          { label: 'Baris sepakat', value: cmp?.summary.consensus ?? 0 },
          { label: 'Cocok sistem', value: cmp?.summary.settled ?? 0 },
          { label: 'Ditetapkan supervisor', value: cmp?.summary.manual ?? 0 },
          { label: 'Belum dihitung (dilewati)', value: cmp?.summary.not_counted ?? 0 },
        ]}
        confirmLabel="Posting"
        danger
        busy={busy}
        onConfirm={postDoc}
        onCancel={() => setPostOpen(false)}
      />
    </div>
  );
}
