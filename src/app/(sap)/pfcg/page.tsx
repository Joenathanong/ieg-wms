'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Save, Plus, Trash2, RefreshCw, CheckSquare, Square, Smartphone } from 'lucide-react';
import { Panel, Field, Input, Button, Toolbar, Grid, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { api, post, patch, del } from '@/lib/client';
import { RESTRICTABLE_TCODES, type TCodeGroup } from '@/lib/tcodes';

interface RoleRow {
  id: string;
  role_name: string;
  description: string;
  tcodes: string[];
  user_count: number;
  updated_at: string;
}

const GROUP_LABEL: Record<TCodeGroup, string> = {
  TRANSACTION: 'Transactions (IM)',
  WAREHOUSE: 'Warehouse (WM)',
  REPORT: 'Reports',
  MASTER: 'Master Data',
  PDT: 'PDT Terminal (ZRF)',
  SYSTEM: 'System',
};

const GROUP_ORDER: TCodeGroup[] = ['TRANSACTION', 'WAREHOUSE', 'REPORT', 'MASTER', 'PDT', 'SYSTEM'];

const emptyForm = { id: '', role_name: '', description: '' };

export default function PfcgPage() {
  const { setStatus } = useStatus();
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'CREATE' | 'CHANGE'>('CREATE');
  const [form, setForm] = useState({ ...emptyForm });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<TCodeGroup, typeof RESTRICTABLE_TCODES>();
    for (const g of GROUP_ORDER) {
      const items = RESTRICTABLE_TCODES.filter(
        (t) => t.group === g && !['MM02', 'LS02N', 'LS06'].includes(t.code)
      );
      if (items.length) map.set(g, items);
    }
    return map;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<RoleRow[]>('/api/roles');
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRows(r.data ?? []);
  }, [setStatus]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(code: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  }

  function toggleGroup(codes: string[]) {
    setSelected((s) => {
      const n = new Set(s);
      const allOn = codes.every((c) => n.has(c));
      codes.forEach((c) => (allOn ? n.delete(c) : n.add(c)));
      return n;
    });
  }

  async function save() {
    if (!form.role_name.trim()) return setStatus('Role name is mandatory', 'E');
    if (selected.size === 0) return setStatus('Pilih minimal satu T-Code untuk role ini', 'E');

    setBusy(true);
    const body = { role_name: form.role_name, description: form.description, tcodes: [...selected] };
    const r =
      mode === 'CREATE' ? await post('/api/roles', body) : await patch(`/api/roles/${form.id}`, body);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      if (mode === 'CREATE') reset();
      load();
    }
  }

  async function remove(row: RoleRow) {
    setBusy(true);
    const r = await del(`/api/roles/${row.id}`);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      if (form.id === row.id) reset();
      load();
    }
  }

  function reset() {
    setForm({ ...emptyForm });
    setSelected(new Set());
    setMode('CREATE');
  }

  const cols: Column<RoleRow>[] = [
    { key: 'role_name', header: 'Role', mono: true, width: '150px' },
    { key: 'description', header: 'Description', width: '220px' },
    {
      key: 'tcodes',
      header: 'T-Codes',
      render: (r) => (
        <span className="font-mono text-xxs text-sap-muted">
          {r.tcodes.length > 8 ? `${r.tcodes.slice(0, 8).join(' ')} +${r.tcodes.length - 8}` : r.tcodes.join(' ')}
        </span>
      ),
    },
    { key: 'user_count', header: 'Users', align: 'right', width: '70px' },
    {
      key: 'act',
      header: '',
      width: '46px',
      align: 'center',
      render: (r) => (
        <button
          type="button"
          title="Delete role"
          onClick={(e) => {
            e.stopPropagation();
            remove(r);
          }}
          className="text-sap-muted hover:text-sap-error p-1"
        >
          <Trash2 size={13} />
        </button>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <div className="space-y-3">
        <Panel
          title={mode === 'CREATE' ? 'PFCG — Create Role' : `PFCG — Change Role ${form.role_name}`}
          icon={<ShieldCheck size={13} className="text-sap-blue" />}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role Name" required hint="3–30 karakter: A–Z, 0–9, . _ -">
                <Input
                  className="uppercase"
                  placeholder="OPR-INBOUND"
                  disabled={mode === 'CHANGE'}
                  value={form.role_name}
                  onChange={(e) => setForm({ ...form, role_name: e.target.value })}
                />
              </Field>
              <Field label="Description">
                <Input
                  value={form.description}
                  placeholder="mis. Operator inbound gudang besar"
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
            </div>

            {[...grouped.entries()].map(([g, items]) => {
              const codes = items.map((t) => t.code);
              const allOn = codes.every((c) => selected.has(c));
              return (
                <div key={g} className="border border-sap-border rounded-[3px]">
                  <button
                    type="button"
                    onClick={() => toggleGroup(codes)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-sap-titlebar text-2xs
                               font-semibold uppercase tracking-wide text-sap-text rounded-t-[3px]"
                  >
                    {allOn ? (
                      <CheckSquare size={13} className="text-sap-blue" />
                    ) : (
                      <Square size={13} className="text-sap-muted" />
                    )}
                    {GROUP_LABEL[g]}
                    {g === 'PDT' && <Smartphone size={12} className="text-sap-blue" />}
                    <span className="ml-auto font-mono text-xxs text-sap-muted normal-case">
                      {codes.filter((c) => selected.has(c)).length}/{codes.length}
                    </span>
                  </button>
                  <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                    {items.map((t) => (
                      <label
                        key={t.code}
                        className="flex items-center gap-2 px-1.5 py-1 rounded-[2px] text-2xs cursor-pointer hover:bg-sap-hover"
                      >
                        <input
                          type="checkbox"
                          className="accent-sap-blue"
                          checked={selected.has(t.code)}
                          onChange={() => toggle(t.code)}
                        />
                        <span className="font-mono text-sap-blue w-[64px] shrink-0">{t.code}</span>
                        <span className="truncate text-sap-muted">{t.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="flex gap-1.5">
              <Button variant="primary" onClick={save} loading={busy}>
                <Save size={13} /> {mode === 'CREATE' ? 'Create Role' : 'Save'}
              </Button>
              <Button
                onClick={() => {
                  reset();
                  setStatus('Ready for new role', 'I');
                }}
              >
                <Plus size={13} /> New
              </Button>
            </div>

            <p className="text-xxs text-sap-muted/70 leading-relaxed border-t border-sap-border pt-2">
              Role di-assign ke user lewat <b className="text-sap-blue">SU01</b>. User <b>tanpa</b> role =
              akses penuh sesuai role dasar (ADMIN/OPERATOR/VIEWER). ADMIN tidak pernah dibatasi role.
              Untuk T-Code ZRF, user juga tetap butuh flag <b>Akses PDT</b> di SU01 dan toggle global di ZSET.
              Perubahan role berlaku pada <b>login berikutnya</b> user terkait.
            </p>
          </div>
        </Panel>
      </div>

      <div className="space-y-3">
        <Toolbar>
          <Button onClick={load} loading={loading}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <span className="ml-auto text-xxs text-sap-muted">Klik baris untuk mengubah role</span>
        </Toolbar>

        <Grid
          columns={cols}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.id}
          maxHeight="calc(100vh - 260px)"
          onRowClick={(r) => {
            setForm({ id: r.id, role_name: r.role_name, description: r.description });
            setSelected(new Set(r.tcodes));
            setMode('CHANGE');
            setStatus(`Role ${r.role_name} selected for change`, 'I');
          }}
        />
      </div>
    </div>
  );
}
