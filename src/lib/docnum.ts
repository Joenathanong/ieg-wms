import type { Prisma } from '@prisma/client';

/**
 * Number Range Object ala SAP.
 * Dipanggil DI DALAM $transaction supaya nomor dokumen tidak pernah dobel
 * (atomic increment pada baris document_counters).
 *
 * Counter disimpan sebagai Int biasa (aman untuk INT4), nomor dokumen
 * dibentuk dengan offset agar terlihat seperti nomor dokumen SAP.
 */
export const NR = {
  /** Material Document (MIGO / 561 / 701 / 702) -> 5000000101, 5000000102, ... */
  MATDOC: { key: 'MATDOC', start: 100, format: (n: number) => String(5_000_000_000 + n) },
  /** Transfer Order — konfirmasi 301 (LT01 / LT10 / LB12) -> 0000000101, ... */
  TRDOC: { key: 'TRDOC', start: 100, format: (n: number) => String(n).padStart(10, '0') },
  /** Transfer Requirement (LB10 / LB12)         -> TR00000101, ...              */
  TRREQ: { key: 'TRREQ', start: 100, format: (n: number) => 'TR' + String(n).padStart(8, '0') },
  /** Physical Inventory Document (LI01N)        -> 100000101, ...                */
  PIDOC: { key: 'PIDOC', start: 100, format: (n: number) => String(100_000_000 + n) },
} as const;

export type NRKey = keyof typeof NR;

export async function nextDocNumber(
  tx: Prisma.TransactionClient,
  which: NRKey
): Promise<string> {
  const def = NR[which];
  const row = await tx.documentCounter.upsert({
    where: { key: def.key },
    create: { key: def.key, last_num: def.start + 1 },
    update: { last_num: { increment: 1 } },
    select: { last_num: true },
  });
  return def.format(row.last_num);
}
