import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requireWrite, HttpError } from '@/lib/auth';
import { handle, ok, cleanStr, toInt } from '@/lib/api';
import { confirmTrItem } from '@/lib/wms';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/tr/:id/confirm — LB12 konfirmasi put-away / picking.
 * Body: { lines: [{ item_id, qty, bin }], via_pdt?: boolean }
 *
 * Semua baris diproses dalam satu transaction. Bila TR bertipe PICK dan
 * seluruh item selesai, goods issue 201 otomatis diposting dari bin interim GI.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  return handle(async () => {
    const user = await requireWrite();
    const { id } = await ctx.params;
    const body = await req.json();
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (lines.length === 0) throw new HttpError(400, 'No confirmation lines were entered.');
    if (lines.length > 100) throw new HttpError(400, 'Maximum 100 confirmation lines per request.');

    const key = decodeURIComponent(id);
    const tr = await prisma.transferReq.findFirst({
      where: { OR: [{ id: key }, { tr_number: key.toUpperCase() }] },
      select: { id: true, tr_number: true },
    });
    if (!tr) throw new HttpError(404, 'Transfer requirement does not exist.');

    const result = await prisma.$transaction(
      async (tx) => {
        const out = [];
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          const item_id = cleanStr(l.item_id);
          const bin = cleanStr(l.bin).toUpperCase();
          if (!item_id) throw new HttpError(400, `Line ${i + 1}: item reference is missing.`);
          if (!bin) throw new HttpError(400, `Line ${i + 1}: storage bin is missing.`);

          const owned = await tx.transferReqItem.findFirst({ where: { id: item_id, tr_id: tr.id } });
          if (!owned)
            throw new HttpError(400, `Line ${i + 1}: item does not belong to ${tr.tr_number}.`);

          out.push(
            await confirmTrItem(tx, {
              item_id,
              qty: toInt(l.qty, `line ${i + 1} quantity`),
              bin,
              user_id: user.username,
              via_pdt: body.via_pdt === true,
            })
          );
        }
        return out;
      },
      { timeout: 30000, maxWait: 10000 }
    );

    const last = result[result.length - 1];
    const giBin = result.map((r) => r.ready_for_issue).filter(Boolean)[0] ?? null;

    let msg = `${result.length} line(s) confirmed for ${tr.tr_number}`;
    if (giBin) {
      msg += ` — picking completed, stock staged in ${giBin}. Post the goods issue in MIGO 201.`;
    } else if (last.tr_closed) {
      msg += ` — transfer requirement completed`;
    }

    return ok(
      { lines: result, tr_closed: last.tr_closed, ready_for_issue: giBin },
      msg
    );
  });
}
