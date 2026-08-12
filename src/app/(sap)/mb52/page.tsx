'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BarChart3, Search, Download, AlertTriangle } from 'lucide-react';
import { Panel, Field, Input, Button, Toolbar, Grid, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { api, qs } from '@/lib/client';
import { WILDCARD_HINT } from '@/lib/like';

interface Row {
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
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<Row[]>([]);
  const [totalQty, setTotalQty] = useState(0);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    const r = await api<{ rows: Row[]; total_qty: number }>(
      '/api/reports/mb52' + qs({ q, onlyBelowSafety: onlyBelow ? '1' : '' })
    );
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRows(r.data?.rows ?? []);
    setTotalQty(r.data?.total_qty ?? 0);
    setStatus(r.message, (r.data?.rows.length ?? 0) > 0 ? 'S' : 'W');
  }, [q, onlyBelow, setStatus]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyBelow]);

  const cols: Column<Row>[] = [
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

  return (
    <div className="space-y-3">
      <Panel title="MB52 — Display Warehouse Stock (Inventory Management Level)" icon={<BarChart3 size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Field label="Material / Description" hint={WILDCARD_HINT}>
            <Input
              value={q}
              placeholder="mis. FG-* atau 'sabun'"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
          </Field>
          <div>
            <label className="flex items-center gap-2 text-2xs text-sap-muted cursor-pointer h-[27px]">
              <input
                type="checkbox"
                className="accent-sap-blue"
                checked={onlyBelow}
                onChange={(e) => setOnlyBelow(e.target.checked)}
              />
              Hanya tampilkan di bawah safety stock
            </label>
          </div>
        </div>
      </Panel>

      <Toolbar>
        <Button variant="primary" onClick={run} loading={loading}>
          <Search size={13} /> Execute (F8)
        </Button>
        <Button onClick={() => exportCsv('MB52_global_stock.csv', cols, view)} disabled={view.length === 0}>
          <Download size={13} /> Export CSV
        </Button>
        <span className="ml-auto font-mono text-xxs text-sap-muted">
          Total stock: <b className="text-sap-text">{totalQty.toLocaleString('de-DE')}</b> units
        </span>
      </Toolbar>

      <Grid
        columns={cols}
        rows={rows}
        loading={loading}
        rowKey={(r) => r.material_code}
        maxHeight="calc(100vh - 330px)"
        onViewChange={setView}
        footer={<span>Kolom &quot;IM − WM&quot; harus 0. Nilai ≠ 0 menandakan inkonsistensi data.</span>}
      />
    </div>
  );
}
