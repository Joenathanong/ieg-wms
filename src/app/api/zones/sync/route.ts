import { requireAdmin } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { syncBinInterimFlags } from '@/lib/zonemaster';

export const dynamic = 'force-dynamic';

/**
 * POST /api/zones/sync — ZZONE "Sinkronkan bin".
 *
 * StorageBin.is_interim ditulis sekali saat bin dibuat, jadi bin lama tidak
 * ikut berubah ketika definisi zona diubah. Aksi ini menghitung ulang flag
 * tersebut untuk seluruh bin berdasarkan master zone.
 */
export async function POST() {
  return handle(async () => {
    await requireAdmin();
    const r = await syncBinInterimFlags();
    return ok(
      r,
      r.updated > 0
        ? `${r.updated} of ${r.scanned} storage bin(s) re-flagged from the zone master`
        : `All ${r.scanned} storage bin(s) already match the zone master`
    );
  });
}
