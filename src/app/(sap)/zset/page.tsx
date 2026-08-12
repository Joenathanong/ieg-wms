'use client';

import { useCallback, useEffect, useState } from 'react';
import { Settings, Save, RefreshCw, Info, Smartphone, MapPin } from 'lucide-react';
import { Panel, Field, Input, Button, Toolbar } from '@/components/sap/ui';
import { useStatus } from '@/components/sap/StatusBar';
import { useMasterData } from '@/components/sap/hooks';
import { api, patch } from '@/lib/client';
import { SETTING_META } from '@/lib/settings';
import { ZONES } from '@/lib/zones';

type Settings = Record<string, string>;

export default function ZsetPage() {
  const { setStatus } = useStatus();
  const { bins } = useMasterData();
  const [values, setValues] = useState<Settings>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<Settings>('/api/settings');
    setLoading(false);
    if (!r.ok) return setStatus(r.message, 'E');
    setValues(r.data ?? {});
  }, [setStatus]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setBusy(true);
    const r = await patch('/api/settings', values);
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok) setValues(r.data ?? values);
  }

  const interimBins = bins.filter((b) => b.is_interim);

  return (
    <div className="space-y-3 max-w-[1100px]">
      <Panel title="ZSET — System Configuration" icon={<Settings size={13} className="text-sap-blue" />}>
        <div className="space-y-4">
          {SETTING_META.map((m) => (
            <div key={m.key} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start border-b border-sap-border/60 pb-3 last:border-0">
              <div className="md:col-span-2">
                <p className="text-2xs text-sap-text flex items-center gap-1.5">
                  {m.key === 'PDT_ENABLED' && <Smartphone size={12} className="text-sap-blue" />}
                  {m.label}
                </p>
                <p className="text-xxs text-sap-muted/80 mt-0.5 leading-relaxed">{m.hint}</p>
                <p className="text-xxs text-sap-muted/50 font-mono mt-0.5">{m.key}</p>
              </div>
              <div>
                {m.type === 'BOOL' ? (
                  <label className="flex items-center gap-2 text-2xs cursor-pointer h-[27px]">
                    <input
                      type="checkbox"
                      className="accent-sap-blue w-4 h-4"
                      checked={values[m.key] === '1'}
                      onChange={(e) => setValues((s) => ({ ...s, [m.key]: e.target.checked ? '1' : '0' }))}
                    />
                    <span className={values[m.key] === '1' ? 'text-sap-oktext' : 'text-sap-muted'}>
                      {values[m.key] === '1' ? 'AKTIF' : 'NONAKTIF'}
                    </span>
                  </label>
                ) : (
                  <Input
                    list="dl-interim"
                    className="uppercase"
                    value={values[m.key] ?? ''}
                    onChange={(e) => setValues((s) => ({ ...s, [m.key]: e.target.value }))}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Toolbar>
        <Button variant="primary" onClick={save} loading={busy}>
          <Save size={13} /> Save Configuration
        </Button>
        <Button onClick={load} loading={loading}>
          <RefreshCw size={13} /> Reload
        </Button>
        <span className="ml-auto text-xxs text-sap-muted flex items-center gap-1.5">
          <Info size={12} /> Perubahan izin PDT berlaku pada login berikutnya.
        </span>
      </Toolbar>

      <Panel title="Interim Bin yang tersedia" icon={<MapPin size={13} className="text-sap-blue" />} bodyClassName="p-3">
        {interimBins.length === 0 ? (
          <p className="text-xxs text-sap-warntext">
            Belum ada bin interim. Buat bin dengan zona <b>GR-ZONE</b> dan <b>GI-ZONE</b> di LS01N terlebih
            dahulu, kalau tidak MIGO 101 / 201 akan menolak posting.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {interimBins.map((b) => (
              <span key={b.id} className="sap-badge border-sap-infoborder bg-sap-infobg text-sap-infotext">
                {b.bin_code} · {b.zone_id}
              </span>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Referensi Zona Gudang" bodyClassName="p-0">
        <table className="sap-grid">
          <thead>
            <tr>
              <th className="w-[160px]">Zone Code</th>
              <th>Keterangan</th>
              <th className="w-[160px]">Contoh Bin</th>
              <th className="w-[90px] text-center">Interim</th>
            </tr>
          </thead>
          <tbody>
            {ZONES.map((z) => (
              <tr key={z.code}>
                <td className="font-mono text-sap-blue">{z.code}</td>
                <td className="text-sap-muted">{z.label}</td>
                <td className="font-mono">{z.binPattern}</td>
                <td className="text-center">{z.interim ? 'X' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <datalist id="dl-interim">
        {interimBins.map((b) => (
          <option key={b.id} value={b.bin_code}>
            {b.zone_id}
          </option>
        ))}
      </datalist>
    </div>
  );
}
