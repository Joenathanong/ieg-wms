/**
 * Aturan konsensus hasil opname.
 *
 * Sebuah angka diterima ketika DUA hitungan independen sepakat — itu cara
 * opname dikerjakan di praktik nyata, dan jauh lebih dapat dipertanggung-
 * jawabkan daripada memilih ronde terakhir begitu saja.
 *
 * "Independen" di sini berarti dihitung ORANG YANG BERBEDA. Syarat ini bukan
 * formalitas: penugasan ulang boleh menempatkan orang yang sama dua kali (mis.
 * petugas terbatas di shift malam), dan bila ia mengulang kekeliruan yang sama
 * dua kali, kesepakatan yang terbentuk justru mengunci angka yang salah.
 *
 * File ini sengaja murni — tanpa Prisma, tanpa React — supaya server dan layar
 * memakai perhitungan yang sama persis dan tidak bisa menyimpang.
 */

export type LineStatus =
  /** belum ada ronde yang menghitung baris ini */
  | 'NOT_COUNTED'
  /** dihitung sekali dan cocok dengan catatan sistem — tidak ada yang perlu disesuaikan */
  | 'SETTLED_NO_DIFF'
  /** dua ronde oleh orang berbeda sepakat */
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

  // Cari dua ronde yang angkanya sama DAN penghitungnya berbeda.
  for (let i = 0; i < counted.length; i++) {
    for (let j = i + 1; j < counted.length; j++) {
      const a = counted[i];
      const b = counted[j];
      if (a.counted_qty !== b.counted_qty) continue;
      // Penghitung yang tidak tercatat tidak bisa dibuktikan berbeda, jadi
      // tidak dianggap sebagai hitungan independen kedua.
      if (!a.counted_by || !b.counted_by) continue;
      if (a.counted_by === b.counted_by) continue;
      return {
        status: 'CONSENSUS',
        final_round: b.round,
        final_qty: b.counted_qty,
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

/** Kunci baris opname: satu rak + satu material + satu batch. */
export function lineKey(bin_code: string, material_code: string, batch_number: string | null): string {
  return `${bin_code}|${material_code}|${batch_number ?? ''}`;
}
