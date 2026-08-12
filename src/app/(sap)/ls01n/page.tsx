'use client';

import { useCallback, useEffect, useState } from 'react';
import { Folder, Search, Save, Plus, Trash2, Lock, Unlock, Download, Wand2 } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, Badge, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { invalidateMasterData } from '@/components/sap/hooks';
import { api, post, patch, del, qs } from '@/lib/client';
import { ZONES as ZONE_DEFS } from '@/lib/zones';

interface Row {
  id: string;
  bin_code: string;
  zone_id: string;
  max_weight_kg: number;
  status: 'EMPTY' | 'OCCUPIED' | 'BLOCKED';
  is_interim: boolean;
}

const ZONES = ZONE_DEFS.map((z) => z.code);

const emptyForm = { bin_code: '', zone_id: 'GB-HDR', max_weight_kg: 1000 };

export default function Ls01nPage() {
  const { setStatus } = useStatus();
  const [q, setQ] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'CREATE' | 'CHANGE'>('CREATE');
  const [form, setForm] = useState({ ...emptyForm });

  // Mass generator (Aisle-Rack-Level)
  const [gen, setGen] = useState({
    prefix: 'GB',
    aisle: 'A',
    rackFrom: 1,
    rackTo: 5,
    levelFrom: 1,
    levelTo: 4,
    zone: 'GB-HDR',
  });

  const run = useCallback(async () => {
    setLoading(true);
    const r = await api<Row[]>('/api/bins' + qs({ q, zone: zoneFilter }));
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRows(r.data ?? []);
    setStatus(r.message, (r.data?.length ?? 0) > 0 ? 'S' : 'W');
  }, [q, zoneFilter, setStatus]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneFilter]);

  async function save() {
    if (!form.bin_code.trim()) return setStatus('Storage bin is mandatory', 'E');
    setBusy(true);
    const r =
      mode === 'CREATE'
        ? await post('/api/bins', form)
        : await patch(`/api/bins/${encodeURIComponent(form.bin_code)}`, form);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      invalidateMasterData();
      setForm({ ...emptyForm });
      setMode('CREATE');
      run();
    }
  }

  async function toggleBlock(row: Row) {
    setBusy(true);
    const r = await patch(`/api/bins/${encodeURIComponent(row.bin_code)}`, {
      status: row.status === 'BLOCKED' ? 'EMPTY' : 'BLOCKED',
    });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      invalidateMasterData();
      run();
    }
  }

  async function remove(code: string) {
    setBusy(true);
    const r = await del(`/api/bins/${encodeURIComponent(code)}`);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      invalidateMasterData();
      run();
    }
  }

  async function generate() {
    const list: string[] = [];
    for (let rk = gen.rackFrom; rk <= gen.rackTo; rk++) {
      for (let lv = gen.levelFrom; lv <= gen.levelTo; lv++) {
        const pfx = gen.prefix.trim().toUpperCase();
        list.push(
          `${pfx ? pfx + '-' : ''}${gen.aisle.toUpperCase()}-${String(rk).padStart(2, '0')}-${String(lv).padStart(2, '0')}-1`
        );
      }
    }
    if (list.length === 0) return setStatus('Range tidak valid', 'E');
    if (list.length > 500) return setStatus('Maksimum 500 bin per generate', 'E');

    setBusy(true);
    let created = 0;
    let failed = 0;
    for (const bin_code of list) {
      const r = await post('/api/bins', { bin_code, zone_id: gen.zone, max_weight_kg: 1000 });
      r.ok ? created++ : failed++;
    }
    setBusy(false);
    invalidateMasterData();
    setStatus(`Mass generate selesai: ${created} bin dibuat, ${failed} dilewati (sudah ada)`, created ? 'S' : 'W');
    run();
  }

  const cols: Column<Row>[] = [
    { key: 'bin_code', header: 'Storage Bin', mono: true, width: '160px' },
    { key: 'zone_id', header: 'Zone / Section', mono: true, width: '150px' },
    { key: 'status', header: 'Status', width: '115px', render: (r) => <Badge value={r.status} /> },
    { key: 'max_weight_kg', header: 'Max Weight (kg)', align: 'right', width: '130px' },
    {
      key: 'is_interim',
      header: 'Interim',
      align: 'center',
      width: '80px',
      render: (r) =>
        r.is_interim ? (
          <span className="sap-badge border-[#2b5480] bg-[#1c3450] text-[#9DC0FF]">GR/GI</span>
        ) : (
          <span className="text-sap-muted">—</span>
        ),
    },
    {
      key: 'act',
      header: '',
      width: '90px',
      align: 'center',
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            title={r.status === 'BLOCKED' ? 'Unblock (LS06)' : 'Block (LS06)'}
            onClick={(e) => {
              e.stopPropagation();
              toggleBlock(r);
            }}
            className="text-sap-muted hover:text-sap-blue p-1"
          >
            {r.status === 'BLOCKED' ? <Unlock size={13} /> : <Lock size={13} />}
          </button>
          <button
            type="button"
            title="Delete bin"
            onClick={(e) => {
              e.stopPropagation();
              remove(r.bin_code);
            }}
            className="text-sap-muted hover:text-sap-error p-1"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
      <div className="space-y-3 xl:col-span-1">
        <Panel
          title={mode === 'CREATE' ? 'LS01N — Create Storage Bin' : `LS02N — Change Bin ${form.bin_code}`}
          icon={<Folder size={13} className="text-sap-blue" />}
        >
          <div className="space-y-3">
            <Field label="Storage Bin" required hint="Format: prefix gudang + Aisle-Rack-Level, mis. GB-A-01-02-1">
              <Input
                className="uppercase"
                disabled={mode === 'CHANGE'}
                value={form.bin_code}
                onChange={(e) => setForm({ ...form, bin_code: e.target.value })}
              />
            </Field>
            <Field
              label="Zone / Storage Section"
              required
              hint={ZONE_DEFS.find((z) => z.code === form.zone_id)?.label}
            >
              <Input
                list="dl-zones"
                className="uppercase"
                value={form.zone_id}
                onChange={(e) => setForm({ ...form, zone_id: e.target.value })}
              />
            </Field>
            <Field label="Max Weight (kg)">
              <Input
                type="number"
                min={0}
                className="text-right"
                value={form.max_weight_kg}
                onChange={(e) => setForm({ ...form, max_weight_kg: Number(e.target.value) })}
              />
            </Field>
            <div className="flex gap-1.5">
              <Button variant="primary" onClick={save} loading={busy}>
                <Save size={13} /> {mode === 'CREATE' ? 'Create' : 'Save'}
              </Button>
              <Button
                onClick={() => {
                  setForm({ ...emptyForm });
                  setMode('CREATE');
                }}
              >
                <Plus size={13} /> New
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Mass Generate Bins" icon={<Wand2 size={13} className="text-sap-blue" />}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Prefix Gudang">
              <Input
                className="uppercase"
                placeholder="GB / GK"
                value={gen.prefix}
                onChange={(e) => setGen({ ...gen, prefix: e.target.value })}
              />
            </Field>
            <Field label="Aisle">
              <Input
                className="uppercase"
                value={gen.aisle}
                onChange={(e) => setGen({ ...gen, aisle: e.target.value })}
              />
            </Field>
            <Field label="Zone">
              <Input
                list="dl-zones"
                className="uppercase"
                value={gen.zone}
                onChange={(e) => setGen({ ...gen, zone: e.target.value })}
              />
            </Field>
            <Field label="Rack From">
              <Input
                type="number"
                min={1}
                className="text-right"
                value={gen.rackFrom}
                onChange={(e) => setGen({ ...gen, rackFrom: Number(e.target.value) })}
              />
            </Field>
            <Field label="Rack To">
              <Input
                type="number"
                min={1}
                className="text-right"
                value={gen.rackTo}
                onChange={(e) => setGen({ ...gen, rackTo: Number(e.target.value) })}
              />
            </Field>
            <Field label="Level From">
              <Input
                type="number"
                min={1}
                className="text-right"
                value={gen.levelFrom}
                onChange={(e) => setGen({ ...gen, levelFrom: Number(e.target.value) })}
              />
            </Field>
            <Field label="Level To">
              <Input
                type="number"
                min={1}
                className="text-right"
                value={gen.levelTo}
                onChange={(e) => setGen({ ...gen, levelTo: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={generate} loading={busy}>
              <Wand2 size={13} /> Generate
            </Button>
            <span className="text-xxs text-sap-muted font-mono">
              {Math.max(0, gen.rackTo - gen.rackFrom + 1) * Math.max(0, gen.levelTo - gen.levelFrom + 1)} bin
            </span>
          </div>
        </Panel>
      </div>

      <div className="xl:col-span-2 space-y-3">
        <Toolbar>
          <Input
            className="!w-[200px] uppercase"
            placeholder="Cari bin"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
          />
          <Select className="!w-[170px]" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
            <option value="">All zones</option>
            {[...new Set([...ZONES, ...rows.map((r) => r.zone_id)])].sort().map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
          <Button variant="primary" onClick={run} loading={loading}>
            <Search size={13} /> Search
          </Button>
          <Button onClick={() => exportCsv('storage_bins.csv', cols, rows)} disabled={rows.length === 0}>
            <Download size={13} /> Export
          </Button>
        </Toolbar>

        <Grid
          columns={cols}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.id}
          maxHeight="calc(100vh - 300px)"
          onRowClick={(r) => {
            setForm({ bin_code: r.bin_code, zone_id: r.zone_id, max_weight_kg: r.max_weight_kg });
            setMode('CHANGE');
            setStatus(`Storage bin ${r.bin_code} selected for change`, 'I');
          }}
        />
      </div>

      <datalist id="dl-zones">
        {[...new Set([...ZONES, ...rows.map((r) => r.zone_id)])].sort().map((z) => (
          <option key={z} value={z}>
            {ZONE_DEFS.find((d) => d.code === z)?.label ?? ''}
          </option>
        ))}
      </datalist>
    </div>
  );
}
