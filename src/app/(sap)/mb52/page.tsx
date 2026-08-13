'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BarChart3, Search, Download, AlertTriangle, Layers } from 'lucide-react';
import {
  Panel,
  Field,
  ActionField,
  CheckField,
  Input,
  Select,
  Button,
  Toolbar,
  Grid,
  exportCsv,
  type Column,
} from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useExecuteKey } from '@/components/sap/keynav';
import { api, qs, fmtDate } from '@/lib/client';
import { WILDCARD_HINT } from '@/lib/like';

/** baris level material */
interface MatRow {
  material_code: string;
  description: string;
  uom: string;
  is_batch_managed: boolean;
  min_safety_stock: number;
  im_qty: number;
  wm_qty: number;
  variance: number;
  bin_count: number;
  quant_count: number;
  below_safety: boolean;
}

/** baris level batch */
interface BatchRow {
  material_code: string;
  description: string;
  uom: string;
  is_batch_managed: boolean;
  min_safety_stock: number;
  batch_number: string;
  mfg_date: string | null;
  exp_date: string | null;
  gr_date: string | null;
  days_to_exp: number | null;
  expiry_flag: '' | 'EXPIRED' | 'CRITICAL';
  qty: number;
  bin_count: number;
  bins: { bin_code: string; qty: number }[];
  bin_list: string;
  material_total: number;
}

type Level = 'MATERIAL' | 'BATCH';

export default function Mb52Page() {
  return (
    <Suspense fallback={<div className="p-4 text-2xs text-sap-muted">Loading selection screen ...</div>}>
      <Mb52Inner />
    </Suspense>
  );
}

function Mb52Inner() {
  const { setStatus } = useStatus();
  const sp = useSearchParams();

  const [q, setQ] = useState('');
  const [onlyBelow, setOnlyBelow] = useState(sp.get('onlyBelowSafety') === '1');
  /** default: sampai level batch (gabungan seluruh storage bin) */
  const [level, setLevel] = useState<Level>('BATCH');

  const [matRows, setMatRows] = useState<MatRow[]>([]);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [matView, setMatView] = useState<MatRow[]>([]);
  const [batchView, setBatchView] = useState<BatchRow[]>([]);
  const [totalQty, setTotalQty] = useState(0);
  const [matCount, setMatCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    const r = await api<{ rows: MatRow[] | BatchRow[]; total_qty: number; material_count: number }>(
      '/api/reports/mb52' + qs({ q, onlyBelowSafety: onlyBelow ? '1' : '', level })
    );
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');

    if (level === 'BATCH') {
      setBatchRows((r.data?.rows as BatchRow[]) ?? []);
      setMatRows([]);
    } else {
      setMatRows((r.data?.rows as MatRow[]) ?? []);
      setBatchRows([]);
    }
    setTotalQty(r.data?.total_qty ?? 0);
    setMatCount(r.data?.material_count ?? 0);
    setStatus(r.message, (r.data?.rows.length ?? 0) > 0 ? 'S' : 'W');
  }, [q, onlyBelow, level, setStatus]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyBelow, level]);

  // Enter / F8 = Execute
  useExecuteKey(run);

  /* ---------------- kolom level MATERIAL ---------------- */
  const matCols: Column<MatRow>[] = [
    { key: 'material_code', header: 'Material', mono: true, width: '150px' },
    { key: 'description', header: 'Material Description', width: '280px' },
    {
      key: 'im_qty',
      header: 'Unrestricted (IM)',
      align: 'right',
      width: '120px',
      render: (r) => (
        <span className={r.below_safety ? 'text-sap-warntext font-semibold' : ''}>
          {r.im_qty.toLocaleString('de-DE')}
        </span>
      ),
    },
    { key: 'uom', header: 'UoM', mono: true, width: '60px' },
    { key: 'wm_qty', header: 'Total in Bins (WM)', align: 'right', width: '130px' },
    {
      key: 'variance',
      header: 'IM − WM',
      align: 'right',
      width: '85px',
      render: (r) => (
        <span className={r.variance !== 0 ? 'text-sap-errtext font-semibold' : 'text-sap-muted'}>{r.variance}</span>
      ),
    },
    { key: 'bin_count', header: 'Bins', align: 'right', width: '60px' },
    { key: 'quant_count', header: 'Quants', align: 'right', width: '70px' },
    { key: 'min_safety_stock', header: 'Safety Stock', align: 'right', width: '100px' },
    {
      key: 'is_batch_managed',
      header: 'Batch',
      align: 'center',
      width: '65px',
      exportValue: (r) => (r.is_batch_managed ? 'X' : ''),
      render: (r) => (
        <span className={r.is_batch_managed ? 'text-sap-blue' : 'text-sap-muted'}>
          {r.is_batch_managed ? 'X' : '—'}
        </span>
      ),
    },
    {
      key: 'below_safety',
      header: 'Status',
      width: '110px',
      value: (r) => (r.below_safety ? 'LOW STOCK' : 'OK'),
      exportValue: (r) => (r.below_safety ? 'LOW STOCK' : 'OK'),
      render: (r) =>
        r.below_safety ? (
          <span className="sap-badge border-sap-warnborder bg-sap-warnbg text-sap-warntext gap-1">
            <AlertTriangle size={10} /> LOW STOCK
          </span>
        ) : (
          <span className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext">OK</span>
        ),
    },
  ];

  /* ---------------- kolom level BATCH ---------------- */
  const batchCols: Column<BatchRow>[] = [
    { key: 'material_code', header: 'Material', mono: true, width: '150px' },
    { key: 'description', header: 'Material Description', width: '250px' },
    {
      key: 'batch_number',
      header: 'Batch',
      mono: true,
      width: '140px',
      render: (r) => r.batch_number || <span className="text-sap-muted">(tanpa batch)</span>,
    },
    {
      key: 'qty',
      header: 'Qty Batch',
      align: 'right',
      width: '110px',
      render: (r) => r.qty.toLocaleString('de-DE'),
    },
    { key: 'uom', header: 'UoM', mono: true, width: '60px' },
    { key: 'bin_count', header: 'Jml Bin', align: 'right', width: '75px' },
    {
      key: 'bin_list',
      header: 'Storage Bin (gabungan)',
      mono: true,
      width: '260px',
      render: (r) =>
        r.bin_list ? (
          <span className="text-xxs">{r.bin_list}</span>
        ) : (
          <span className="text-sap-muted">—</span>
        ),
    },
    {
      key: 'mfg_date',
      header: 'Mfg. Date',
      mono: true,
      width: '100px',
      value: (r) => (r.mfg_date ? new Date(r.mfg_date) : null),
      exportValue: (r) => fmtDate(r.mfg_date),
      render: (r) => fmtDate(r.mfg_date) || <span className="text-sap-muted">—</span>,
    },
    {
      key: 'exp_date',
      header: 'Exp. Date',
      mono: true,
      width: '100px',
      value: (r) => (r.exp_date ? new Date(r.exp_date) : null),
      exportValue: (r) => fmtDate(r.exp_date),
      render: (r) => fmtDate(r.exp_date) || <span className="text-sap-muted">—</span>,
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
    {
      key: 'material_total',
      header: 'Total Material (IM)',
      align: 'right',
      width: '140px',
      render: (r) => <span className="text-sap-muted">{r.material_total.toLocaleString('de-DE')}</span>,
    },
  ];

  const isBatch = level === 'BATCH';

  return (
    <div className="space-y-3">
      <Panel
        title={`MB52 — Stock Overview (${isBatch ? 'level Material + Batch' : 'level Material'})`}
        icon={<BarChart3 size={13} className="text-sap-blue" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
          <Field label="Material / Description" hint={WILDCARD_HINT}>
            <Input
              value={q}
              placeholder="mis. FG-* atau 'sabun'"
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>

          <Field label="Level Tampilan" hint="batch = gabungan seluruh storage bin">
            <Select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
              <option value="BATCH">Material + Batch (gabungan semua bin)</option>
              <option value="MATERIAL">Material saja — ringkas (IM vs WM)</option>
            </Select>
          </Field>

          <CheckField
            label="Hanya di bawah safety stock"
            checked={onlyBelow}
            onChange={setOnlyBelow}
          />

          <ActionField>
            <Button variant="primary" onClick={run} loading={loading}>
              <Search size={13} /> Execute (F8)
            </Button>
          </ActionField>
        </div>
      </Panel>

      <Toolbar>
        <Button variant="primary" onClick={run} loading={loading}>
          <Search size={13} /> Execute (F8)
        </Button>
        <Button
          onClick={() =>
            isBatch
              ? exportCsv('MB52_stock_per_batch.csv', batchCols, batchView)
              : exportCsv('MB52_global_stock.csv', matCols, matView)
          }
          disabled={(isBatch ? batchView.length : matView.length) === 0}
        >
          <Download size={13} /> Export CSV
        </Button>
        <span className="ml-auto font-mono text-xxs text-sap-muted flex items-center gap-1.5">
          {isBatch && <Layers size={12} className="text-sap-blue" />}
          {isBatch ? `${matCount} material · ` : ''}
          Total: <b className="text-sap-text">{totalQty.toLocaleString('de-DE')}</b> units
        </span>
      </Toolbar>

      {isBatch ? (
        <Grid
          columns={batchCols}
          rows={batchRows}
          loading={loading}
          rowKey={(r, i) => `${r.material_code}-${r.batch_number}-${i}`}
          maxHeight="calc(100vh - 330px)"
          onViewChange={setBatchView}
          footer={<span>Qty batch = level WM (per bin dijumlahkan). Stok tanpa batch tampil sebagai (tanpa batch).</span>}
        />
      ) : (
        <Grid
          columns={matCols}
          rows={matRows}
          loading={loading}
          rowKey={(r) => r.material_code}
          maxHeight="calc(100vh - 330px)"
          onViewChange={setMatView}
          footer={<span>Kolom &quot;IM − WM&quot; harus 0. Nilai ≠ 0 menandakan inkonsistensi data.</span>}
        />
      )}
    </div>
  );
}
