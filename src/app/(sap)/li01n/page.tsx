'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ScanBarcode, Snowflake, RefreshCw, Trash2, ArrowRight, CheckSquare, Square, Search } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, Badge, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData } from '@/components/sap/hooks';
import { api, post, del, fmtDate, fmtDateTime } from '@/lib/client';

interface DocRow {
  id: string;
  doc_number: string;
  scope_type: string;
  scope_value: string;
  bin_count: number;
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

  const [scopeType, setScopeType] = useState<'BIN_LIST' | 'ZONE' | 'ALL'>('ZONE');
  const [zone, setZone] = useState('');
  const [binFilter, setBinFilter] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
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

  const zones = useMemo(
    () => [...new Set(bins.filter((b) => !b.is_interim).map((b) => b.zone_id))].sort(),
    [bins]
  );

  const selectableBins = useMemo(
    () =>
      bins
        .filter((b) => !b.is_interim)
        .filter((b) => (binFilter ? b.bin_code.toUpperCase().includes(binFilter.toUpperCase()) : true))
        .slice(0, 400),
    [bins, binFilter]
  );

  const pickedList = Object.keys(picked).filter((k) => picked[k]);

  async function freeze() {
    const body: Record<string, unknown> = { scope_type: scopeType, planned_date: plannedDate };
    if (scopeType === 'ZONE') {
      if (!zone) return setStatus('Pilih zona terlebih dahulu', 'E');
      body.zone = zone;
    } else if (scopeType === 'BIN_LIST') {
      if (pickedList.length === 0) return setStatus('Pilih minimal satu storage bin', 'E');
      body.bins = pickedList;
    }

    setBusy(true);
    const r = await post('/api/physinv', body);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setPicked({});
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
    { key: 'doc_number', header: 'PI Document', mono: true, width: '125px' },
    { key: 'scope_type', header: 'Scope', mono: true, width: '95px' },
    { key: 'scope_value', header: 'Scope Detail', width: '220px' },
    { key: 'bin_count', header: 'Bins', align: 'right', width: '65px' },
    { key: 'status', header: 'Status', width: '105px', render: (r) => <Badge value={r.status} /> },
    { key: 'item_count', header: 'Lines', align: 'right', width: '65px' },
    { key: 'book_total', header: 'Book Qty', align: 'right', width: '95px' },
    {
      key: 'counted_total',
      header: 'Counted',
      align: 'right',
      width: '90px',
      render: (r) => (r.status === 'FROZEN' ? <span className="text-sap-muted">—</span> : r.counted_total),
    },
    {
      key: 'diff_total',
      header: 'Difference',
      align: 'right',
      width: '95px',
      render: (r) =>
        r.status === 'FROZEN' ? (
          <span className="text-sap-muted">—</span>
        ) : (
          <span className={r.diff_total > 0 ? 'text-sap-oktext' : r.diff_total < 0 ? 'text-sap-errtext' : ''}>
            {r.diff_total > 0 ? '+' : ''}
            {r.diff_total}
          </span>
        ),
    },
    { key: 'planned_date', header: 'Planned', mono: true, width: '95px', render: (r) => fmtDate(r.planned_date) },
    { key: 'created_by', header: 'Created By', mono: true, width: '105px' },
    { key: 'created_at', header: 'Created On', mono: true, width: '145px', render: (r) => fmtDateTime(r.created_at) },
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
              title="Cancel document & release bins"
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
      <Panel title="LI01N — Create Physical Inventory Document (Multi-Bin)" icon={<ScanBarcode size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Field label="Scope" required>
            <Select value={scopeType} onChange={(e) => setScopeType(e.target.value as typeof scopeType)}>
              <option value="ZONE">ZONE — semua bin dalam satu zona</option>
              <option value="BIN_LIST">BIN LIST — pilih bin manual</option>
              <option value="ALL">ALL — seluruh gudang</option>
            </Select>
          </Field>

          {scopeType === 'ZONE' && (
            <Field label="Zone / Storage Section" required>
              <Select value={zone} onChange={(e) => setZone(e.target.value)}>
                <option value="">— pilih zona —</option>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Planned Count Date">
            <Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
          </Field>

          <div>
            <Button variant="primary" onClick={freeze} loading={busy}>
              <Snowflake size={13} /> Freeze &amp; Create Document
            </Button>
          </div>
        </div>

        <p className="mt-3 text-xxs text-sap-muted leading-relaxed">
          Satu dokumen mencakup <b>banyak bin dan banyak baris</b>. Semua bin dalam cakupan di-set{' '}
          <b>BLOCKED</b> selama counting, snapshot stok sistem direkam sebagai book quantity, dan seluruh
          selisih nanti diposting sekaligus di LI11N. Bin interim (GR/GI) tidak pernah ikut dihitung.
        </p>
      </Panel>

      {scopeType === 'BIN_LIST' && (
        <Panel title={`Pilih Storage Bin (${pickedList.length} dipilih)`} bodyClassName="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Input
              className="!w-[220px] uppercase"
              placeholder="Filter bin, mis. A-01"
              value={binFilter}
              onChange={(e) => setBinFilter(e.target.value)}
            />
            <Button
              onClick={() =>
                setPicked((s) => {
                  const n = { ...s };
                  selectableBins.forEach((b) => (n[b.bin_code] = true));
                  return n;
                })
              }
            >
              <CheckSquare size={13} /> Pilih semua hasil filter
            </Button>
            <Button onClick={() => setPicked({})}>
              <Square size={13} /> Kosongkan
            </Button>
            <span className="ml-auto text-xxs text-sap-muted">
              <Search size={11} className="inline mr-1" />
              {selectableBins.length} bin ditampilkan
            </span>
          </div>
          <div className="max-h-[260px] overflow-auto border border-sap-border rounded-[2px] p-2 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-1">
            {selectableBins.map((b) => {
              const on = !!picked[b.bin_code];
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setPicked((s) => ({ ...s, [b.bin_code]: !on }))}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-[2px] border text-2xs font-mono text-left
                    ${on ? 'border-sap-blue bg-sap-blue/15 text-sap-text' : 'border-sap-border bg-sap-panelalt text-sap-muted hover:border-sap-blue/50'}`}
                >
                  {on ? <CheckSquare size={12} className="text-sap-blue shrink-0" /> : <Square size={12} className="shrink-0" />}
                  <span className="truncate">{b.bin_code}</span>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      <Toolbar>
        <Button onClick={load} loading={loading}>
          <RefreshCw size={13} /> Refresh
        </Button>
        <span className="ml-auto text-xxs text-sap-muted">
          Klik tanda panah untuk melanjutkan ke LI11N (input hasil counting)
        </span>
      </Toolbar>

      <Grid columns={cols} rows={docs} loading={loading} rowKey={(r) => r.id} maxHeight="calc(100vh - 400px)" />
    </div>
  );
}
