'use client';

import { useCallback, useEffect, useState } from 'react';
import { Wallet, Search, Save, Plus, Trash2, Download } from 'lucide-react';
import {
  Panel,
  Field,
  CheckField,
  Input,
  Button,
  Toolbar,
  Grid,
  exportCsv,
  type Column,
} from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useExecuteKey } from '@/components/sap/keynav';
import { ConfirmDialog } from '@/components/sap/Confirm';
import { invalidateCostCenters } from '@/components/sap/hooks';
import { api, post, patch, del, qs } from '@/lib/client';
import { WILDCARD_HINT } from '@/lib/like';

interface Row {
  id: string;
  cost_center: string;
  description: string;
  department: string | null;
  is_active: boolean;
}

type Form = {
  cost_center: string;
  description: string;
  department: string;
  is_active: boolean;
};

const emptyForm: Form = { cost_center: '', description: '', department: '', is_active: true };

/**
 * KS01 — Maintain Cost Center.
 *
 * Cost center adalah tujuan pembebanan biaya untuk goods issue 201
 * (pemakaian internal). Penjualan memakai movement 601 dan tidak melalui
 * cost center.
 */
export default function Ks01Page() {
  const { setStatus } = useStatus();

  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [view, setView] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'CREATE' | 'CHANGE'>('CREATE');
  const [form, setForm] = useState<Form>({ ...emptyForm });
  const [toDelete, setToDelete] = useState<Row | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    const r = await api<Row[]>('/api/costcenters' + qs({ q }));
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRows(r.data ?? []);
    setStatus(r.message, (r.data?.length ?? 0) > 0 ? 'S' : 'W');
  }, [q, setStatus]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useExecuteKey(run);

  async function save() {
    if (!form.cost_center.trim()) return setStatus('Cost center is mandatory', 'E');
    if (!form.description.trim()) return setStatus('Description is mandatory', 'E');

    setBusy(true);
    const body = {
      cost_center: form.cost_center.trim().toUpperCase(),
      description: form.description.trim(),
      department: form.department.trim(),
      is_active: form.is_active,
    };
    const r =
      mode === 'CREATE'
        ? await post('/api/costcenters', body)
        : await patch(`/api/costcenters/${encodeURIComponent(body.cost_center)}`, body);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      invalidateCostCenters();
      setForm({ ...emptyForm });
      setMode('CREATE');
      run();
    }
  }

  async function remove(row: Row) {
    setToDelete(null);
    setBusy(true);
    const r = await del(`/api/costcenters/${encodeURIComponent(row.cost_center)}`);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      invalidateCostCenters();
      if (form.cost_center === row.cost_center) {
        setForm({ ...emptyForm });
        setMode('CREATE');
      }
      run();
    }
  }

  const cols: Column<Row>[] = [
    { key: 'cost_center', header: 'Cost Center', mono: true, width: '160px' },
    { key: 'description', header: 'Description', width: '300px' },
    { key: 'department', header: 'Department', mono: true, width: '150px' },
    {
      key: 'is_active',
      header: 'Aktif',
      align: 'center',
      width: '80px',
      exportValue: (r) => (r.is_active ? 'X' : ''),
      render: (r) =>
        r.is_active ? (
          <span className="text-sap-oktext">✓</span>
        ) : (
          <span className="sap-badge border-sap-warnborder bg-sap-warnbg text-sap-warntext">OFF</span>
        ),
    },
    {
      key: 'act',
      header: '',
      width: '60px',
      align: 'center',
      sortable: false,
      filterable: false,
      render: (r) => (
        <button
          type="button"
          title="Hapus cost center"
          onClick={(e) => {
            e.stopPropagation();
            setToDelete(r);
          }}
          className="text-sap-muted hover:text-sap-error p-1"
        >
          <Trash2 size={13} />
        </button>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
      <div className="space-y-3 xl:col-span-1">
        <Panel
          title={mode === 'CREATE' ? 'KS01 — Create Cost Center' : `KS02 — Change ${form.cost_center}`}
          icon={<Wallet size={13} className="text-sap-blue" />}
        >
          <div className="space-y-3">
            <Field
              label="Cost Center"
              required
              hint="2–20 karakter: A–Z, 0–9, titik, garis bawah, tanda hubung."
            >
              <Input
                className="uppercase"
                placeholder="CC-PROD-01"
                disabled={mode === 'CHANGE'}
                value={form.cost_center}
                onChange={(e) => setForm({ ...form, cost_center: e.target.value })}
              />
            </Field>

            <Field label="Description" required>
              <Input
                placeholder="Produksi — Line 1"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>

            <Field label="Department" hint="Pemilik anggaran, opsional.">
              <Input
                className="uppercase"
                placeholder="PRODUKSI"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </Field>

            <CheckField
              label="Aktif"
              checked={form.is_active}
              onChange={(v) => setForm({ ...form, is_active: v })}
              hint="Cost center nonaktif tidak bisa dipilih di MIGO, tapi dokumen lama tetap terbaca."
            />

            <div className="flex gap-1.5 pt-1">
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
      </div>

      <div className="xl:col-span-2 space-y-3">
        <Toolbar>
          <Input
            className="!w-[220px] uppercase"
            placeholder="Cari cost center / deskripsi"
            title={WILDCARD_HINT}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
          />
          <Button variant="primary" onClick={run} loading={loading}>
            <Search size={13} /> Execute (F8)
          </Button>
          <Button onClick={() => exportCsv('KS01_cost_centers.csv', cols, view)} disabled={view.length === 0}>
            <Download size={13} /> Export CSV
          </Button>
          <span className="ml-auto font-mono text-xxs text-sap-muted">
            <b className="text-sap-text">{rows.length}</b> cost center
          </span>
        </Toolbar>

        <Grid
          columns={cols}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.id}
          maxHeight="calc(100vh - 300px)"
          onViewChange={setView}
          onRowClick={(r) => {
            setForm({
              cost_center: r.cost_center,
              description: r.description,
              department: r.department ?? '',
              is_active: r.is_active,
            });
            setMode('CHANGE');
            setStatus(`Cost center ${r.cost_center} selected for change`, 'I');
          }}
        />
      </div>

      <ConfirmDialog
        open={!!toDelete}
        danger
        title="Hapus Cost Center"
        question={`Cost center ${toDelete?.cost_center ?? ''} akan dihapus. Lanjutkan?`}
        details={[
          { label: 'Cost Center', value: toDelete?.cost_center ?? '' },
          { label: 'Description', value: toDelete?.description ?? '' },
        ]}
        confirmLabel="Hapus"
        busy={busy}
        onConfirm={() => toDelete && remove(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
