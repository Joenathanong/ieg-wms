'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Search, Save, Plus, Trash2, Download } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { invalidateMasterData } from '@/components/sap/hooks';
import { api, post, patch, del, qs } from '@/lib/client';

interface Row {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  is_batch_managed: boolean;
  min_safety_stock: number;
}

const emptyForm = {
  material_code: '',
  description: '',
  uom: 'PC',
  is_batch_managed: true,
  min_safety_stock: 0,
};

export default function Mm01Page() {
  const { setStatus } = useStatus();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'CREATE' | 'CHANGE'>('CREATE');
  const [form, setForm] = useState({ ...emptyForm });

  const run = useCallback(async () => {
    setLoading(true);
    const r = await api<Row[]>('/api/materials' + qs({ q }));
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRows(r.data ?? []);
    setStatus(r.message, (r.data?.length ?? 0) > 0 ? 'S' : 'W');
  }, [q, setStatus]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!form.material_code.trim()) return setStatus('Material number is mandatory', 'E');
    if (!form.description.trim()) return setStatus('Material description is mandatory', 'E');

    setBusy(true);
    const r =
      mode === 'CREATE'
        ? await post('/api/materials', form)
        : await patch(`/api/materials/${encodeURIComponent(form.material_code)}`, form);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      invalidateMasterData();
      setForm({ ...emptyForm });
      setMode('CREATE');
      run();
    }
  }

  async function remove(code: string) {
    setBusy(true);
    const r = await del(`/api/materials/${encodeURIComponent(code)}`);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      invalidateMasterData();
      run();
    }
  }

  const cols: Column<Row>[] = [
    { key: 'material_code', header: 'Material', mono: true, width: '160px' },
    { key: 'description', header: 'Material Description', width: '320px' },
    { key: 'uom', header: 'Base UoM', mono: true, width: '90px' },
    {
      key: 'is_batch_managed',
      header: 'Batch Mgmt',
      align: 'center',
      width: '100px',
      render: (r) => (
        <span className={r.is_batch_managed ? 'text-sap-blue font-semibold' : 'text-sap-muted'}>
          {r.is_batch_managed ? 'X' : '—'}
        </span>
      ),
    },
    { key: 'min_safety_stock', header: 'Safety Stock', align: 'right', width: '110px' },
    {
      key: 'act',
      header: '',
      width: '46px',
      align: 'center',
      render: (r) => (
        <button
          type="button"
          title="Delete material"
          onClick={(e) => {
            e.stopPropagation();
            remove(r.material_code);
          }}
          className="text-sap-muted hover:text-sap-error p-1"
        >
          <Trash2 size={13} />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {/* FORM */}
        <Panel
          title={mode === 'CREATE' ? 'MM01 — Create Material' : `MM02 — Change Material ${form.material_code}`}
          icon={<Boxes size={13} className="text-sap-blue" />}
          className="xl:col-span-1 h-fit"
        >
          <div className="space-y-3">
            <Field label="Material Number" required>
              <Input
                className="uppercase"
                disabled={mode === 'CHANGE'}
                value={form.material_code}
                onChange={(e) => setForm({ ...form, material_code: e.target.value })}
              />
            </Field>
            <Field label="Material Description" required>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Base Unit of Measure">
                <Select value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })}>
                  {['PC', 'BOX', 'CTN', 'PAL', 'KG', 'G', 'L', 'ML', 'M', 'ROL', 'SET'].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Minimum Safety Stock">
                <Input
                  type="number"
                  min={0}
                  className="text-right"
                  value={form.min_safety_stock}
                  onChange={(e) => setForm({ ...form, min_safety_stock: Number(e.target.value) })}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-2xs text-sap-muted cursor-pointer">
              <input
                type="checkbox"
                className="accent-[#367BF5]"
                checked={form.is_batch_managed}
                onChange={(e) => setForm({ ...form, is_batch_managed: e.target.checked })}
              />
              Batch management aktif (wajib input nomor batch saat posting)
            </label>

            <div className="flex gap-1.5 pt-1">
              <Button variant="primary" onClick={save} loading={busy}>
                <Save size={13} /> {mode === 'CREATE' ? 'Create' : 'Save'}
              </Button>
              <Button
                onClick={() => {
                  setForm({ ...emptyForm });
                  setMode('CREATE');
                  setStatus('Ready for new material', 'I');
                }}
              >
                <Plus size={13} /> New
              </Button>
            </div>
          </div>
        </Panel>

        {/* LIST */}
        <div className="xl:col-span-2 space-y-3">
          <Toolbar>
            <Input
              className="!w-[240px] uppercase"
              placeholder="Cari material / deskripsi"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
            <Button variant="primary" onClick={run} loading={loading}>
              <Search size={13} /> Search
            </Button>
            <Button onClick={() => exportCsv('material_master.csv', cols, rows)} disabled={rows.length === 0}>
              <Download size={13} /> Export
            </Button>
            <span className="ml-auto text-xxs text-sap-muted">Klik baris untuk mengubah (MM02)</span>
          </Toolbar>

          <Grid
            columns={cols}
            rows={rows}
            loading={loading}
            rowKey={(r) => r.id}
            maxHeight="calc(100vh - 320px)"
            onRowClick={(r) => {
              setForm({
                material_code: r.material_code,
                description: r.description,
                uom: r.uom,
                is_batch_managed: r.is_batch_managed,
                min_safety_stock: r.min_safety_stock,
              });
              setMode('CHANGE');
              setStatus(`Material ${r.material_code} selected for change`, 'I');
            }}
          />
        </div>
      </div>
    </div>
  );
}
