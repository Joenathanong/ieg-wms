'use client';

import { useRef, useState } from 'react';
import { PackagePlus, Save, RotateCcw } from 'lucide-react';
import { PdtScreen, PdtInput, PdtButton, PdtRow, PdtMessage } from '@/components/pdt/ui';
import { useMasterData } from '@/components/sap/hooks';
import { post } from '@/lib/client';

export default function ZrfGrPage() {
  const { materials } = useMasterData();
  const matRef = useRef<HTMLInputElement>(null);

  const [material, setMaterial] = useState('');
  const [qty, setQty] = useState('');
  const [batch, setBatch] = useState('');
  const [expDate, setExpDate] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'S' | 'E' | 'W' | 'I' } | null>(null);

  const mat = materials.find((m) => m.material_code === material.trim().toUpperCase());
  const pack = mat?.packagings?.find((p) => p.is_default) ?? mat?.packagings?.[0];
  const splitLines = pack && Number(qty) > 0 ? Math.ceil(Number(qty) / pack.qty_per_unit) : 0;

  function reset() {
    setMaterial('');
    setQty('');
    setBatch('');
    setExpDate('');
    setMsg(null);
    matRef.current?.focus();
  }

  async function submit() {
    if (!material.trim()) return setMsg({ text: 'Scan material terlebih dahulu', type: 'E' });
    if (!Number(qty)) return setMsg({ text: 'Quantity belum diisi', type: 'E' });
    if (mat?.is_batch_managed && !batch.trim())
      return setMsg({ text: `Material ${mat.material_code} wajib batch`, type: 'E' });

    setBusy(true);
    const r = await post('/api/migo', {
      movement_type: '101',
      reference,
      items: [
        {
          material_code: material.trim().toUpperCase(),
          qty: Number(qty),
          batch_number: batch.trim().toUpperCase() || null,
          exp_date: expDate || null,
        },
      ],
    });
    setBusy(false);
    setMsg({ text: r.message, type: r.ok ? 'S' : 'E' });
    if (r.ok) {
      setMaterial('');
      setQty('');
      setBatch('');
      setExpDate('');
      matRef.current?.focus();
    }
  }

  return (
    <PdtScreen
      title="Goods Receipt"
      code="ZRF01"
      footer={
        <p className="text-xxs text-sap-muted">
          Barang masuk ke GR zone. Simpan ke rak lewat <b>ZRF02 Put-away</b>.
        </p>
      }
    >
      {msg && <PdtMessage text={msg.text} type={msg.type} />}

      <PdtInput
        ref={matRef}
        label="Material (scan)"
        list="dl-pdt-mat"
        autoFocus
        value={material}
        onChange={(e) => setMaterial(e.target.value.toUpperCase())}
      />
      {mat && (
        <div className="rounded-[3px] border border-sap-border bg-[#242934] px-3 py-2">
          <PdtRow label="Deskripsi" value={mat.description} />
          <PdtRow label="UoM" value={mat.uom} />
          <PdtRow label="Batch" value={mat.is_batch_managed ? 'WAJIB' : 'tidak dipakai'} />
          {pack && <PdtRow label="Pallet" value={`${pack.pack_code} = ${pack.qty_per_unit}`} accent />}
        </div>
      )}

      <PdtInput
        label="Quantity"
        type="number"
        inputMode="numeric"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        hint={splitLines > 1 ? `Akan dipecah menjadi ${splitLines} pallet` : undefined}
      />

      <PdtInput
        label="Batch"
        disabled={!!mat && !mat.is_batch_managed}
        value={batch}
        onChange={(e) => setBatch(e.target.value.toUpperCase())}
      />

      <PdtInput label="Expired Date" type="date" value={expDate} onChange={(e) => setExpDate(e.target.value)} />

      <PdtInput
        label="Reference / DO"
        value={reference}
        onChange={(e) => setReference(e.target.value.toUpperCase())}
      />

      <div className="grid grid-cols-2 gap-2 pt-1">
        <PdtButton onClick={reset}>
          <RotateCcw size={16} /> Reset
        </PdtButton>
        <PdtButton variant="primary" onClick={submit} loading={busy}>
          <Save size={16} /> Post
        </PdtButton>
      </div>

      <datalist id="dl-pdt-mat">
        {materials.map((m) => (
          <option key={m.id} value={m.material_code}>
            {m.description}
          </option>
        ))}
      </datalist>
    </PdtScreen>
  );
}
