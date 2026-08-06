'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftRight, Search, Save, RotateCcw, Info, MoveRight } from 'lucide-react';
import { Panel, Field, Input, Button, Toolbar, Grid, type Column, Badge } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData } from '@/components/sap/hooks';
import { api, post, fmtDate } from '@/lib/client';

interface Quant {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  batch_number: string;
  mfg_date: string | null;
  exp_date: string | null;
  qty: number;
  bin_code: string;
}

export default function Lt01Page() {
  const { setStatus } = useStatus();
  const { bins } = useMasterData();

  const [sourceBin, setSourceBin] = useState('');
  const [quants, setQuants] = useState<Quant[]>([]);
  const [loading, setLoading] = useState(false);

  const [sel, setSel] = useState<Quant | null>(null);
  const [qty, setQty] = useState('');
  const [targetBin, setTargetBin] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadQuants(bin: string) {
    if (!bin) {
      setQuants([]);
      return;
    }
    setLoading(true);
    const r = await api<Quant[]>(`/api/stock/quants?bin=${encodeURIComponent(bin)}`);
    setLoading(false);
    if (!r.ok) {
      setStatus(r.message, 'E');
      setQuants([]);
      return;
    }
    setQuants(r.data ?? []);
    setStatus(r.message, (r.data?.length ?? 0) > 0 ? 'S' : 'W');
  }

  useEffect(() => {
    setSel(null);
    setQty('');
  }, [sourceBin]);

  async function submit() {
    if (!sel) return setStatus('Select the source quant to be transferred', 'E');
    const n = Number(qty);
    if (!n || n <= 0) return setStatus('Quantity must be greater than zero', 'E');
    if (n > sel.qty) return setStatus(`Only ${sel.qty} ${sel.uom} available in bin ${sel.bin_code}`, 'E');
    if (!targetBin.trim()) return setStatus('Destination storage bin is missing', 'E');

    setBusy(true);
    const r = await post('/api/transfer', {
      items: [
        {
          material_code: sel.material_code,
          qty: n,
          batch_number: sel.batch_number || null,
          source_bin: sel.bin_code,
          target_bin: targetBin.trim().toUpperCase(),
        },
      ],
    });
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) {
      setSel(null);
      setQty('');
      setTargetBin('');
      loadQuants(sourceBin);
    }
  }

  const cols: Column<Quant>[] = [
    { key: 'material_code', header: 'Material', mono: true, width: '150px' },
    { key: 'description', header: 'Description', width: '230px' },
    { key: 'batch_number', header: 'Batch', mono: true, width: '140px' },
    {
      key: 'exp_date',
      header: 'Exp. Date',
      mono: true,
      width: '110px',
      render: (r) => fmtDate(r.exp_date),
    },
    { key: 'qty', header: 'Available', align: 'right', width: '90px' },
    { key: 'uom', header: 'UoM', mono: true, width: '60px' },
  ];

  return (
    <div className="space-y-3">
      <Panel title="LT01 — Create Transfer Order (Bin to Bin)" icon={<ArrowLeftRight size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Field label="Source Storage Bin" required>
            <Input
              list="dl-bins"
              className="uppercase"
              value={sourceBin}
              onChange={(e) => setSourceBin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadQuants(sourceBin.trim().toUpperCase())}
            />
          </Field>
          <div>
            <Button onClick={() => loadQuants(sourceBin.trim().toUpperCase())} loading={loading}>
              <Search size={13} /> Display Stock
            </Button>
          </div>
          <div className="md:col-span-2 text-xxs text-sap-muted flex items-center gap-1.5">
            <Info size={12} />
            Movement 301 — Stok global (IM) tidak berubah, hanya lokasi fisik (WM) yang berpindah.
          </div>
        </div>
      </Panel>

      <Panel title="Stock in Source Bin — pilih baris untuk ditransfer" bodyClassName="p-2">
        <Grid
          columns={cols}
          rows={quants}
          loading={loading}
          rowKey={(r) => r.id}
          maxHeight="260px"
          onRowClick={(r) => {
            setSel(r);
            setQty(String(r.qty));
            setStatus(`Quant selected: ${r.material_code}${r.batch_number ? ' / ' + r.batch_number : ''}`, 'I');
          }}
          emptyText="Masukkan source bin lalu tekan Display Stock"
        />
      </Panel>

      <Panel title="Transfer Order Data" icon={<MoveRight size={13} className="text-sap-blue" />}>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Field label="Material">
            <Input readOnly disabled value={sel?.material_code ?? ''} />
          </Field>
          <Field label="Batch">
            <Input readOnly disabled value={sel?.batch_number ?? ''} />
          </Field>
          <Field label="Transfer Quantity" required hint={sel ? `Max ${sel.qty} ${sel.uom}` : undefined}>
            <Input
              type="number"
              min={1}
              max={sel?.qty}
              className="text-right"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </Field>
          <Field label="Source Bin">
            <Input readOnly disabled value={sel?.bin_code ?? ''} />
          </Field>
          <Field label="Destination Bin" required>
            <Input
              list="dl-bins"
              className="uppercase"
              value={targetBin}
              onChange={(e) => setTargetBin(e.target.value)}
            />
          </Field>
        </div>
      </Panel>

      <Toolbar>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!sel}>
          <Save size={13} /> Transfer &amp; Confirm
        </Button>
        <Button
          onClick={() => {
            setSel(null);
            setQty('');
            setTargetBin('');
            setStatus('Entry screen has been reset', 'I');
          }}
        >
          <RotateCcw size={13} /> Reset
        </Button>
        {sel && (
          <span className="ml-2 flex items-center gap-2 text-xxs text-sap-muted font-mono">
            <Badge value="OCCUPIED" /> {sel.bin_code} <MoveRight size={12} /> {targetBin || '____'}
          </span>
        )}
      </Toolbar>

      <datalist id="dl-bins">
        {bins.map((b) => (
          <option key={b.id} value={b.bin_code}>
            {b.zone_id} · {b.status}
          </option>
        ))}
      </datalist>
    </div>
  );
}
