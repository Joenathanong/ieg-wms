'use client';

/**
 * ZMATDUP — Pemindai & Penggabung SKU Kembar (desktop, ADMIN).
 *
 * Satu barang fisik yang terlanjur terdaftar dengan dua kode SKU membelah
 * stoknya menjadi dua selamanya: safety stock salah, FEFO tidak melihat
 * separuh batch, dan hasil opname tidak pernah cocok. Layar ini menemukan
 * pasangan seperti itu, lalu menggabungkannya menjadi satu.
 *
 * Penggabungan TIDAK menghapus kode duplikat. Kodenya ditutup dan didaftarkan
 * sebagai alias, sehingga:
 *   - riwayat MB51 tetap punya master,
 *   - karton lama yang tercetak kode itu tetap bisa discan,
 *   - file Excel dari principal yang masih memakai kode lama tetap terbaca.
 *
 * Stok dipindahkan dengan transfer posting material ke material (SAP 309):
 * dua baris per quant pada satu material document, sisi keluar dan sisi masuk,
 * pada bin dan batch yang sama persis.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Search, GitMerge, AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import {
  Panel,
  Field,
  Input,
  Select,
  Button,
  Toolbar,
  ActionField,
  exportCsv,
  type Column,
} from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useExecuteKey } from '@/components/sap/keynav';
import { ConfirmDialog } from '@/components/sap/Confirm';
import { invalidateMasterData } from '@/components/sap/hooks';
import { api, post } from '@/lib/client';

interface Member {
  material_code: string;
  description: string;
  uom: string;
  is_batch_managed: boolean;
  barcode_bpom: string | null;
  barcode_produk: string | null;
  kode_ocs: string | null;
  fix_bin: string | null;
  min_safety_stock: number;
  created_at: string;
  total_qty: number;
  quants: number;
  history_docs: number;
  alias_count: number;
}

interface Group {
  kind: 'NAMA' | 'BARCODE';
  key: string;
  members: Member[];
  suggested_primary: string;
}

interface PlanLine {
  bin_code: string;
  batch_number: string | null;
  qty: number;
  exp_date: string | null;
}

interface Plan {
  from_code: string;
  from_description: string;
  into_code: string;
  into_description: string;
  lines: PlanLine[];
  total_qty: number;
  carried: string[];
  blockers: string[];
  history_docs: number;
}

const nf = (n: number) => n.toLocaleString('de-DE');

export default function ZmatdupPage() {
  const { setStatus } = useStatus();

  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(false);

  /** kode utama pilihan per kelompok — kunci Map = key kelompok */
  const [primary, setPrimary] = useState<Record<string, string>>({});
  /** kode duplikat yang dicentang untuk digabung, per kelompok */
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true);
    setPlan(null);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim().toUpperCase());
    if (kind) params.set('kind', kind);
    const r = await api<{ groups: Group[]; total_groups: number }>(
      `/api/materials/duplicates?${params.toString()}`
    );
    setLoading(false);
    setStatus(r.message, r.ok ? (r.data?.total_groups ? 'W' : 'S') : 'E');
    if (r.ok && r.data) {
      setGroups(r.data.groups);
      // Saran kode utama dipasang sebagai pilihan awal, tetapi tetap bisa
      // diubah: mesin hanya tahu angka, orang gudang tahu kode mana yang
      // sebenarnya dipakai di dokumen luar.
      const p: Record<string, string> = {};
      for (const g of r.data.groups) p[g.key] = g.suggested_primary;
      setPrimary(p);
      setPicked({});
    }
  }, [q, kind, setStatus]);

  useExecuteKey(scan);
  useEffect(() => {
    void scan();
    // sekali saat layar dibuka
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePick(groupKey: string, code: string) {
    setPicked((s) => {
      const cur = s[groupKey] ?? [];
      return {
        ...s,
        [groupKey]: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code],
      };
    });
  }

  /** pratinjau: hitung apa yang akan terjadi, tanpa mengubah apa pun */
  async function preview(from_code: string, into_code: string) {
    setPlanning(true);
    setPlan(null);
    const r = await post<Plan>('/api/materials/merge', {
      from_code,
      into_code,
      dry_run: true,
    });
    setPlanning(false);
    setStatus(r.message, r.ok ? (r.data?.blockers.length ? 'W' : 'S') : 'E');
    if (r.ok && r.data) setPlan(r.data);
  }

  async function runMerge() {
    if (!plan) return;
    setBusy(true);
    setConfirmOpen(false);
    const r = await post('/api/materials/merge', {
      from_code: plan.from_code,
      into_code: plan.into_code,
    });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setPlan(null);
      // katalog material di sisi klien memuat kode yang baru saja ditutup
      invalidateMasterData();
      void scan();
    }
  }

  const totalSku = useMemo(
    () => new Set((groups ?? []).flatMap((g) => g.members.map((m) => m.material_code))).size,
    [groups]
  );

  function exportGroups() {
    type ExportRow = {
      kelompok: string;
      kunci: string;
      material_code: string;
      description: string;
      uom: string;
      stok: number;
      quant: number;
      dokumen_mb51: number;
      barcode: string;
      saran_utama: string;
    };

    const rows: ExportRow[] = (groups ?? []).flatMap((g) =>
      g.members.map((m) => ({
        kelompok: g.kind,
        kunci: g.key,
        material_code: m.material_code,
        description: m.description,
        uom: m.uom,
        stok: m.total_qty,
        quant: m.quants,
        dokumen_mb51: m.history_docs,
        barcode: [m.barcode_bpom, m.barcode_produk].filter(Boolean).join(' / '),
        saran_utama: g.suggested_primary === m.material_code ? 'X' : '',
      }))
    );
    if (rows.length === 0) return setStatus('Tidak ada data untuk diekspor', 'W');

    const cols: Column<ExportRow>[] = [
      { key: 'kelompok', header: 'Jenis Kembar' },
      { key: 'kunci', header: 'Nama / Barcode' },
      { key: 'material_code', header: 'Material' },
      { key: 'description', header: 'Deskripsi' },
      { key: 'uom', header: 'UoM' },
      { key: 'stok', header: 'Stok' },
      { key: 'quant', header: 'Quant' },
      { key: 'dokumen_mb51', header: 'Dokumen MB51' },
      { key: 'barcode', header: 'Barcode' },
      { key: 'saran_utama', header: 'Saran Kode Utama' },
    ];

    exportCsv(`sku-kembar-${new Date().toISOString().slice(0, 10)}.csv`, cols, rows);
    setStatus(`${rows.length} baris diekspor`, 'S');
  }

  return (
    <div className="space-y-3">
      <Panel
        title="ZMATDUP — Cari SKU Kembar"
        icon={<Copy size={13} className="text-sap-warntext" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
          <Field label="Kata kunci" hint="Kode atau nama produk. Kosongkan untuk melihat semuanya.">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="mis. HANASUI"
              className="uppercase"
            />
          </Field>
          <Field label="Jenis kembar">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Semua</option>
              <option value="NAMA">Nama produk sama</option>
              <option value="BARCODE">Barcode sama</option>
            </Select>
          </Field>
          <ActionField>
            <Button variant="primary" onClick={scan} loading={loading}>
              <Search size={12} /> Cari
            </Button>
          </ActionField>
          <ActionField>
            <Button onClick={exportGroups} disabled={!groups?.length}>
              Export CSV
            </Button>
          </ActionField>
        </div>
      </Panel>

      {groups && groups.length === 0 && (
        <Panel>
          <p className="text-2xs text-sap-oktext">
            Tidak ada SKU kembar. Setiap nama produk dan setiap barcode hanya dipakai satu kode
            material.
          </p>
        </Panel>
      )}

      {groups && groups.length > 0 && (
        <Panel
          title={`${groups.length} kelompok kembar · ${totalSku} kode SKU terlibat`}
          icon={<AlertTriangle size={13} className="text-sap-warntext" />}
          actions={
            <Button onClick={scan} loading={loading}>
              <RefreshCw size={12} /> Muat ulang
            </Button>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-sap-border">
            {groups.map((g) => {
              const primaryCode = primary[g.key] ?? g.suggested_primary;
              const chosen = picked[g.key] ?? [];
              return (
                <div key={`${g.kind}|${g.key}`} className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`sap-badge ${
                        g.kind === 'NAMA'
                          ? 'border-sap-warnborder bg-sap-warnbg text-sap-warntext'
                          : 'border-sap-errborder bg-sap-errbg text-sap-errtext'
                      }`}
                    >
                      {g.kind === 'NAMA' ? 'NAMA SAMA' : 'BARCODE SAMA'}
                    </span>
                    <span className="text-2xs font-medium">{g.key}</span>
                    <span className="text-xxs text-sap-muted">{g.members.length} kode</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-2xs">
                      <thead className="bg-sap-thead text-sap-muted">
                        <tr>
                          <th className="p-1 w-16 text-left">Utama</th>
                          <th className="p-1 w-16 text-left">Gabung</th>
                          <th className="p-1 text-left">Material</th>
                          <th className="p-1 text-left">Deskripsi</th>
                          <th className="p-1 text-right">Stok</th>
                          <th className="p-1 text-right">Quant</th>
                          <th className="p-1 text-right">Dok. MB51</th>
                          <th className="p-1 text-left">Barcode</th>
                          <th className="p-1 text-left">Dibuat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.members.map((m) => {
                          const isPrimary = m.material_code === primaryCode;
                          return (
                            <tr
                              key={m.material_code}
                              className={`border-t border-sap-border ${
                                isPrimary ? 'bg-sap-okbg/40' : ''
                              }`}
                            >
                              <td className="p-1 text-center">
                                <input
                                  type="radio"
                                  name={`primary-${g.kind}-${g.key}`}
                                  aria-label={`Jadikan ${m.material_code} kode utama`}
                                  checked={isPrimary}
                                  onChange={() => {
                                    setPrimary((s) => ({ ...s, [g.key]: m.material_code }));
                                    // kode utama tidak boleh sekaligus jadi kode
                                    // yang digabung ke dirinya sendiri
                                    setPicked((s) => ({
                                      ...s,
                                      [g.key]: (s[g.key] ?? []).filter(
                                        (c) => c !== m.material_code
                                      ),
                                    }));
                                  }}
                                />
                              </td>
                              <td className="p-1 text-center">
                                <input
                                  type="checkbox"
                                  aria-label={`Gabungkan ${m.material_code}`}
                                  disabled={isPrimary}
                                  checked={chosen.includes(m.material_code)}
                                  onChange={() => togglePick(g.key, m.material_code)}
                                />
                              </td>
                              <td className="p-1 font-mono">
                                {m.material_code}
                                {isPrimary && (
                                  <span className="ml-1 text-xxs text-sap-oktext">utama</span>
                                )}
                              </td>
                              <td className="p-1">{m.description}</td>
                              <td className="p-1 text-right font-mono tabular-nums">
                                {nf(m.total_qty)} {m.uom}
                              </td>
                              <td className="p-1 text-right font-mono tabular-nums">{m.quants}</td>
                              <td className="p-1 text-right font-mono tabular-nums">
                                {nf(m.history_docs)}
                              </td>
                              <td className="p-1 font-mono text-xxs">
                                {[m.barcode_bpom, m.barcode_produk].filter(Boolean).join(' · ') ||
                                  '—'}
                              </td>
                              <td className="p-1 text-xxs text-sap-muted">
                                {new Date(m.created_at).toLocaleDateString('id-ID')}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xxs text-sap-muted">
                      {chosen.length === 0
                        ? 'Centang kode yang akan digabung ke kode utama.'
                        : `${chosen.join(', ')} → ${primaryCode}`}
                    </span>
                    <Button
                      className="ml-auto"
                      disabled={chosen.length !== 1 || planning}
                      loading={planning}
                      onClick={() => preview(chosen[0], primaryCode)}
                    >
                      <ArrowRight size={12} /> Pratinjau penggabungan
                    </Button>
                  </div>
                  {chosen.length > 1 && (
                    <p className="text-xxs text-sap-warntext">
                      Gabungkan satu per satu. Setiap penggabungan memindahkan stok sungguhan, jadi
                      hasilnya perlu dilihat sebelum yang berikutnya dijalankan.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {plan && (
        <Panel
          title={`Pratinjau — ${plan.from_code} digabung ke ${plan.into_code}`}
          icon={<GitMerge size={13} className="text-sap-blue" />}
          actions={
            <>
              <Button onClick={() => setPlan(null)}>Tutup</Button>
              <Button
                variant="danger"
                disabled={plan.blockers.length > 0 || busy}
                loading={busy}
                onClick={() => setConfirmOpen(true)}
              >
                <GitMerge size={12} /> Jalankan penggabungan
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {plan.blockers.length > 0 && (
              <div className="rounded-sappanel border border-sap-errborder bg-sap-errbg p-2">
                <p className="text-2xs font-medium text-sap-errtext">
                  Belum bisa dijalankan — {plan.blockers.length} hal perlu dibereskan:
                </p>
                <ul className="mt-1 list-disc pl-4 text-xxs text-sap-errtext space-y-0.5">
                  {plan.blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-start">
              <Field label="Kode duplikat">
                <Input disabled value={`${plan.from_code} — ${plan.from_description}`} />
              </Field>
              <Field label="Kode utama">
                <Input disabled value={`${plan.into_code} — ${plan.into_description}`} />
              </Field>
              <Field label="Quant dipindahkan">
                <Input
                  disabled
                  value={`${plan.lines.length} baris · ${nf(plan.total_qty)}`}
                  className="font-mono"
                />
              </Field>
              <Field label="Riwayat MB51 kode duplikat">
                <Input disabled value={`${nf(plan.history_docs)} baris`} className="font-mono" />
              </Field>
            </div>

            {plan.carried.length > 0 && (
              <div className="rounded-sappanel border border-sap-border bg-sap-infobg p-2">
                <p className="text-xxs text-sap-infotext">
                  Ikut dipindahkan ke {plan.into_code} karena kolomnya masih kosong di sana:{' '}
                  {plan.carried.join(', ')}.
                </p>
              </div>
            )}

            {plan.lines.length === 0 ? (
              <p className="text-2xs text-sap-muted">
                {plan.from_code} tidak punya stok. Penggabungan hanya menutup kodenya dan
                mendaftarkannya sebagai alias — tidak ada material document yang terbit.
              </p>
            ) : (
              <div className="border border-sap-border rounded overflow-x-auto max-h-72">
                <table className="w-full text-2xs">
                  <thead className="bg-sap-thead text-sap-muted sticky top-0">
                    <tr>
                      <th className="p-1 text-left">Bin</th>
                      <th className="p-1 text-left">Batch</th>
                      <th className="p-1 text-left">Expired</th>
                      <th className="p-1 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.lines.map((l, i) => (
                      <tr key={i} className="border-t border-sap-border">
                        <td className="p-1 font-mono">{l.bin_code}</td>
                        <td className="p-1 font-mono">{l.batch_number ?? '—'}</td>
                        <td className="p-1 font-mono">
                          {l.exp_date ? new Date(l.exp_date).toLocaleDateString('id-ID') : '—'}
                        </td>
                        <td className="p-1 text-right font-mono tabular-nums">{nf(l.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xxs text-sap-muted">
              Kode {plan.from_code} tidak dihapus. Ia ditutup dan didaftarkan sebagai alias, jadi
              riwayat MB51-nya tetap punya master dan karton lama tetap bisa discan.
            </p>
          </div>
        </Panel>
      )}

      <Toolbar>
        <span className="text-xxs text-sap-muted">
          Penggabungan memakai transfer posting material ke material (309) — dua baris per quant
          pada satu material document, bisa ditelusuri di MB51.
        </span>
      </Toolbar>

      <ConfirmDialog
        open={confirmOpen}
        title="Konfirmasi Penggabungan SKU"
        danger
        busy={busy}
        confirmLabel="Ya, gabungkan"
        question="Stok akan benar-benar dipindahkan dan kode duplikat ditutup. Membalikkannya harus lewat penggabungan ke arah sebaliknya."
        details={
          plan
            ? [
                { label: 'Kode duplikat', value: `${plan.from_code} — ${plan.from_description}` },
                { label: 'Kode utama', value: `${plan.into_code} — ${plan.into_description}` },
                {
                  label: 'Stok dipindahkan',
                  value: `${plan.lines.length} quant · ${nf(plan.total_qty)}`,
                },
                {
                  label: 'Sesudahnya',
                  value: `${plan.from_code} ditutup dan dibaca sebagai ${plan.into_code}`,
                },
              ]
            : []
        }
        onConfirm={runMerge}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
