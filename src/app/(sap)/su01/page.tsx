'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users, Save, Plus, Trash2, RefreshCw, KeyRound, Lock, Unlock, Smartphone, ShieldCheck, ClipboardCheck } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, Badge, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { api, post, patch, del, fmtDateTime } from '@/lib/client';

interface AuthRoleLite {
  id: string;
  role_name: string;
  description: string;
  tcodes: string[];
}

interface Row {
  id: string;
  username: string;
  full_name: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  is_active: boolean;
  pdt_enabled: boolean;
  so_enabled: boolean;
  auth_role_id: string | null;
  auth_role: { role_name: string; tcodes: string[] } | null;
  last_login: string | null;
  created_at: string;
}

const emptyForm = {
  id: '',
  username: '',
  full_name: '',
  password: '',
  role: 'OPERATOR' as Row['role'],
  is_active: true,
  pdt_enabled: false,
  so_enabled: true,
  auth_role_id: '',
};

export default function Su01Page() {
  const { setStatus } = useStatus();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'CREATE' | 'CHANGE'>('CREATE');
  const [form, setForm] = useState({ ...emptyForm });
  const [roles, setRoles] = useState<AuthRoleLite[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, ar] = await Promise.all([api<Row[]>('/api/users'), api<AuthRoleLite[]>('/api/roles')]);
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRows(r.data ?? []);
    if (ar.ok) setRoles(ar.data ?? []);
  }, [setStatus]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (mode === 'CREATE') {
      if (!form.username.trim()) return setStatus('User name is mandatory', 'E');
      if (!form.full_name.trim()) return setStatus('Full name is mandatory', 'E');
      if (form.password.length < 6) return setStatus('Password must be at least 6 characters', 'E');
    }

    setBusy(true);
    const r =
      mode === 'CREATE'
        ? await post('/api/users', { ...form, auth_role_id: form.auth_role_id || null })
        : await patch(`/api/users/${form.id}`, {
            full_name: form.full_name,
            role: form.role,
            is_active: form.is_active,
            pdt_enabled: form.pdt_enabled,
            so_enabled: form.so_enabled,
            auth_role_id: form.auth_role_id || null,
            ...(form.password ? { password: form.password } : {}),
          });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setForm({ ...emptyForm });
      setMode('CREATE');
      load();
    }
  }

  async function toggleLock(row: Row) {
    setBusy(true);
    const r = await patch(`/api/users/${row.id}`, { is_active: !row.is_active });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) load();
  }

  async function remove(row: Row) {
    setBusy(true);
    const r = await del(`/api/users/${row.id}`);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) load();
  }

  const cols: Column<Row>[] = [
    { key: 'username', header: 'User Name', mono: true, width: '140px' },
    { key: 'full_name', header: 'Full Name', width: '230px' },
    { key: 'role', header: 'Role', width: '110px', render: (r) => <Badge value={r.role} /> },
    {
      key: 'auth_role',
      header: 'Role T-Code',
      width: '150px',
      value: (r) => r.auth_role?.role_name ?? 'FULL',
      exportValue: (r) => r.auth_role?.role_name ?? 'FULL',
      render: (r) =>
        r.auth_role ? (
          <span className="sap-badge border-sap-infoborder bg-sap-infobg text-sap-infotext gap-1">
            <ShieldCheck size={10} /> {r.auth_role.role_name}
          </span>
        ) : (
          <span className="text-sap-muted">FULL</span>
        ),
    },
    {
      key: 'is_active',
      header: 'Status',
      width: '110px',
      value: (r) => (r.is_active ? 'ACTIVE' : 'LOCKED'),
      exportValue: (r) => (r.is_active ? 'ACTIVE' : 'LOCKED'),
      render: (r) =>
        r.is_active ? (
          <span className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext">ACTIVE</span>
        ) : (
          <span className="sap-badge border-sap-errborder bg-sap-errbg text-sap-errtext">LOCKED</span>
        ),
    },
    {
      key: 'pdt_enabled',
      header: 'PDT',
      align: 'center',
      width: '80px',
      value: (r) => (r.pdt_enabled ? 'ON' : ''),
      exportValue: (r) => (r.pdt_enabled ? 'ON' : ''),
      render: (r) =>
        r.pdt_enabled ? (
          <span className="sap-badge border-sap-infoborder bg-sap-infobg text-sap-infotext gap-1">
            <Smartphone size={10} /> ON
          </span>
        ) : (
          <span className="text-sap-muted">—</span>
        ),
    },
    {
      key: 'so_enabled',
      header: 'Opname',
      align: 'center',
      width: '90px',
      value: (r) => (r.so_enabled ? 'ON' : ''),
      exportValue: (r) => (r.so_enabled ? 'ON' : ''),
      render: (r) =>
        r.so_enabled ? (
          <span className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext gap-1">
            <ClipboardCheck size={10} /> ON
          </span>
        ) : (
          <span className="text-sap-muted">—</span>
        ),
    },
    {
      key: 'last_login',
      header: 'Last Logon',
      mono: true,
      width: '150px',
      value: (r) => (r.last_login ? new Date(r.last_login) : null),
      exportValue: (r) => fmtDateTime(r.last_login),
      render: (r) => fmtDateTime(r.last_login) || '—',
    },
    {
      key: 'created_at',
      header: 'Created On',
      mono: true,
      width: '160px',
      value: (r) => new Date(r.created_at),
      exportValue: (r) => fmtDateTime(r.created_at),
      render: (r) => fmtDateTime(r.created_at),
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
            title={r.is_active ? 'Lock user' : 'Unlock user'}
            onClick={(e) => {
              e.stopPropagation();
              toggleLock(r);
            }}
            className="text-sap-muted hover:text-sap-blue p-1"
          >
            {r.is_active ? <Lock size={13} /> : <Unlock size={13} />}
          </button>
          <button
            type="button"
            title="Delete user"
            onClick={(e) => {
              e.stopPropagation();
              remove(r);
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
      <Panel
        title={mode === 'CREATE' ? 'SU01 — Create User' : `SU01 — Change User ${form.username}`}
        icon={<Users size={13} className="text-sap-blue" />}
        className="h-fit"
      >
        <div className="space-y-3">
          <Field label="User Name" required hint="3–20 karakter: A–Z, 0–9, . _ -">
            <Input
              className="uppercase"
              disabled={mode === 'CHANGE'}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label="Full Name" required>
            <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </Field>
          <Field
            label={mode === 'CREATE' ? 'Password' : 'New Password (kosongkan bila tidak diubah)'}
            required={mode === 'CREATE'}
          >
            <div className="relative">
              <KeyRound size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-sap-muted" />
              <Input
                type="password"
                className="pl-7"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
          </Field>
          <Field label="Role / Authorization">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Row['role'] })}>
              <option value="ADMIN">ADMIN — akses penuh + manajemen user</option>
              <option value="OPERATOR">OPERATOR — posting transaksi & master data</option>
              <option value="VIEWER">VIEWER — hanya laporan (display only)</option>
            </Select>
          </Field>

          <Field
            label="Role T-Code (PFCG)"
            hint={
              form.role === 'ADMIN'
                ? 'ADMIN tidak pernah dibatasi role T-Code'
                : 'Kosong = semua T-Code sesuai role dasar. Kelola daftar role di PFCG.'
            }
          >
            <Select
              disabled={form.role === 'ADMIN'}
              value={form.auth_role_id}
              onChange={(e) => setForm({ ...form, auth_role_id: e.target.value })}
            >
              <option value="">(tanpa pembatasan T-Code)</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.role_name} — {r.tcodes.length} T-Code{r.description ? ` · ${r.description}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-2xs text-sap-muted cursor-pointer">
            <input
              type="checkbox"
              className="accent-sap-blue"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            User aktif (dapat login)
          </label>

          <label className="flex items-center gap-2 text-2xs text-sap-muted cursor-pointer">
            <input
              type="checkbox"
              className="accent-sap-blue"
              checked={form.pdt_enabled}
              onChange={(e) => setForm({ ...form, pdt_enabled: e.target.checked })}
            />
            <Smartphone size={12} className="text-sap-blue" />
            Akses terminal PDT (T-Code ZRF)
          </label>

          <label className="flex items-center gap-2 text-2xs text-sap-muted cursor-pointer">
            <input
              type="checkbox"
              className="accent-sap-blue"
              checked={form.so_enabled}
              onChange={(e) => setForm({ ...form, so_enabled: e.target.checked })}
            />
            <ClipboardCheck size={12} className="text-sap-oktext" />
            Boleh ditugaskan stock opname (ZSO01)
          </label>

          {form.so_enabled && !form.pdt_enabled && (
            <p className="text-xxs text-sap-warntext leading-relaxed pl-6">
              User ini boleh ditugaskan opname tetapi belum punya akses PDT, sehingga tidak bisa
              membuka ZRF05 untuk menghitung. Aktifkan akses PDT juga, atau matikan penugasan
              opname — kalau tidak, raknya akan menggantung tanpa ada yang bisa mengerjakan.
            </p>
          )}

          <div className="flex gap-1.5 pt-1">
            <Button variant="primary" onClick={save} loading={busy}>
              <Save size={13} /> {mode === 'CREATE' ? 'Create User' : 'Save'}
            </Button>
            <Button
              onClick={() => {
                setForm({ ...emptyForm });
                setMode('CREATE');
                setStatus('Ready for new user', 'I');
              }}
            >
              <Plus size={13} /> New
            </Button>
          </div>

          <p className="text-xxs text-sap-muted/70 leading-relaxed border-t border-sap-border pt-2">
            Hanya user dengan role <b className="text-sap-blue">ADMIN</b> yang dapat membuka transaksi ini dan
            menambah user baru. Minimal satu ADMIN aktif harus selalu ada.
            <br />
            <br />
            Akses PDT baru berlaku jika master switch <b className="text-sap-blue">Modul PDT</b> di ZSET juga
            menyala. Perubahan flag ini berlaku pada login berikutnya.
          </p>
        </div>
      </Panel>

      <div className="xl:col-span-2 space-y-3">
        <Toolbar>
          <Button onClick={load} loading={loading}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <span className="ml-auto text-xxs text-sap-muted">Klik baris untuk mengubah data user</span>
        </Toolbar>

        <Grid
          columns={cols}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.id}
          maxHeight="calc(100vh - 260px)"
          onRowClick={(r) => {
            setForm({
              id: r.id,
              username: r.username,
              full_name: r.full_name,
              password: '',
              role: r.role,
              is_active: r.is_active,
              pdt_enabled: r.pdt_enabled,
              so_enabled: r.so_enabled,
              auth_role_id: r.auth_role_id ?? '',
            });
            setMode('CHANGE');
            setStatus(`User ${r.username} selected for change`, 'I');
          }}
        />
      </div>
    </div>
  );
}
