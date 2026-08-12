'use client';

import { useCallback, useEffect, useState } from 'react';
import { Grid3x3, Search, Download, Eraser, CalendarClock } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, Badge, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData } from '@/components/sap/hooks';
import { api, qs, fmtDate } from '@/lib/client';

interface Row {
  bin_code: string;
  zone_id: string;
  bin_status: 'EMPTY' | 'OCCUPIED' | 'BLOCKED';
  material_code: string;
  description: string;
  uom: string;
  batch_number: string;
  mfg_date: string | null;
  exp_date: string | null;
  gr_date: string | null;
  days_to_exp: number | null;
  expiry_flag: '' | 'EXPIRED' | 'CRITICAL';
  qty: number;
}

export default function Lx02Page() {
  const { setStatus } = useStatus();
  const { bins } = useMasterData();

  const [material, setMaterial] = useState('');
  const [bin, setBin] = useState('');
  const [zone, setZone] = useState('');
  const [batch, setBatch] = useState('');
  const [expBefore, setExpBefore] = useState('');
  const [sort, setSort] = useState('bin');

  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<Row[]>([]);
  const [totalQty, setTotalQty] = useState(0);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    const r = await api<{ rows: Row[]; total_qty: number }>(
      '/api/reports/lx02' + qs({ material, bin, zone, batch, expBefore, sort })
    );
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRows(r.data?.rows ?? []);
    setTotalQty(r.data?.total_qty ?? 0);
    setStatus(r.message, (r.data?.rows.length ?? 0) > 0 ? 'S' : 'W');
  }, [material, bin, zone, batch, expBefore, sort, setStatus]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  const zones = [...new Set(bins.map((b) => b.zone_id))].sort();

  const cols: Column<Row>[] = [
    { key: 'bin_code', header: 'Storage Bin', mono: true, width: '130px' },
    { key: 'zone_id', header: 'Zone', mono: true, width: '110px' },
    {
      key: 'bin_status',
      header: 'Bin Status',
      width: '105px',
      exportValue: (r) => r.bin_status,
      render: (r) => <Badge value={r.bin_status} />,
    },
    { key: 'material_code', header: 'Material', mono: true, width: '140px' },
    { key: 'description', header: 'Description', width: '230px' },
    { key: 'batch_number', header: 'Batch', mono: true, width: '130px' },
    {
      key: 'mfg_date',
      header: 'Mfg. Date',
      mono: true,
      width: '100px',
      value: (r) => (r.mfg_date ? new Date(r.mfg_date) : null),
      exportValue: (r) => fmtDate(r.mfg_date),
      render: (r) => fmtDate(r.mfg_date),
    },
    {
      key: 'exp_date',
      header: 'Exp. Date',
      mono: true,
      width: '100px',
      value: (r) => (r.exp_date ? new Date(r.exp_date) : null),
      exportValue: (r) => fmtDate(r.exp_date),
      render: (r) => fmtDate(r.exp_date),
    },
    {
      key: 'gr_date',
      header: 'GR Date',
      mono: true,
      width: '100px',
      value: (r) => (r.gr_date ? new Date(r.gr_date) : null),
      exportValue: (r) => fmtDate(r.gr_date),
      render: (r) => fmtDate(r.gr_date) || <span className="text-sap-muted">—</span>,
    },
    {
      key: 'days_to_exp',
      header: 'Shelf Life',
      align: 'right',
      width: '95px',
      render: (r) => {
        if (r.days_to_exp === null) return <span className="text-sap-muted">—</span>;
        const cls =
          r.expiry_flag === 'EXPIRED'
            ? 'text-sap-errtext font-semibold'
            : r.expiry_flag === 'CRITICAL'
              ? 'text-sap-warntext font-semibold'
              : 'text-sap-muted';
        return <span className={cls}>{r.days_to_exp} d</span>;
      },
    },
    {
      key: 'expiry_flag',
      header: 'Alert',
      width: '95px',
      exportValue: (r) => (r.expiry_flag === 'CRITICAL' ? '<= 30 D' : r.expiry_flag),
      render: (r) =>
        r.expiry_flag === 'EXPIRED' ? (
          <span className="sap-badge border-sap-errborder bg-sap-errbg text-sap-errtext">EXPIRED</span>
        ) : r.expiry_flag === 'CRITICAL' ? (
          <span className="sap-badge border-sap-warnborder bg-sap-warnbg text-sap-warntext">≤ 30 D</span>
        ) : (
          <span className="text-sap-muted">—</span>
        ),
    },
    { key: 'qty', header: 'Quantity', align: 'right', width: '95px' },
    { key: 'uom', header: 'UoM', mono: true, width: '58px' },
  ];

  return (
    <div className="space-y-3">
      <Panel title="LX02 — Stock per Storage Bin (WM Breakdown)" icon={<Grid3x3 size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Field label="Material">
            <Input className="uppercase" value={material} onChange={(e) => setMaterial(e.target.value)} />
          </Field>
          <Field label="Storage Bin">
            <Input className="uppercase" value={bin} onChange={(e) => setBin(e.target.value)} />
          </Field>
          <Field label="Zone / Storage Section">
            <Select value={zone} onChange={(e) => setZone(e.target.value)}>
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Batch">
            <Input className="uppercase" value={batch} onChange={(e) => setBatch(e.target.value)} />
          </Field>
          <Field label="Expiring Before" hint="FEFO / stok kadaluarsa">
            <Input type="date" value={expBefore} onChange={(e) => setExpBefore(e.target.value)} />
          </Field>
          <Field label="Sort By">
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="bin">Storage Bin</option>
              <option value="material">Material</option>
              <option value="qty">Quantity (desc)</option>
              <option value="exp">Expiration Date (FEFO)</option>
            </Select>
          </Field>
        </div>
      </Panel>

      <Toolbar>
        <Button variant="primary" onClick={run} loading={loading}>
          <Search size={13} /> Execute (F8)
        </Button>
        <Button
          onClick={() => {
            setMaterial('');
            setBin('');
            setZone('');
            setBatch('');
            setExpBefore('');
            setStatus('Selection criteria cleared', 'I');
          }}
        >
          <Eraser size={13} /> Clear
        </Button>
        <Button
          onClick={() => {
            const d = new Date();
            d.setDate(d.getDate() + 30);
            setExpBefore(d.toISOString().slice(0, 10));
            setSort('exp');
            setStatus('Filter: stok kadaluarsa dalam 30 hari', 'I');
          }}
        >
          <CalendarClock size={13} /> Expiring ≤ 30 days
        </Button>
        <Button onClick={() => exportCsv('LX02_bin_stock.csv', cols, view)} disabled={view.length === 0}>
          <Download size={13} /> Export CSV
        </Button>
        <span className="ml-auto font-mono text-xxs text-sap-muted">
          Total: <b className="text-sap-text">{totalQty.toLocaleString('de-DE')}</b> units
        </span>
      </Toolbar>

      <Grid
        columns={cols}
        rows={rows}
        loading={loading}
        rowKey={(r, i) => `${r.bin_code}-${r.material_code}-${r.batch_number}-${i}`}
        maxHeight="calc(100vh - 360px)"
        onViewChange={setView}
      />
    </div>
  );
}
