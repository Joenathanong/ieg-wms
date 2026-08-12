import { HelpCircle, Keyboard, Workflow, Smartphone } from 'lucide-react';
import { TCODES } from '@/lib/tcodes';
import { ZONES } from '@/lib/zones';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const FLOW_IN = [
  ['1', 'ZUPLOAD', 'Upload master material → pallet → storage bin → saldo awal → safety stock.'],
  ['2', 'MIGO 101', 'Terima barang di level IM. Stok masuk bin interim TRANSIT-IN dan sistem membuat Transfer Requirement yang sudah dipecah per pallet.'],
  ['3', 'LB10', 'Lihat antrean pekerjaan gudang (TR terbuka).'],
  ['4', 'LB12 / ZRF02', 'Put-away: tentukan rak final tiap line. Movement 301, stok global tidak berubah.'],
];

const FLOW_OUT = [
  ['1', 'MIGO 201 (REQUEST)', 'Buat permintaan picking. Belum ada posting stok — hanya Transfer Requirement PICK. Ditolak bila stok masih menunggu put-away.'],
  ['2', 'LB12 / ZRF03', 'Picking: pilih rak asal (saran FEFO). Stok pindah ke bin interim TRANSIT-OUT lewat 301. Stock IM masih tetap.'],
  ['3', 'MIGO 201 (ISSUE)', 'Post goods issue dari GI zone. Di sinilah Stock IM & WM berkurang dan dokumen 201 terbit.'],
];

const FLOW_SO = [
  ['1', 'LI01N', 'Pilih cakupan (zona / daftar bin / seluruh gudang). Semua bin di-freeze, snapshot stok direkam.'],
  ['2', 'ZRF05', 'Operator input hasil hitung per bin lewat PDT.'],
  ['3', 'LI11N', 'Admin melengkapi/mengoreksi hasil counting seluruh baris dalam satu dokumen.'],
  ['4', 'LI11N', 'Post All Differences → selisih (+) jadi 701, selisih (−) jadi 702, semua bin dilepas.'],
];

function FlowTable({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="text-2xs uppercase tracking-wide text-sap-blue mb-1.5">{title}</p>
      <table className="sap-grid">
        <thead>
          <tr>
            <th className="w-[50px] text-center">Step</th>
            <th className="w-[170px]">T-Code</th>
            <th>Keterangan</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([n, t, d]) => (
            <tr key={`${title}-${n}`}>
              <td className="text-center font-mono text-sap-muted">{n}</td>
              <td className="font-mono text-sap-blue">{t}</td>
              <td className="text-sap-muted">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function HelpPage() {
  const session = await getSession();

  return (
    <div className="space-y-3 max-w-[1100px]">
      <div className="sap-panel px-4 py-3 flex items-center gap-3">
        <HelpCircle size={20} className="text-sap-blue" />
        <div>
          <h1 className="text-sm font-semibold">Application Help — WMS Lightweight</h1>
          <p className="text-2xs text-sap-muted">Alur 2-step IM/WM, daftar T-Code, zona, dan shortcut.</p>
        </div>
      </div>

      <section className="sap-panel">
        <div className="sap-panel-title">
          <Workflow size={13} className="text-sap-blue" /> Alur Proses
        </div>
        <div className="p-3">
          <FlowTable title="Penerimaan barang (inbound)" rows={FLOW_IN} />
          <FlowTable title="Pengeluaran barang (outbound)" rows={FLOW_OUT} />
          <FlowTable title="Stock opname" rows={FLOW_SO} />
          <p className="text-xxs text-sap-muted/80 leading-relaxed mt-2">
            MIGO bekerja di level <b>Inventory Management</b> — tidak menyentuh rak sama sekali untuk movement
            101 dan 201. Penentuan rak selalu lewat LB12 (desktop) atau ZRF02/ZRF03 (PDT). Movement koreksi
            551 / 701 / 702 tetap menunjuk bin langsung karena sifatnya penyesuaian.
          </p>
        </div>
      </section>

      <section className="sap-panel">
        <div className="sap-panel-title">Zona Gudang</div>
        <div className="p-3">
          <table className="sap-grid">
            <thead>
              <tr>
                <th className="w-[160px]">Zone Code</th>
                <th>Keterangan</th>
                <th className="w-[150px]">Contoh Bin</th>
              </tr>
            </thead>
            <tbody>
              {ZONES.map((z) => (
                <tr key={z.code}>
                  <td className="font-mono text-sap-blue">{z.code}</td>
                  <td className="text-sap-muted">{z.label}</td>
                  <td className="font-mono">{z.binPattern}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sap-panel">
        <div className="sap-panel-title">
          <Smartphone size={13} className="text-sap-blue" /> Terminal PDT
        </div>
        <div className="p-3 text-2xs text-sap-muted leading-relaxed space-y-1.5">
          <p>
            T-Code <b className="text-sap-blue">ZRF</b> adalah menu operator untuk perangkat PDT / RF scanner.
            Di HP / terminal PDT, membuka halaman utama otomatis diarahkan ke menu <b>ZRF</b> (bisa
            dikembalikan lewat tombol &quot;Buka tampilan desktop&quot;). Semua tabel laporan mendukung{' '}
            <b>sort</b> (klik judul kolom) dan <b>filter</b> per kolom lewat ikon corong — operator{' '}
            <span className="font-mono">= ≠ contains &gt; &lt;</span>, beberapa nilai dipisah{' '}
            <span className="font-mono">;</span>, wildcard <span className="font-mono">*</span>. Export CSV
            mengikuti hasil filter yang tampil.
            <br />
            <br />
            Admin mengatur aktif/nonaktifnya di <b className="text-sap-blue">ZSET</b>: ada master switch{' '}
            <b>Modul PDT</b> plus toggle terpisah untuk tiap T-Code (ZRF01–ZRF08). Modul yang dimatikan langsung
            terkunci tanpa perlu login ulang. Sebagai lapisan tambahan, tiap user punya flag <b>Akses PDT</b> di SU01,
            dan akses per T-Code (termasuk per-ZRF) bisa dibatasi lewat role otorisasi{' '}
            <b className="text-sap-blue">PFCG</b> yang di-assign di SU01. <b>ZRF08 Replenishment</b> menampilkan
            list stok urut FEFO lalu memindahkannya ke Fix Bin material (saran otomatis dari MM01). Scan barcode
            PDT mendukung format compound <span className="font-mono">material;batch;...</span> dan EAN
            (lookup barcode B-POM / barcode produk di MM01). Pembatalan dokumen dilakukan di MIGO mode{' '}
            <b>Cancellation</b> (102/202/552/562/711/712) dengan data terkunci sesuai dokumen asal.
          </p>
          <p>
            Status akses Anda saat ini:{' '}
            {session?.pdt ? (
              <span className="sap-badge border-sap-okborder bg-sap-okbg text-sap-oktext">AKTIF</span>
            ) : (
              <span className="sap-badge border-sap-errborder bg-sap-errbg text-sap-errtext">NONAKTIF</span>
            )}
          </p>
          <p>
            Semua posting dari PDT ditandai <b>via PDT</b> sehingga bisa dibedakan dari posting admin di MB51.
          </p>
        </div>
      </section>

      <section className="sap-panel">
        <div className="sap-panel-title">Transaction Code Directory</div>
        <div className="p-3">
          <table className="sap-grid">
            <thead>
              <tr>
                <th className="w-[150px]">T-Code</th>
                <th className="w-[140px]">Group</th>
                <th>Description</th>
                <th className="w-[140px]">Route</th>
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
            <div key={k} className="flex items-center gap-3 px-2 py-1.5 border border-sap-border rounded-[2px] bg-sap-panelalt">
              <span className="font-mono text-sap-blue w-[90px] shrink-0">{k}</span>
              <span className="text-sap-muted">{d}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
