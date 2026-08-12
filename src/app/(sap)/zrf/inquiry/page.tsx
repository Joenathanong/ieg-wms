'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { PdtScreen, PdtInput, PdtButton, PdtMessage } from '@/components/pdt/ui';
import { api, qs, fmtDate } from '@/lib/client';

interface Row {
  bin_code: string;
  zone_id: string;
  material_code: string;
  description: string;
  batch_number: string;
  exp_date: string | null;
  qty: number;
  uom: string;
  expiry_flag: string;
}

export default function ZrfInquiryPage() {
  const [bin, setBin] = useState('');
  const [material, setMaterial] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'S' | 'E' | 'W' | 'I' } | null>(null);

  async function run() {
    if (!bin.trim() && !material.trim())
      return setMsg({ text: 'Isi bin atau material', type: 'E' });
    setLoading(true);
    const r = await api<{ rows: Row[]; total_qty: number }>(
      '/api/reports/lx02' + qs({ bin: bin.trim().toUpperCase(), material: material.trim().toUpperCase() })
    );
    setLoading(false);
    if (!r.ok) return setMsg({ text: r.message, type: 'E' });
    setRows(r.data?.rows ?? []);
    setMsg({ text: r.message, type: (r.data?.rows.length ?? 0) > 0 ? 'S' : 'W' });
  }

  return (
    <PdtScreen title="Inquiry" code="ZRF06">
      {msg && <PdtMessage text={msg.text} type={msg.type} />}

      <PdtInput
        label="Scan bin"
        autoFocus
        value={bin}
        onChange={(e) => setBin(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && run()}
      />
      <PdtInput
        label="atau scan material"
        value={material}
        onChange={(e) => setMaterial(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && run()}
      />
      <PdtButton variant="primary" onClick={run} loading={loading}>
        <Search size={16} /> Cari
      </PdtButton>

      <div className="space-y-1.5 max-h-[48vh] overflow-auto">
        {rows.map((r, i) => (
          <div key={i} className="rounded-[3px] border border-sap-border bg-[#242934] px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-sm text-sap-blue">{r.bin_code}</span>
              <span className="font-mono text-sm">
                {r.qty} {r.uom}
              </span>
            </div>
            <p className="text-2xs text-sap-text truncate">
              {r.material_code} · {r.description}
            </p>
            <p className="text-xxs text-sap-muted font-mono">
              {r.zone_id} · {r.batch_number || 'no batch'}
              {r.exp_date ? ` · exp ${fmtDate(r.exp_date)}` : ''}
              {r.expiry_flag ? ` · ${r.expiry_flag}` : ''}
            </p>
          </div>
        ))}
      </div>
    </PdtScreen>
  );
}
