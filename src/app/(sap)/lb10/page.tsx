'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ListTodo, Search, RefreshCw, ArrowRight, Trash2, Download } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { api, del, qs, fmtDateTime } from '@/lib/client';

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
  PUTAWAY: 'border-[#2c5c3d] bg-[#1e3a29] text-[#8FE0A4]',
  PICK: 'border-[#7a5b1e] bg-[#3b2f14] text-[#F3C77B]',
  INTERNAL: 'border-[#2b5480] bg-[#1c3450] text-[#9DC0FF]',
};

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'border-[#2b5480] bg-[#1c3450] text-[#9DC0FF]',
  PARTIAL: 'border-[#7a5b1e] bg-[#3b2f14] text-[#F3C77B]',
  CLOSED: 'border-[#2c5c3d] bg-[#1e3a29] text-[#8FE0A4]',
  CANCELLED: 'border-[#3f4657] bg-[#2c313d] text-sap-muted',
};

export default function Lb10Page() {
  const { setStatus } = useStatus();
  const router = useRouter();

  const [status, setStatusFilter] = useState('');
  const [type, setType] = useState('');
  const [material, setMaterial] = useState('');
  const [tr, setTr] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

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

  async function cancel(row: Row) {
    const r = await del(`/api/tr/${row.id}`);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) run();
  }

  const cols: Column<Row>[] = [
    { key: 'tr_number', header: 'TR Number', mono: true, width: '130px' },
    {
      key: 'tr_type',
      header: 'Type',
      width: '105px',
      render: (r) => <span className={`sap-badge ${TYPE_STYLE[r.tr_type]}`}>{r.tr_type}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '105px',
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
        <span className={r.confirmed_qty >= r.total_qty ? 'text-[#8FE0A4]' : 'text-[#F3C77B]'}>
          {r.confirmed_qty.toLocaleString('de-DE')}
        </span>
      ),
    },
    {
      key: 'open_lines',
      header: 'Open / Lines',
      align: 'center',
      width: '110px',
      render: (r) => (
        <span className="font-mono">
          {r.open_lines} / {r.item_count}
        </span>
      ),
    },
    { key: 'ref_doc', header: 'Mat. Doc.', mono: true, width: '125px' },
    { key: 'created_by', header: 'Created By', mono: true, width: '110px' },
    { key: 'created_at', header: 'Created On', mono: true, width: '150px', render: (r) => fmtDateTime(r.created_at) },
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <Field label="TR Number">
            <Input className="uppercase" value={tr} onChange={(e) => setTr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
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
          <Field label="Material">
            <Input className="uppercase" value={material} onChange={(e) => setMaterial(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
          </Field>
          <div>
            <Button variant="primary" onClick={run} loading={loading}>
              <Search size={13} /> Execute (F8)
            </Button>
          </div>
        </div>
      </Panel>

      <Toolbar>
        <Button onClick={run} loading={loading}>
          <RefreshCw size={13} /> Refresh
        </Button>
        <Button onClick={() => exportCsv('LB10_transfer_requirements.csv', cols, rows)} disabled={rows.length === 0}>
          <Download size={13} /> Export CSV
        </Button>
        <span className="ml-auto text-xxs text-sap-muted">
          Klik baris untuk membuka LB12 dan menentukan rak
        </span>
      </Toolbar>

      <Grid
        columns={cols}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.id}
        maxHeight="calc(100vh - 330px)"
        onRowClick={(r) => router.push(`/lb12?tr=${r.tr_number}`)}
      />
    </div>
  );
}
