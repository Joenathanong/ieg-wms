'use client';

import { useCallback, useEffect, useState } from 'react';
import { SquareStack, Search, Download } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, Badge, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData } from '@/components/sap/hooks';
import { api, qs } from '@/lib/client';

interface Row {
  bin_code: string;
  zone_id: string;
  status: 'EMPTY' | 'OCCUPIED' | 'BLOCKED';
  max_weight_kg: number;
  current_qty: number;
}

export default function Ls04Page() {
  const { setStatus } = useStatus();
  const { bins } = useMasterData();

  const [zone, setZone] = useState('');
  const [bin, setBin] = useState('');
  const [includeBlocked, setIncludeBlocked] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    const r = await api<{ rows: Row[] }>(
      '/api/reports/ls04' + qs({ zone, bin, includeBlocked: includeBlocked ? '1' : '' })
    );
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRows(r.data?.rows ?? []);
    setStatus(r.message, (r.data?.rows.length ?? 0) > 0 ? 'S' : 'W');
  }, [zone, bin, includeBlocked, setStatus]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeBlocked]);

  const zones = [...new Set(bins.map((b) => b.zone_id))].sort();

  const cols: Column<Row>[] = [
    { key: 'bin_code', header: 'Storage Bin', mono: true, width: '160px' },
    { key: 'zone_id', header: 'Zone / Section', mono: true, width: '150px' },
    { key: 'status', header: 'Status', width: '120px', render: (r) => <Badge value={r.status} /> },
    { key: 'max_weight_kg', header: 'Max Weight (kg)', align: 'right', width: '140px' },
    { key: 'current_qty', header: 'Current Qty', align: 'right', width: '110px' },
  ];

  return (
    <div className="space-y-3">
      <Panel title="LS04 — Display Empty Storage Bins" icon={<SquareStack size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
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
          <Field label="Storage Bin (pattern)">
            <Input
              className="uppercase"
              placeholder="mis. A-01"
              value={bin}
              onChange={(e) => setBin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
          </Field>
          <label className="flex items-center gap-2 text-2xs text-sap-muted cursor-pointer h-[27px]">
            <input
              type="checkbox"
              className="accent-[#367BF5]"
              checked={includeBlocked}
              onChange={(e) => setIncludeBlocked(e.target.checked)}
            />
            Sertakan bin berstatus BLOCKED
          </label>
        </div>
      </Panel>

      <Toolbar>
        <Button variant="primary" onClick={run} loading={loading}>
          <Search size={13} /> Execute (F8)
        </Button>
        <Button onClick={() => exportCsv('LS04_empty_bins.csv', cols, rows)} disabled={rows.length === 0}>
          <Download size={13} /> Export CSV
        </Button>
        <span className="ml-auto font-mono text-xxs text-sap-muted">
          Kapasitas kosong: <b className="text-sap-text">{rows.length}</b> bin
        </span>
      </Toolbar>

      <Grid columns={cols} rows={rows} loading={loading} rowKey={(r) => r.bin_code} maxHeight="calc(100vh - 300px)" />
    </div>
  );
}
