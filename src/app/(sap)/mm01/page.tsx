'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Search, Save, Plus, Trash2, Download, Package, Star } from 'lucide-react';
import { Panel, Field, Input, Select, Button, Toolbar, Grid, exportCsv, type Column } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { invalidateMasterData, type PackagingLite } from '@/components/sap/hooks';
import { api, post, patch, del, qs } from '@/lib/client';
import { ZONE_GROUPS } from '@/lib/zones';

interface Row {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  is_batch_managed: boolean;
  min_safety_stock: number;
  packagings: PackagingLite[];
}

const emptyForm = {
  material_code: '',
  description: '',
  uom: 'PC',
  is_batch_managed: true,
  min_safety_stock: 0,
};

const emptyPack = {
  pack_code: '',
  su_type: 'PAL',
  zone_group: '',
  description: '',
  qty_per_unit: 0,
  is_default: false,
};

export default function Mm01Page() {
  const { setStatus } = useStatus();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'CREATE' | 'CHANGE'>('CREATE');
  const [form, setForm] = useState({ ...emptyForm });

  const [packs, setPacks] = useState<PackagingLite[]>([]);
  const [packForm, setPackForm] = useState({ ...emptyPack });

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
      if (mode === 'CREATE') {
        // langsung lanjut ke maintenance pallet material baru
        setMode('CHANGE');
        setPacks([]);
      }
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

  async function savePack() {
    if (mode !== 'CHANGE') return setStatus('Simpan material terlebih dahulu sebelum menambah pallet', 'E');
    if (!packForm.pack_code.trim()) return setStatus('Packaging code is mandatory', 'E');
    if (!packForm.qty_per_unit || packForm.qty_per_unit <= 0)
      return setStatus('Qty per unit harus lebih besar dari nol', 'E');

    setBusy(true);
    const r = await post('/api/packaging', { material_code: form.material_code, ...packForm });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      invalidateMasterData();
      setPackForm({ ...emptyPack });
      const p = await api<PackagingLite[]>(`/api/packaging?material=${encodeURIComponent(form.material_code)}`);
      if (p.ok) setPacks(p.data ?? []);
      run();
    }
  }

  async function removePack(pack_code: string) {
    setBusy(true);
    const r = await del(
      `/api/packaging?material=${encodeURIComponent(form.material_code)}&pack=${encodeURIComponent(pack_code)}`
    );
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      invalidateMasterData();
      setPacks((s) => s.filter((x) => x.pack_code !== pack_code));
      run();
    }
  }

  const cols: Column<Row>[] = [
    { key: 'material_code', header: 'Material', mono: true, width: '150px' },
    { key: 'description', header: 'Material Description', width: '280px' },
    { key: 'uom', header: 'Base UoM', mono: true, width: '85px' },
    {
      key: 'is_batch_managed',
      header: 'Batch',
      align: 'center',
      width: '70px',
      render: (r) => (
        <span className={r.is_batch_managed ? 'text-sap-blue font-semibold' : 'text-sap-muted'}>
          {r.is_batch_managed ? 'X' : '—'}
        </span>
      ),
    },
    { key: 'min_safety_stock', header: 'Safety Stock', align: 'right', width: '105px' },
    {
      key: 'packagings',
      header: 'Pallet / Packaging',
      width: '210px',
      render: (r) =>
        r.packagings?.length ? (
          <span className="font-mono text-xxs">
            {r.packagings
              .map((p) => `${p.zone_group ?? 'ALL'}:${p.pack_code}=${p.qty_per_unit}${p.is_default ? '*' : ''}`)
              .join('  ')}
          </span>
        ) : (
          <span className="text-sap-muted">—</span>
        ),
    },
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
        <div className="xl:col-span-1 space-y-3">
          <Panel
            title={mode === 'CREATE' ? 'MM01 — Create Material' : `MM02 — Change Material ${form.material_code}`}
            icon={<Boxes size={13} className="text-sap-blue" />}
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
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
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
                    setPacks([]);
                    setPackForm({ ...emptyPack });
                    setMode('CREATE');
                    setStatus('Ready for new material', 'I');
                  }}
                >
                  <Plus size={13} /> New
                </Button>
              </div>
            </div>
          </Panel>

          {/* MASTER PALLET */}
          <Panel
            title="Palletization Master (material × SU type × gudang)"
            icon={<Package size={13} className="text-sap-blue" />}
            bodyClassName="p-3"
          >
            {mode !== 'CHANGE' ? (
              <p className="text-xxs text-sap-muted leading-relaxed">
                Pilih material dari daftar di sebelah kanan (atau simpan material baru terlebih dahulu) untuk
                mengelola tipe pallet.
              </p>
            ) : (
              <div className="space-y-3">
                <table className="sap-grid">
                  <thead>
                    <tr>
                      <th className="w-[110px]">Pack Code</th>
                      <th className="w-[70px]">SU Type</th>
                      <th className="w-[70px]">Gudang</th>
                      <th className="w-[75px] text-right">Qty/Unit</th>
                      <th className="w-[55px] text-center">Def.</th>
                      <th className="w-[36px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {packs.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-3 text-center text-sap-muted">
                          Belum ada palletization — qty tidak akan dipecah di MIGO
                        </td>
                      </tr>
                    )}
                    {packs.map((p) => (
                      <tr key={p.id}>
                        <td className="font-mono">{p.pack_code}</td>
                        <td className="font-mono text-sap-muted">{p.su_type}</td>
                        <td className="font-mono text-sap-muted">{p.zone_group ?? 'ALL'}</td>
                        <td className="text-right font-mono">{p.qty_per_unit}</td>
                        <td className="text-center">
                          {p.is_default ? <Star size={12} className="inline text-[#F3C77B]" /> : '—'}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            onClick={() => removePack(p.pack_code)}
                            className="text-sap-muted hover:text-sap-error p-1"
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="grid grid-cols-2 gap-2 border-t border-sap-border pt-3">
                  <Field label="Pack Code" required>
                    <Input
                      className="uppercase"
                      placeholder="PALLET-STD"
                      value={packForm.pack_code}
                      onChange={(e) => setPackForm({ ...packForm, pack_code: e.target.value })}
                    />
                  </Field>
                  <Field label={`Qty per Unit (${form.uom})`} required>
                    <Input
                      type="number"
                      min={1}
                      className="text-right"
                      value={packForm.qty_per_unit || ''}
                      onChange={(e) => setPackForm({ ...packForm, qty_per_unit: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="Storage Unit Type">
                    <Select
                      value={packForm.su_type}
                      onChange={(e) => setPackForm({ ...packForm, su_type: e.target.value })}
                    >
                      <option value="PAL">PAL — Pallet</option>
                      <option value="BINBOX">BINBOX — Bin Box</option>
                      <option value="CTN">CTN — Carton</option>
                    </Select>
                  </Field>
                  <Field label="Kelompok Gudang" hint="kosong = berlaku semua gudang">
                    <Select
                      value={packForm.zone_group}
                      onChange={(e) => setPackForm({ ...packForm, zone_group: e.target.value })}
                    >
                      <option value="">(semua gudang)</option>
                      {ZONE_GROUPS.map((g) => (
                        <option key={g.code} value={g.code}>
                          {g.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Description" className="col-span-2">
                    <Input
                      value={packForm.description}
                      placeholder="mis. Pallet standar 10 layer"
                      onChange={(e) => setPackForm({ ...packForm, description: e.target.value })}
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-2xs text-sap-muted cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-[#367BF5]"
                    checked={packForm.is_default}
                    onChange={(e) => setPackForm({ ...packForm, is_default: e.target.checked })}
                  />
                  Jadikan default untuk kelompok gudang ini (dipakai MIGO untuk auto-split)
                </label>
                <Button variant="primary" onClick={savePack} loading={busy}>
                  <Save size={13} /> Simpan Pallet
                </Button>
              </div>
            )}
          </Panel>
        </div>

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
            <span className="ml-auto text-xxs text-sap-muted">
              Klik baris untuk mengubah (MM02) &amp; mengelola pallet · tanda * = default
            </span>
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
              setPacks(r.packagings ?? []);
              setPackForm({ ...emptyPack });
              setMode('CHANGE');
              setStatus(`Material ${r.material_code} selected for change`, 'I');
            }}
          />
        </div>
      </div>
    </div>
  );
}
