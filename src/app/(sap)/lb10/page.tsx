'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ListTodo, Search, RefreshCw, ArrowRight, Trash2, Download, Unlink, AlertTriangle } from 'lucide-react';
import { Panel, Field, ActionField, Input, Select, Button, Toolbar, Grid, exportCsv, type Column} from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useExecuteKey } from '@/components/sap/keynav';
import { api, del, post, qs, fmtDateTime } from '@/lib/client';
import { WILDCARD_HINT } from '@/lib/like';

interface Row {
  id: string;
  tr_number: string;
  tr_type: 'PUTAWAY' | 'PICK' | 'INTERNAL';
  status: 'OPEN' | 'PARTIAL' | 'CLOSED' | 'CANCELLED';
  ref_doc: string | null;
  reference: string | null;
  created_by: string;
  created_at: string;
  item_count: number;
  open_lines: number;
  total_qty: number;
  confirmed_qty: number;
  materials: string;
  description: string;
  uom: string;
}

const TYPE_STYLE: Record<string, string> = {
  PUTAWAY: 'border-sap-okborder bg-sap-okbg text-sap-oktext',
  PICK: 'border-sap-warnborder bg-sap-warnbg text-sap-warntext',
  INTERNAL: 'border-sap-infoborder bg-sap-infobg text-sap-infotext',
};

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'border-sap-infoborder bg-sap-infobg text-sap-infotext',
  PARTIAL: 'border-sap-warnborder bg-sap-warnbg text-sap-warntext',
  CLOSED: 'border-sap-okborder bg-sap-okbg text-sap-oktext',
  CANCELLED: 'border-sap-neutralborder bg-sap-neutralbg text-sap-muted',
};

/** Satu baris put-away yang stoknya sudah tidak ada lagi di bin transit. */
interface Orphan {
  item_id: string;
  tr_number: string;
  line_no: number;
  material_code: string;
  description: string;
  uom: string;
  batch_number: string | null;
  bin_code: string;
  open_qty: number;
  available: number;
  shortage: number;
}

export default function Lb10Page() {
  const { setStatus } = useStatus();
  const router = useRouter();

  const [status, setStatusFilter] = useState('');
  const [type, setType] = useState('');
  const [material, setMaterial] = useState('');
  const [tr, setTr] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  /** hasil pemeriksaan baris put-away yang menggantung; null = belum diperiksa */
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    const r = await api<Row[]>('/api/tr' + qs({ status, type, material, tr }));
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRows(r.data ?? []);
    setStatus(r.message, (r.data?.length ?? 0) > 0 ? 'S' : 'W');
  }, [status, type, material, tr, setStatus]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, type]);

  // Enter / F8 = Execute
  useExecuteKey(run);

  async function cancel(row: Row) {
    const r = await del(`/api/tr/${row.id}`);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) run();
  }

  /**
   * Cari baris put-away yang tidak akan pernah bisa dikonfirmasi karena
   * stoknya sudah tidak ada di bin transit — biasanya karena barangnya
   * dipindahkan lewat transfer bin manual dan melewati LB12.
   */
  async function scanOrphans() {
    setScanning(true);
    setPicked([]);
    const r = await api<{ rows: Orphan[]; total: number }>('/api/tr/orphans');
    setScanning(false);
    setStatus(r.message, r.ok ? (r.data?.total ? 'W' : 'S') : 'E');
    if (r.ok && r.data) setOrphans(r.data.rows);
  }

  /**
   * Batalkan baris yang dipilih. Dikelompokkan per TR karena endpoint-nya
   * bekerja per dokumen — dan itu memang benar: status header harus dihitung
   * ulang sekali untuk seluruh baris yang dibatalkan di dokumen yang sama.
   */
  async function cancelPicked() {
    if (picked.length === 0) return setStatus('Belum ada baris yang dipilih', 'E');
    const byTr = new Map<string, string[]>();
    for (const o of orphans ?? []) {
      if (!picked.includes(o.item_id)) continue;
      byTr.set(o.tr_number, [...(byTr.get(o.tr_number) ?? []), o.item_id]);
    }

    setBusy(true);
    let done = 0;
    const failed: string[] = [];
    for (const [trNumber, ids] of byTr) {
      const r = await post(`/api/tr/${encodeURIComponent(trNumber)}/cancel-lines`, {
        item_ids: ids,
        reason: 'stok sudah tidak ada di bin transit (LB10)',
      });
      if (r.ok) done += ids.length;
      else failed.push(`${trNumber}: ${r.message}`);
    }
    setBusy(false);

    setStatus(
      failed.length === 0
        ? `${done} baris menggantung dibatalkan. Stok tidak berubah.`
        : `${done} baris dibatalkan, ${failed.length} TR gagal — ${failed[0]}`,
      failed.length === 0 ? 'S' : 'E'
    );
    await scanOrphans();
    run();
  }

  const cols: Column<Row>[] = [
    { key: 'tr_number', header: 'TR Number', mono: true, width: '130px' },
    {
      key: 'tr_type',
      header: 'Type',
      width: '105px',
      exportValue: (r) => r.tr_type,
      render: (r) => <span className={`sap-badge ${TYPE_STYLE[r.tr_type]}`}>{r.tr_type}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '105px',
      exportValue: (r) => r.status,
      render: (r) => <span className={`sap-badge ${STATUS_STYLE[r.status]}`}>{r.status}</span>,
    },
    { key: 'materials', header: 'Material', mono: true, width: '150px' },
    { key: 'description', header: 'Description', width: '210px' },
    { key: 'total_qty', header: 'Total Qty', align: 'right', width: '95px' },
    {
      key: 'confirmed_qty',
      header: 'Confirmed',
      align: 'right',
      width: '100px',
      render: (r) => (
        <span className={r.confirmed_qty >= r.total_qty ? 'text-sap-oktext' : 'text-sap-warntext'}>
          {r.confirmed_qty.toLocaleString('de-DE')}
        </span>
      ),
    },
    {
      key: 'open_lines',
      header: 'Open / Lines',
      align: 'center',
      width: '110px',
      exportValue: (r) => `${r.open_lines} / ${r.item_count}`,
      render: (r) => (
        <span className="font-mono">
          {r.open_lines} / {r.item_count}
        </span>
      ),
    },
    { key: 'ref_doc', header: 'Mat. Doc.', mono: true, width: '125px' },
    { key: 'created_by', header: 'Created By', mono: true, width: '110px' },
    {
      key: 'created_at',
      header: 'Created On',
      mono: true,
      width: '150px',
      value: (r) => new Date(r.created_at),
      exportValue: (r) => fmtDateTime(r.created_at),
      render: (r) => fmtDateTime(r.created_at),
    },
    {
      key: 'act',
      header: '',
      width: '86px',
      align: 'center',
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          {r.status !== 'CLOSED' && r.status !== 'CANCELLED' && (
            <Link
              href={`/lb12?tr=${r.tr_number}`}
              title="Process in LB12"
              className="text-sap-muted hover:text-sap-blue p-1"
              onClick={(e) => e.stopPropagation()}
            >
              <ArrowRight size={13} />
            </Link>
          )}
          {r.confirmed_qty === 0 && r.status !== 'CLOSED' && r.status !== 'CANCELLED' && (
            <button
              type="button"
              title="Cancel transfer requirement"
              onClick={(e) => {
                e.stopPropagation();
                cancel(r);
              }}
              className="text-sap-muted hover:text-sap-error p-1"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <Panel title="LB10 — Transfer Requirement List (Warehouse Work Queue)" icon={<ListTodo size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-start">
          <Field label="TR / Reference" hint={WILDCARD_HINT}>
            <Input
              className="uppercase"
              placeholder="TR* / no. dokumen"
              value={tr}
              onChange={(e) => setTr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              <option value="PUTAWAY">PUTAWAY — hasil GR, tunggu disimpan</option>
              <option value="PICK">PICK — permintaan pengeluaran</option>
              <option value="INTERNAL">INTERNAL — pemindahan internal</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Open + Partial (default)</option>
              <option value="OPEN">OPEN</option>
              <option value="PARTIAL">PARTIAL</option>
              <option value="CLOSED">CLOSED</option>
              <option value="CANCELLED">CANCELLED</option>
              <option value="ALL">Semua status</option>
            </Select>
          </Field>
          <Field label="Material / Description" hint={WILDCARD_HINT}>
            <Input
              className="uppercase"
              placeholder="kode atau deskripsi"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
          </Field>
          <ActionField>
            <Button variant="primary" onClick={run} loading={loading}>
              <Search size={13} /> Execute (F8)
            </Button>
          </ActionField>
        </div>
      </Panel>

      <Toolbar>
        <Button onClick={run} loading={loading}>
          <RefreshCw size={13} /> Refresh
        </Button>
        <Button onClick={() => exportCsv('LB10_transfer_requirements.csv', cols, view)} disabled={view.length === 0}>
          <Download size={13} /> Export CSV
        </Button>
        <Button onClick={scanOrphans} loading={scanning}>
          <Unlink size={13} /> Periksa baris menggantung
        </Button>
        <span className="ml-auto text-xxs text-sap-muted">
          Klik baris untuk membuka LB12 dan menentukan rak
        </span>
      </Toolbar>

      {orphans && (
        <Panel
          title={
            orphans.length === 0
              ? 'Baris menggantung — tidak ada'
              : `Baris menggantung — ${orphans.length} baris pada ${new Set(orphans.map((o) => o.tr_number)).size} TR`
          }
          icon={
            orphans.length === 0 ? (
              <Unlink size={13} className="text-sap-oktext" />
            ) : (
              <AlertTriangle size={13} className="text-sap-warntext" />
            )
          }
          bodyClassName={orphans.length === 0 ? 'p-3' : 'p-0'}
          actions={
            orphans.length > 0 ? (
              <>
                <span className="hidden lg:inline text-xxs text-sap-muted mr-2">
                  {picked.length} dipilih
                </span>
                <Button variant="danger" onClick={cancelPicked} loading={busy} disabled={picked.length === 0}>
                  <Trash2 size={12} /> Batalkan baris terpilih
                </Button>
                <Button onClick={() => setOrphans(null)}>Tutup</Button>
              </>
            ) : (
              <Button onClick={() => setOrphans(null)}>Tutup</Button>
            )
          }
        >
          {orphans.length === 0 ? (
            <p className="text-2xs text-sap-oktext">
              Semua baris put-away yang terbuka masih punya stoknya di bin transit. Tidak ada yang
              menggantung.
            </p>
          ) : (
            <>
              <div className="p-3 border-b border-sap-border">
                <p className="text-xxs text-sap-muted leading-relaxed">
                  Baris di bawah ini <b>tidak akan pernah bisa dikonfirmasi</b>: stok yang
                  ditunggunya sudah tidak ada di bin transit — biasanya karena barangnya
                  dipindahkan ke rak lewat transfer bin manual (LT01/LT10) dan melewati LB12.
                  Membatalkannya <b>tidak mengubah stok sama sekali</b>; hanya menutup pekerjaan
                  yang sebenarnya sudah selesai. Periksa dulu di LT22 bahwa barangnya memang sudah
                  naik rak.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="sap-grid">
                  <thead>
                    <tr>
                      <th className="w-8">
                        <input
                          type="checkbox"
                          aria-label="Pilih semua"
                          checked={picked.length === orphans.length && orphans.length > 0}
                          onChange={(e) =>
                            setPicked(e.target.checked ? orphans.map((o) => o.item_id) : [])
                          }
                        />
                      </th>
                      <th className="w-[130px]">TR</th>
                      <th className="w-[45px]">Ln</th>
                      <th className="w-[140px]">Material</th>
                      <th>Deskripsi</th>
                      <th className="w-[110px]">Batch</th>
                      <th className="w-[110px]">Bin Transit</th>
                      <th className="w-[90px] text-right">Terbuka</th>
                      <th className="w-[90px] text-right">Ada</th>
                      <th className="w-[90px] text-right">Kurang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orphans.map((o) => (
                      <tr key={o.item_id}>
                        <td className="text-center">
                          <input
                            type="checkbox"
                            aria-label={`Pilih ${o.tr_number} baris ${o.line_no}`}
                            checked={picked.includes(o.item_id)}
                            onChange={() =>
                              setPicked((p) =>
                                p.includes(o.item_id)
                                  ? p.filter((x) => x !== o.item_id)
                                  : [...p, o.item_id]
                              )
                            }
                          />
                        </td>
                        <td className="font-mono">
                          <Link href={`/lb12?tr=${o.tr_number}`} className="text-sap-blue hover:underline">
                            {o.tr_number}
                          </Link>
                        </td>
                        <td className="font-mono text-sap-muted">{o.line_no}</td>
                        <td className="font-mono">{o.material_code}</td>
                        <td className="truncate max-w-[220px]">{o.description}</td>
                        <td className="font-mono">{o.batch_number ?? '—'}</td>
                        <td className="font-mono">{o.bin_code}</td>
                        <td className="text-right font-mono tabular-nums">{o.open_qty}</td>
                        <td className="text-right font-mono tabular-nums">{o.available}</td>
                        <td className="text-right font-mono tabular-nums text-sap-errtext">
                          {o.shortage}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      )}

      <Grid
        columns={cols}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.id}
        maxHeight="calc(100vh - 360px)"
        onViewChange={setView}
        onRowClick={(r) => router.push(`/lb12?tr=${r.tr_number}`)}
      />
    </div>
  );
}
