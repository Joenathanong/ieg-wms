/**
 * Aturan konsensus hasil opname.
 *
 * Sebuah angka diterima ketika TIGA hitungan independen menghasilkan angka yang
 * sama. Ronde boleh berjalan lebih dari tiga kali: begitu ada satu angka yang
 * muncul tiga kali, angka itulah yang dianggap benar — bukan ronde terakhir,
 * dan bukan pula suara terbanyak dari angka yang belum mencapai tiga.
 *
 * "Independen" di sini berarti dihitung ORANG YANG BERBEDA. Syarat ini bukan
 * formalitas: penugasan ulang boleh menempatkan orang yang sama dua kali (mis.
 * petugas terbatas di shift malam), dan bila ia mengulang kekeliruan yang sama,
 * pengulangan itu tidak menambah bukti apa pun. Karena itu yang dihitung adalah
 * jumlah ORANG yang sepakat, bukan jumlah hitungan.
 *
 * File ini sengaja murni — tanpa Prisma, tanpa React — supaya server dan layar
 * memakai perhitungan yang sama persis dan tidak bisa menyimpang.
 */

/**
 * Berapa penghitung berbeda yang harus menghasilkan angka sama.
 *
 * Dijadikan konstanta bernama supaya ambangnya bisa diubah di satu tempat bila
 * kebijakan gudang berubah — bukan tersebar sebagai angka 3 di dalam logika.
 */
export const AGREEMENT_REQUIRED = 3;

export type LineStatus =
  /** belum ada ronde yang menghitung baris ini */
  | 'NOT_COUNTED'
  /** dihitung sekali dan cocok dengan catatan sistem — tidak ada yang perlu disesuaikan */
  | 'SETTLED_NO_DIFF'
  /** cukup banyak penghitung berbeda menghasilkan angka yang sama */
  | 'CONSENSUS'
  /** sudah dihitung, belum ada dua ronde yang sepakat */
  | 'UNRESOLVED'
  /** ditetapkan manual oleh supervisor */
  | 'MANUAL';

export interface RoundValue {
  round: number;
  counted_qty: number | null;
  counted_by: string | null;
}

export interface LineVerdict {
  status: LineStatus;
  /** ronde yang angkanya dipakai; null bila belum ada */
  final_round: number | null;
  final_qty: number | null;
  /** true bila baris ini perlu dihitung ulang di ronde berikutnya */
  needs_recount: boolean;
}

/**
 * Tentukan nasib satu baris dari seluruh hasil rondenya.
 *
 * `manual` diisi bila supervisor sudah menetapkan angkanya sendiri — keputusan
 * manusia selalu menang atas perhitungan otomatis di sini.
 */
export function judgeLine(
  book_qty: number,
  rounds: readonly RoundValue[],
  manual?: { round: number; qty: number } | null
): LineVerdict {
  if (manual) {
    return { status: 'MANUAL', final_round: manual.round, final_qty: manual.qty, needs_recount: false };
  }

  const counted = rounds
    .filter((r) => r.counted_qty !== null)
    .sort((a, b) => a.round - b.round);

  if (counted.length === 0) {
    return { status: 'NOT_COUNTED', final_round: null, final_qty: null, needs_recount: true };
  }

  /**
   * Telusuri ronde dari yang paling awal, catat siapa saja yang menghasilkan
   * tiap angka. Begitu satu angka mencapai jumlah penghitung berbeda yang
   * disyaratkan, ronde itulah yang menutup perkara.
   *
   * Penghitung yang sama tidak dihitung dua kali untuk angka yang sama:
   * mengulang hitungan sendiri bukan bukti tambahan.
   */
  const voters = new Map<number, Set<string>>();
  for (const r of counted) {
    if (r.counted_qty === null) continue;
    // Penghitung yang tidak tercatat tidak bisa dibuktikan berbeda dari yang
    // lain, jadi tidak bisa ikut menyumbang bukti.
    if (!r.counted_by) continue;
    let set = voters.get(r.counted_qty);
    if (!set) {
      set = new Set<string>();
      voters.set(r.counted_qty, set);
    }
    set.add(r.counted_by);
    if (set.size >= AGREEMENT_REQUIRED) {
      return {
        status: 'CONSENSUS',
        final_round: r.round,
        final_qty: r.counted_qty,
        needs_recount: false,
      };
    }
  }

  /**
   * Hitungan tunggal yang sama dengan catatan sistem dianggap selesai.
   *
   * Tidak ada penyesuaian yang akan diposting untuk baris ini, jadi memaksa
   * ronde kedua hanya menghabiskan tenaga tanpa mengubah apa pun. Ronde ulang
   * dicadangkan untuk baris yang memang berselisih.
   */
  if (counted.length === 1 && counted[0].counted_qty === book_qty) {
    return {
      status: 'SETTLED_NO_DIFF',
      final_round: counted[0].round,
      final_qty: counted[0].counted_qty,
      needs_recount: false,
    };
  }

  return { status: 'UNRESOLVED', final_round: null, final_qty: null, needs_recount: true };
}

/**
 * Ringkasan dukungan tiap angka — dipakai layar untuk menampilkan
 * "8 sudah 2 dari 3 orang" tanpa menghitung ulang aturannya sendiri.
 */
export function tally(rounds: readonly RoundValue[]): { qty: number; voters: string[] }[] {
  const m = new Map<number, Set<string>>();
  for (const r of rounds) {
    if (r.counted_qty === null || !r.counted_by) continue;
    let set = m.get(r.counted_qty);
    if (!set) {
      set = new Set<string>();
      m.set(r.counted_qty, set);
    }
    set.add(r.counted_by);
  }
  return [...m.entries()]
    .map(([qty, set]) => ({ qty, voters: [...set] }))
    .sort((a, b) => b.voters.length - a.voters.length || a.qty - b.qty);
}

/** Kunci baris opname: satu rak + satu material + satu batch. */
export function lineKey(bin_code: string, material_code: string, batch_number: string | null): string {
  return `${bin_code}|${material_code}|${batch_number ?? ''}`;
}
