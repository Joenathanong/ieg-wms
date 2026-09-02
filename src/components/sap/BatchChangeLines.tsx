'use client';

/**
 * MIGO — Ubah Batch (movement 309).
 *
 * Dipisah dari tabel line MIGO yang biasa karena kolomnya memang berbeda:
 * di sini ada DUA batch (lama dan baru) dan bin-nya adalah tempat barang
 * sudah berada, bukan tujuan. Memaksakannya ke tabel yang sama akan menambah
 * lapis kondisi pada layar yang sudah menangani lima mode.
 *
 * Pengisian tanggal mengikuti aturan yang sama dengan GR: dibaca dari nomor
 * batch HANYA bila panjangnya tepat 6 karakter (lihat src/lib/batchcode.ts —
 * pemeriksaan panjangnya ada di sana, bukan di layar ini, supaya aturannya
 * tidak bisa berbeda antara MIGO GR dan layar ini). Batch yang lebih panjang
 * diisi manual, dan hasil pembacaan selalu boleh ditimpa.
 */

import { useMemo, useState } from 'react';
import { Plus, Trash2, Save, RotateCcw, Info, Replace, AlertTriangle } from 'lucide-react';
import { Panel, Input, Button, Toolbar, Separator } from '@/components/sap/ui';
import { useStatus } from './StatusBar';
import { useMasterData } from './hooks';
import { ConfirmDialog } from './Confirm';
import { api, post } from '@/lib/client';
import { BATCH_CODE_LENGTH, parseBatchCode, describeBatchCode } from '@/lib/batchcode';
import { fillMfg } from '@/lib/shelflife';

interface BatchInfo {
  found: boolean;
  mfg_date?: string | null;
  exp_date?: string | null;
}

interface CheckRow {
  line: number;
  material_code: string;
  description: string;
  bin_code: string;
  batch_from: string;
  batch_to: string;
  qty: number;
  available: number;
  merges_into_existing: boolean;
  status: 'OK' | 'ERROR';
  message?: string;
}

interface Line {
  key: string;
  material_code: string;
  bin: string;
  batch_from: string;
  qty: string;
  batch_to: string;
  mfg_date: string;
  exp_date: string;
  remarks: string;
}

const emptyLine = (): Line => ({
  key: Math.random().toString(36).slice(2),
  material_code: '',
  bin: '',
  batch_from: '',
  qty: '',
  batch_to: '',
  mfg_date: '',
  exp_date: '',
  remarks: '',
});

/** Urutan kolom saat menempel dari Excel — harus sama dengan urutan di tabel. */
const PASTE_COLS = [
  'material_code',
  'bin',
  'batch_from',
  'qty',
  'batch_to',
  'mfg_date',
  'exp_date',
  'remarks',
] as const;
type PasteCol = (typeof PASTE_COLS)[number];

/** dd.mm.yyyy / dd/mm/yyyy / yyyy-mm-dd -> ISO. Hari didahulukan, seperti Excel Indonesia. */
function pasteDate(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (!m) return '';
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function pasteCell(col: PasteCol, raw: string): string {
  const v = raw.trim();
  if (col === 'mfg_date' || col === 'exp_date') return pasteDate(v);
  if (col === 'qty') return v.replace(/[^\d-]/g, '');
  if (col === 'remarks') return v;
  return v.toUpperCase();
}

export function BatchChangeLines({
  docDate,
  reference,
  onPosted,
}: {
  docDate: string;
  reference: string;
  onPosted?: (documentNumber: string) => void;
}) {
  const { setStatus } = useStatus();
  const { materials, bins } = useMasterData();
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [checks, setChecks] = useState<CheckRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const matMap = useMemo(() => new Map(materials.map((m) => [m.material_code, m])), [materials]);

  function patch(key: string, p: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
    // Hasil simulasi menjadi basi begitu ada yang diubah; membiarkannya
    // tampil akan membuat operator memposting berdasarkan pemeriksaan
    // terhadap data yang sudah tidak ada lagi di layar.
    setChecks(null);
  }

  /**
   * Isi tanggal untuk batch BARU.
   *
   * Dua sumber, berurutan: batch yang sudah terdaftar di material yang sama
   * (paling tepercaya — tanggalnya sudah pernah diverifikasi), lalu pola nomor
   * batch 6 karakter. Keduanya hanya mengisi field yang MASIH KOSONG.
   */
  async function fillDates(line: Line) {
    const m = line.material_code.trim().toUpperCase();
    const b = line.batch_to.trim().toUpperCase();
    if (!b) return;

    const wantMfg = line.mfg_date.trim() === '';
    const wantExp = line.exp_date.trim() === '';
    if (!wantMfg && !wantExp) return;

    let registered = false;
    let mfg = '';
    let exp = '';

    if (m) {
      const r = await api<BatchInfo>(
        `/api/materials/batch?material=${encodeURIComponent(m)}&batch=${encodeURIComponent(b)}`
      );
      registered = !!(r.ok && r.data?.found);
      mfg = r.ok && r.data?.mfg_date ? String(r.data.mfg_date).slice(0, 10) : '';
      exp = r.ok && r.data?.exp_date ? String(r.data.exp_date).slice(0, 10) : '';
    }

    let fromCode: ReturnType<typeof parseBatchCode> = null;
    if (!mfg && !exp) {
      fromCode = parseBatchCode(b);
      if (fromCode) {
        mfg = fromCode.mfg_date;
        exp = fromCode.exp_date;
      }
    }

    if (!mfg && !exp) {
      // Batch lebih dari 6 karakter (atau polanya tidak terbaca) memang harus manual.
      if (b.length !== BATCH_CODE_LENGTH)
        setStatus(
          `Batch ${b} bukan kode ${BATCH_CODE_LENGTH} karakter — isi tanggalnya manual.`,
          'W'
        );
      return;
    }

    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== line.key) return l;
        // nomor batch sempat diubah lagi sebelum balasan tiba -> abaikan
        if (l.batch_to.trim().toUpperCase() !== b) return l;
        return { ...l, mfg_date: l.mfg_date || mfg, exp_date: l.exp_date || exp };
      })
    );
    setChecks(null);

    setStatus(
      registered
        ? `Batch ${b} sudah terdaftar — tanggal diambil dari batch yang ada.`
        : fromCode
          ? `Batch ${b} dibaca sebagai ${describeBatchCode(fromCode)} (boleh diubah).`
          : `Tanggal batch ${b} terisi otomatis (boleh diubah).`,
      'I'
    );
  }

  /** Tempel banyak baris sekaligus dari Excel. */
  function handlePaste(e: React.ClipboardEvent, rowIndex: number, col: PasteCol) {
    const text = e.clipboardData.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return; // satu sel — biarkan default

    e.preventDefault();
    const rows = text.replace(/\r/g, '').split('\n').filter((r) => r.trim() !== '');
    const startCol = PASTE_COLS.indexOf(col);

    setLines((ls) => {
      const next = [...ls];
      // Tambah baris bila tempelan lebih panjang daripada yang tersedia.
      while (next.length < rowIndex + rows.length) next.push(emptyLine());

      rows.forEach((row, r) => {
        const cells = row.split('\t');
        const target = { ...next[rowIndex + r] };
        cells.forEach((cell, c) => {
          const key = PASTE_COLS[startCol + c];
          if (!key) return;
          (target as unknown as Record<string, string>)[key] = pasteCell(key, cell);
        });
        next[rowIndex + r] = target;
      });
      return next;
    });
    setChecks(null);
    setStatus(`${rows.length} baris ditempel dari clipboard`, 'S');
  }

  function payload() {
    const items = lines
      .filter((l) => l.material_code.trim() || l.batch_from.trim() || l.batch_to.trim())
      .map((l) => ({
        material_code: l.material_code.trim().toUpperCase(),
        bin: l.bin.trim().toUpperCase(),
        batch_from: l.batch_from.trim().toUpperCase(),
        batch_to: l.batch_to.trim().toUpperCase(),
        qty: l.qty,
        mfg_date: l.mfg_date || null,
        exp_date: l.exp_date || null,
        remarks: l.remarks.trim() || null,
      }));
    return { doc_date: docDate, reference: reference.trim() || null, items };
  }

  async function runCheck(): Promise<boolean> {
    const b = payload();
    if (b.items.length === 0) {
      setStatus('Belum ada baris yang diisi', 'E');
      return false;
    }

    setChecking(true);
    const r = await post<{ rows: CheckRow[]; error_count: number }>('/api/migo/batch-change', {
      ...b,
      dry_run: true,
    });
    setChecking(false);
    setStatus(r.message, r.ok ? (r.data?.error_count ? 'W' : 'S') : 'E');
    if (r.ok && r.data) setChecks(r.data.rows);
    return r.ok && r.data ? r.data.error_count === 0 : false;
  }

  async function askPost() {
    const okToPost = await runCheck();
    if (okToPost) setConfirmOpen(true);
  }

  async function submit() {
    setBusy(true);
    setConfirmOpen(false);
    const r = await post<{ document_number: string }>('/api/migo/batch-change', payload());
    setBusy(false);
    setStatus(r.message, r.ok ? 'S' : 'E');
    if (r.ok && r.data) {
      setLines([emptyLine()]);
      setChecks(null);
      onPosted?.(r.data.document_number);
    }
  }

  const checkOf = (i: number) => checks?.find((c) => c.line === i + 1);
  const okRows = checks?.filter((c) => c.status === 'OK') ?? [];
  const errRows = checks?.filter((c) => c.status === 'ERROR') ?? [];

  return (
    <>
      <Panel
        title={`Ubah Batch — ${lines.length} baris`}
        icon={<Replace size={13} className="text-sap-warntext" />}
        bodyClassName="p-0"
        actions={
          <>
            <span className="hidden lg:inline text-xxs text-sap-muted mr-2">
              Bisa tempel langsung dari Excel — beberapa baris sekaligus
            </span>
            <Button onClick={() => setLines((l) => [...l, emptyLine()])}>
              <Plus size={12} /> New Item
            </Button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="sap-grid">
            <thead>
              <tr>
                <th className="w-[40px]">Ln</th>
                <th className="w-[150px]">Material</th>
                <th className="w-[130px]">Storage Bin</th>
                <th className="w-[120px]">Batch Lama</th>
                <th className="w-[90px] text-right">Qty</th>
                <th className="w-[120px]">Batch Baru</th>
                <th className="w-[130px]">Mfg. Date</th>
                <th className="w-[130px]">Exp. Date</th>
                <th className="w-[150px]">Remarks</th>
                <th className="w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const mat = matMap.get(l.material_code.trim().toUpperCase());
                const c = checkOf(i);
                return (
                  <tr key={l.key} className={c?.status === 'ERROR' ? 'bg-sap-errbg/40' : ''}>
                    <td className="font-mono text-sap-muted/60 text-center">{i + 1}</td>
                    <td>
                      <Input
                        list="dl-bc-materials"
                        className="uppercase !py-[3px]"
                        value={l.material_code}
                        onPaste={(e) => handlePaste(e, i, 'material_code')}
                        onChange={(e) => patch(l.key, { material_code: e.target.value })}
                      />
                      {mat && (
                        <p className="text-xxs text-sap-muted truncate max-w-[150px]">
                          {mat.description}
                        </p>
                      )}
                    </td>
                    <td>
                      <Input
                        list="dl-bc-bins"
                        className="uppercase !py-[3px]"
                        value={l.bin}
                        onPaste={(e) => handlePaste(e, i, 'bin')}
                        onChange={(e) => patch(l.key, { bin: e.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        className="uppercase !py-[3px]"
                        value={l.batch_from}
                        onPaste={(e) => handlePaste(e, i, 'batch_from')}
                        onChange={(e) => patch(l.key, { batch_from: e.target.value })}
                      />
                      {c && c.status === 'OK' && (
                        <p className="text-xxs text-sap-muted">tersedia {c.available}</p>
                      )}
                    </td>
                    <td>
                      <Input
                        type="number"
                        min={1}
                        className="text-right !py-[3px]"
                        value={l.qty}
                        onPaste={(e) => handlePaste(e, i, 'qty')}
                        onChange={(e) => patch(l.key, { qty: e.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        className="uppercase !py-[3px]"
                        value={l.batch_to}
                        onPaste={(e) => handlePaste(e, i, 'batch_to')}
                        onChange={(e) => patch(l.key, { batch_to: e.target.value })}
                        onBlur={() => fillDates(l)}
                      />
                    </td>
                    <td>
                      <Input
                        type="date"
                        className="!py-[3px]"
                        value={l.mfg_date}
                        onPaste={(e) => handlePaste(e, i, 'mfg_date')}
                        onChange={(e) => patch(l.key, { mfg_date: e.target.value })}
                      />
                    </td>
                    <td>
                      <Input
                        type="date"
                        className="!py-[3px]"
                        value={l.exp_date}
                        onPaste={(e) => handlePaste(e, i, 'exp_date')}
                        onChange={(e) =>
                          patch(l.key, {
                            exp_date: e.target.value,
                            // Manufacturing date diturunkan dari expired hanya
                            // bila operator belum mengisinya sendiri.
                            mfg_date: fillMfg(e.target.value, l.mfg_date),
                          })
                        }
                      />
                    </td>
                    <td>
                      <Input
                        className="!py-[3px]"
                        value={l.remarks}
                        onPaste={(e) => handlePaste(e, i, 'remarks')}
                        onChange={(e) => patch(l.key, { remarks: e.target.value })}
                      />
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        disabled={lines.length === 1}
                        onClick={() => {
                          setLines((ls) => ls.filter((x) => x.key !== l.key));
                          setChecks(null);
                        }}
                        title="Hapus baris"
                      >
                        <Trash2 size={12} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {checks && (
          <div className="p-3 border-t border-sap-border space-y-1.5">
            {errRows.length === 0 ? (
              <p className="text-2xs text-sap-oktext">
                {okRows.length} baris siap diposting.
                {okRows.some((c) => c.merges_into_existing) && (
                  <span className="text-sap-warntext">
                    {' '}
                    Sebagian digabung ke batch tujuan yang sudah ada di bin yang sama — quant-nya
                    menyatu, dan tanggal yang Anda isi akan berlaku untuk quant gabungan itu.
                  </span>
                )}
              </p>
            ) : (
              <>
                <p className="text-2xs font-medium text-sap-errtext flex items-center gap-1.5">
                  <AlertTriangle size={12} /> {errRows.length} baris belum bisa diposting:
                </p>
                <ul className="list-disc pl-4 text-xxs text-sap-errtext space-y-0.5">
                  {errRows.map((c) => (
                    <li key={c.line}>
                      Baris {c.line}: {c.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Panel>

      <Toolbar>
        <Button variant="primary" onClick={askPost} loading={busy || checking}>
          <Save size={13} /> Post
        </Button>
        <Button onClick={runCheck} loading={checking}>
          Periksa dulu
        </Button>
        <Button
          onClick={() => {
            setLines([emptyLine()]);
            setChecks(null);
            setStatus('Layar ubah batch direset', 'I');
          }}
        >
          <RotateCcw size={13} /> Reset
        </Button>
        <Separator />
        <span className="text-xxs text-sap-muted flex items-center gap-1.5">
          <Info size={12} />
          Movement 309 — stok keluar dari batch lama dan masuk ke batch baru di bin yang sama.
          Jumlah total tidak berubah. Membalikkannya: koreksi ke arah sebaliknya.
        </span>
      </Toolbar>

      <ConfirmDialog
        open={confirmOpen}
        title="Konfirmasi Ubah Batch"
        busy={busy}
        confirmLabel="Ya, posting"
        question="Nomor batch pada stok akan benar-benar diubah. Movement 309 tidak punya dokumen pembatalan — koreksinya dibalik dengan perubahan ke arah sebaliknya."
        details={[
          { label: 'Movement', value: '309 — Transfer batch ke batch' },
          { label: 'Baris', value: `${okRows.length} baris` },
          {
            label: 'Total qty',
            value: okRows.reduce((a, c) => a + c.qty, 0).toLocaleString('de-DE'),
          },
          {
            label: 'Perubahan',
            value:
              okRows
                .slice(0, 3)
                .map((c) => `${c.batch_from} → ${c.batch_to}`)
                .join(', ') + (okRows.length > 3 ? ` … +${okRows.length - 3}` : ''),
          },
        ]}
        onConfirm={submit}
        onCancel={() => setConfirmOpen(false)}
      />

      <datalist id="dl-bc-materials">
        {materials.map((m) => (
          <option key={m.id} value={m.material_code}>
            {m.description}
          </option>
        ))}
      </datalist>
      <datalist id="dl-bc-bins">
        {bins
          .filter((b) => !b.is_interim)
          .map((b) => (
            <option key={b.id} value={b.bin_code}>
              {b.zone_id} · {b.status}
            </option>
          ))}
      </datalist>
    </>
  );
}
