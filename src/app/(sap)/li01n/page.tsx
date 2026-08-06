'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ScanBarcode, Snowflake, RefreshCw, Trash2, ArrowRight } from 'lucide-react';
import { Panel, Field, Input, Button, Toolbar, Grid, Badge, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData } from '@/components/sap/hooks';
import { api, post, del, fmtDate, fmtDateTime } from '@/lib/client';

interface DocRow {
  id: string;
  doc_number: string;
  bin_code: string;
  status: 'CREATED' | 'FROZEN' | 'COUNTED' | 'POSTED';
  planned_date: string;
  counted_at: string | null;
  posted_at: string | null;
  created_by: string;
  created_at: string;
  item_count: number;
  book_total: number;
  counted_total: number;
  diff_total: number;
}

export default function Li01nPage() {
  const { setStatus } = useStatus();
  const { bins } = useMasterData();

  const [bin, setBin] = useState('');
  const [plannedDate, setPlannedDate] = useState(new Date().toISOString().slice(0, 10));
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<DocRow[]>('/api/physinv');
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setDocs(r.data ?? []);
  }, [setStatus]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function freeze() {
    if (!bin.trim()) return setStatus('Storage bin is mandatory', 'E');
    setBusy(true);
    const r = await post('/api/physinv', { bin_code: bin.trim().toUpperCase(), planned_date: plannedDate });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setBin('');
      load();
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    const r = await del(`/api/physinv/${id}`);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) load();
  }

  const cols: Column<DocRow>[] = [
    { key: 'doc_number', header: 'PI Document', mono: true, width: '130px' },
    { key: 'bin_code', header: 'Storage Bin', mono: true, width: '140px' },
    { key: 'status', header: 'Status', width: '110px', render: (r) => <Badge value={r.status} /> },
    { key: 'item_count', header: 'Items', align: 'right', width: '70px' },
    { key: 'book_total', header: 'Book Qty', align: 'right', width: '95px' },
    {
      key: 'counted_total',
      header: 'Counted',
      align: 'right',
      width: '95px',
      render: (r) => (r.status === 'FROZEN' ? <span className="text-sap-muted">—</span> : r.counted_total),
    },
    {
      key: 'diff_total',
      header: 'Difference',
      align: 'right',
      width: '100px',
      render: (r) =>
        r.status === 'FROZEN' ? (
          <span className="text-sap-muted">—</span>
        ) : (
          <span className={r.diff_total > 0 ? 'text-[#8FE0A4]' : r.diff_total < 0 ? 'text-[#FF9CA0]' : ''}>
            {r.diff_total > 0 ? '+' : ''}
            {r.diff_total}
          </span>
        ),
    },
    { key: 'planned_date', header: 'Planned', mono: true, width: '100px', render: (r) => fmtDate(r.planned_date) },
    { key: 'created_by', header: 'Created By', mono: true, width: '110px' },
    { key: 'created_at', header: 'Created On', mono: true, width: '150px', render: (r) => fmtDateTime(r.created_at) },
    {
      key: 'act',
      header: '',
      width: '86px',
      align: 'center',
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          {r.status !== 'POSTED' && (
            <Link href={`/li11n?doc=${r.id}`} title="Enter count (LI11N)" className="text-sap-muted hover:text-sap-blue p-1">
              <ArrowRight size={13} />
            </Link>
          )}
          {r.status !== 'POSTED' && (
            <button
              type="button"
              title="Cancel document & release bin"
              onClick={() => cancel(r.id)}
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
      <Panel title="LI01N — Create Physical Inventory Document (Freeze Bin)" icon={<ScanBarcode size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Field label="Storage Bin" required>
            <Input
              list="dl-bins"
              className="uppercase"
              value={bin}
              onChange={(e) => setBin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && freeze()}
            />
          </Field>
          <Field label="Planned Count Date">
            <Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
          </Field>
          <div>
            <Button variant="primary" onClick={freeze} loading={busy}>
              <Snowflake size={13} /> Freeze Bin &amp; Create Doc
            </Button>
          </div>
          <p className="text-xxs text-sap-muted leading-relaxed">
            Saat dokumen dibuat, bin di-set <b>BLOCKED</b> sehingga tidak ada pergerakan stok selama proses
            counting. Snapshot stok sistem (book quantity) direkam otomatis.
          </p>
        </div>
      </Panel>

      <Toolbar>
        <Button onClick={load} loading={loading}>
          <RefreshCw size={13} /> Refresh
        </Button>
        <span className="ml-auto text-xxs text-sap-muted">
          Klik tanda panah untuk melanjutkan ke LI11N (input hasil counting)
        </span>
      </Toolbar>

      <Grid columns={cols} rows={docs} loading={loading} rowKey={(r) => r.id} maxHeight="calc(100vh - 330px)" />

      <datalist id="dl-bins">
        {bins.map((b) => (
          <option key={b.id} value={b.bin_code}>
            {b.zone_id} · {b.status}
          </option>
        ))}
      </datalist>
    </div>
  );
}
