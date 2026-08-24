'use client';

import { useCallback, useEffect, useState } from 'react';
import { Layers3, Search, Save, Plus, Trash2, Download, RefreshCw, Sparkles } from 'lucide-react';
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
import { ConfirmDialog } from '@/components/sap/Confirm';
import { invalidateMasterData, invalidateZones, type ZoneLite } from '@/components/sap/hooks';
import { api, post, patch, del } from '@/lib/client';
import { ZONE_GROUP_CODES, ZONE_GROUP_LABEL } from '@/lib/zones';

type Form = {
  zone_code: string;
  label: string;
  zone_group: string;
  bin_pattern: string;
  is_interim: boolean;
  is_pick: boolean;
  is_active: boolean;
};

const emptyForm: Form = {
  zone_code: '',
  label: '',
  // Sengaja kosong: kelompok gudang menentukan zona ini ikut Gudang Besar atau
  // Gudang Kecil, dan salah pilih baru ketahuan jauh kemudian — mis. stok Gudang
  // Kecil ikut muncul di ZRF08. Nilai bawaan 'BESAR' membuat kesalahan itu
  // terjadi tanpa seorang pun menyentuh pilihannya.
  zone_group: '',
  bin_pattern: '',
  is_interim: false,
  is_pick: false,
  is_active: true,
};

/**
 * ZZONE — Maintain Zone / Storage Section.
 *
 * Padanan Storage Type di SAP WM. Sebelumnya zona hanya konstanta di kode,
 * sekarang jadi master data yang bisa ditambah/diubah dari layar ini.
 */
export default function ZzonePage() {
  const { setStatus } = useStatus();

  const [rows, setRows] = useState<ZoneLite[]>([]);
  const [view, setView] = useState<ZoneLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'CREATE' | 'CHANGE'>('CREATE');
  const [form, setForm] = useState<Form>({ ...emptyForm });
  const [confirmSync, setConfirmSync] = useState(false);
  const [toDelete, setToDelete] = useState<ZoneLite | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    const r = await api<ZoneLite[]>('/api/zones');
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setRows(r.data ?? []);
    setStatus(r.message, (r.data?.length ?? 0) > 0 ? 'S' : 'W');
  }, [setStatus]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enter / F8 = Execute
  useExecuteKey(run);

  function refreshCaches() {
    invalidateZones();
    invalidateMasterData();
  }

  async function save() {
    if (!form.zone_code.trim()) return setStatus('Zone code is mandatory', 'E');
    if (!form.label.trim()) return setStatus('Zone description is mandatory', 'E');
    if (!form.zone_group) return setStatus('Pilih kelompok gudang terlebih dahulu', 'E');

    setBusy(true);
    const body = {
      zone_code: form.zone_code.trim().toUpperCase(),
      label: form.label.trim(),
      zone_group: form.zone_group,
      bin_pattern: form.bin_pattern.trim(),
      is_interim: form.is_interim,
      is_pick: form.is_pick,
      is_active: form.is_active,
    };
    const r =
      mode === 'CREATE'
        ? await post('/api/zones', body)
        : await patch(`/api/zones/${encodeURIComponent(body.zone_code)}`, body);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      refreshCaches();
      setForm({ ...emptyForm });
      setMode('CREATE');
      run();
    }
  }

  async function remove(z: ZoneLite) {
    setToDelete(null);
    setBusy(true);
    const r = await del(`/api/zones/${encodeURIComponent(z.zone_code)}`);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      refreshCaches();
      if (form.zone_code === z.zone_code) {
        setForm({ ...emptyForm });
        setMode('CREATE');
      }
      run();
    }
  }

  async function seed() {
    setBusy(true);
    const r = await post('/api/zones', { seed: true });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      refreshCaches();
      run();
    }
  }

  async function sync() {
    setConfirmSync(false);
    setBusy(true);
    const r = await post('/api/zones/sync', {});
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      refreshCaches();
      run();
    }
  }

  const cols: Column<ZoneLite>[] = [
    { key: 'zone_code', header: 'Zone', mono: true, width: '140px' },
    { key: 'label', header: 'Description', width: '300px' },
    {
      key: 'zone_group',
      header: 'Kelompok',
      mono: true,
      width: '110px',
    },
    { key: 'bin_pattern', header: 'Contoh Bin', mono: true, width: '140px' },
    {
      key: 'is_interim',
      header: 'Interim',
      align: 'center',
      width: '85px',
      exportValue: (r) => (r.is_interim ? 'X' : ''),
      render: (r) =>
        r.is_interim ? (
          <span className="sap-badge border-sap-infoborder bg-sap-infobg text-sap-infotext">GR/GI</span>
        ) : (
          <span className="text-sap-muted">—</span>
        ),
    },
    {
      key: 'is_pick',
      header: 'Pick Face',
      align: 'center',
      width: '90px',
      exportValue: (r) => (r.is_pick ? 'X' : ''),
      render: (r) =>
        r.is_pick ? (
          <span className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext">PICK</span>
        ) : (
          <span className="text-sap-muted">—</span>
        ),
    },
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
    { key: 'bin_count', header: 'Jml Bin', align: 'right', width: '90px' },
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
          title={r.bin_count > 0 ? `Masih dipakai ${r.bin_count} bin` : 'Hapus zona'}
          disabled={r.bin_count > 0}
          onClick={(e) => {
            e.stopPropagation();
            setToDelete(r);
          }}
          className="text-sap-muted hover:text-sap-error disabled:opacity-30 disabled:hover:text-sap-muted p-1"
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
          title={mode === 'CREATE' ? 'ZZONE — Create Zone' : `ZZONE — Change Zone ${form.zone_code}`}
          icon={<Layers3 size={13} className="text-sap-blue" />}
        >
          <div className="space-y-3">
            <Field
              label="Zone / Storage Section"
              required
              hint="2–20 karakter: A–Z, 0–9, tanda hubung. Tidak bisa diubah setelah dibuat."
            >
              <Input
                className="uppercase"
                placeholder="GB-HDR"
                disabled={mode === 'CHANGE'}
                value={form.zone_code}
                onChange={(e) => setForm({ ...form, zone_code: e.target.value })}
              />
            </Field>

            <Field label="Description" required>
              <Input
                placeholder="Gudang Besar — Heavy Duty Racking"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </Field>

            <Field
              label="Kelompok Gudang"
              hint="Menentukan palletization yang dipakai MIGO saat put-away, dan menentukan zona ini ikut Gudang Besar atau Gudang Kecil pada layar yang menyaring per gudang (mis. ZRF08)."
            >
              <Select
                value={form.zone_group}
                onChange={(e) => setForm({ ...form, zone_group: e.target.value })}
              >
                <option value="">(pilih kelompok gudang)</option>
                {ZONE_GROUP_CODES.map((g) => (
                  <option key={g} value={g}>
                    {ZONE_GROUP_LABEL[g] ?? g}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Contoh Format Bin" hint="Hanya petunjuk di layar LS01N, tidak divalidasi.">
              <Input
                className="uppercase"
                placeholder="GB-A-01-02-1"
                value={form.bin_pattern}
                onChange={(e) => setForm({ ...form, bin_pattern: e.target.value })}
              />
            </Field>

            <CheckField
              label="Bin interim (GR / GI zone)"
              checked={form.is_interim}
              onChange={(v) => setForm({ ...form, is_interim: v })}
              hint="Stok di zona ini dianggap transit: tidak bisa jadi tujuan put-away maupun sumber picking."
            />

            <CheckField
              label="Pick face (sumber pengambilan eceran)"
              checked={form.is_pick}
              onChange={(v) => setForm({ ...form, is_pick: v })}
              hint="Penanda zona pick — dipakai sebagai tujuan replenishment ZRF08."
            />

            <CheckField
              label="Aktif"
              checked={form.is_active}
              onChange={(v) => setForm({ ...form, is_active: v })}
              hint="Zona nonaktif tidak bisa dipilih untuk bin baru, tetapi bin lama tetap valid."
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

        <Panel title="Utility" icon={<RefreshCw size={13} className="text-sap-blue" />}>
          <div className="space-y-3">
            <ActionField hint="Isi ulang zona bawaan (GB-HDR, GK-BIN, TRANSIT-IN, dst.) yang belum ada. Aman dijalankan berulang.">
              <Button onClick={seed} loading={busy}>
                <Sparkles size={13} /> Isi zona bawaan
              </Button>
            </ActionField>

            <ActionField hint="Bin menyimpan flag interim sendiri saat dibuat. Jalankan ini setelah mengubah definisi zona agar bin lama ikut terkoreksi.">
              <Button onClick={() => setConfirmSync(true)} loading={busy}>
                <RefreshCw size={13} /> Sinkronkan bin
              </Button>
            </ActionField>
          </div>
        </Panel>
      </div>

      <div className="xl:col-span-2 space-y-3">
        <Toolbar>
          <Button variant="primary" onClick={run} loading={loading}>
            <Search size={13} /> Execute (F8)
          </Button>
          <Button onClick={() => exportCsv('ZZONE_zones.csv', cols, view)} disabled={view.length === 0}>
            <Download size={13} /> Export CSV
          </Button>
          <span className="ml-auto font-mono text-xxs text-sap-muted">
            <b className="text-sap-text">{rows.length}</b> zona ·{' '}
            <b className="text-sap-text">{rows.reduce((a, z) => a + z.bin_count, 0)}</b> bin
          </span>
        </Toolbar>

        <Grid
          columns={cols}
          rows={rows}
          loading={loading}
          rowKey={(r) => r.zone_code}
          maxHeight="calc(100vh - 300px)"
          onViewChange={setView}
          onRowClick={(r) => {
            setForm({
              zone_code: r.zone_code,
              label: r.label,
              zone_group: r.zone_group,
              bin_pattern: r.bin_pattern ?? '',
              is_interim: r.is_interim,
              is_pick: r.is_pick,
              is_active: r.is_active,
            });
            setMode('CHANGE');
            setStatus(`Zone ${r.zone_code} selected for change`, 'I');
          }}
        />
      </div>

      <ConfirmDialog
        open={confirmSync}
        title="Sinkronkan Storage Bin"
        question="Flag interim pada setiap storage bin akan ditulis ulang mengikuti master zone. Lanjutkan?"
        details={[
          { label: 'Cakupan', value: 'Semua storage bin' },
          { label: 'Yang diubah', value: 'Kolom is_interim saja' },
          { label: 'Stok', value: 'Tidak tersentuh' },
        ]}
        confirmLabel="Sinkronkan"
        busy={busy}
        onConfirm={sync}
        onCancel={() => setConfirmSync(false)}
      />

      <ConfirmDialog
        open={!!toDelete}
        danger
        title="Hapus Zone"
        question={`Zona ${toDelete?.zone_code ?? ''} akan dihapus dan tidak bisa dipilih lagi saat membuat bin. Lanjutkan?`}
        details={[
          { label: 'Zone', value: toDelete?.zone_code ?? '' },
          { label: 'Description', value: toDelete?.label ?? '' },
          { label: 'Bin memakai', value: String(toDelete?.bin_count ?? 0) },
        ]}
        confirmLabel="Hapus"
        busy={busy}
        onConfirm={() => toDelete && remove(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
