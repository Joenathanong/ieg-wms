import { HelpCircle, Keyboard, Workflow } from 'lucide-react';
import { TCODES } from '@/lib/tcodes';

export const dynamic = 'force-dynamic';

const FLOW = [
  ['1', 'ZUPLOAD', 'Upload master material, storage bin, lalu saldo awal (561).'],
  ['2', 'MM01 / LS01N', 'Tambah material & bin baru secara manual bila diperlukan.'],
  ['3', 'MIGO 101', 'Penerimaan barang (GR) ke bin tujuan — Stock IM & WM bertambah.'],
  ['4', 'LT01 / LT10', 'Pindah stok antar bin (301) — Stock IM global tidak berubah.'],
  ['5', 'MIGO 201', 'Pengeluaran barang (GI) dari bin sumber — Stock IM & WM berkurang.'],
  ['6', 'LI01N → LI11N', 'Stock opname: freeze bin → input counting → posting selisih 701/702.'],
  ['7', 'MB52 / LX02 / MB51 / LS04', 'Laporan stok global, stok per bin, riwayat dokumen, dan bin kosong.'],
];

export default function HelpPage() {
  return (
    <div className="space-y-3 max-w-[1100px]">
      <div className="sap-panel px-4 py-3 flex items-center gap-3">
        <HelpCircle size={20} className="text-sap-blue" />
        <div>
          <h1 className="text-sm font-semibold">Application Help — WMS Lightweight</h1>
          <p className="text-2xs text-sap-muted">Daftar T-Code, alur proses, dan shortcut keyboard.</p>
        </div>
      </div>

      <section className="sap-panel">
        <div className="sap-panel-title">
          <Workflow size={13} className="text-sap-blue" /> Alur Proses Standar
        </div>
        <div className="p-3">
          <table className="sap-grid">
            <thead>
              <tr>
                <th className="w-[50px] text-center">Step</th>
                <th className="w-[190px]">T-Code</th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {FLOW.map(([n, t, d]) => (
                <tr key={n}>
                  <td className="text-center font-mono text-sap-muted">{n}</td>
                  <td className="font-mono text-sap-blue">{t}</td>
                  <td className="text-sap-muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sap-panel">
        <div className="sap-panel-title">Transaction Code Directory</div>
        <div className="p-3">
          <table className="sap-grid">
            <thead>
              <tr>
                <th className="w-[150px]">T-Code</th>
                <th className="w-[130px]">Group</th>
                <th>Description</th>
                <th className="w-[130px]">Route</th>
              </tr>
            </thead>
            <tbody>
              {TCODES.map((t, i) => (
                <tr key={`${t.code}-${i}`}>
                  <td className="font-mono text-sap-blue">{t.code}</td>
                  <td className="font-mono text-sap-muted">{t.group}</td>
                  <td>{t.title}</td>
                  <td className="font-mono text-sap-muted">{t.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sap-panel">
        <div className="sap-panel-title">
          <Keyboard size={13} className="text-sap-blue" /> Shortcut
        </div>
        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-2xs">
          {[
            ['Ctrl + /', 'Fokus ke Command Field (input T-Code)'],
            ['Enter', 'Jalankan T-Code yang diketik'],
            ['↑ / ↓', 'Navigasi daftar saran T-Code'],
            ['Esc', 'Tutup daftar saran'],
            ['/n<TCODE>', 'Format SAP klasik, mis. /nMIGO'],
            ['/exit', 'Log off dari sistem'],
          ].map(([k, d]) => (
            <div key={k} className="flex items-center gap-3 px-2 py-1.5 border border-sap-border rounded-[2px] bg-[#242934]">
              <span className="font-mono text-sap-blue w-[90px] shrink-0">{k}</span>
              <span className="text-sap-muted">{d}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
