import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { HttpError } from './auth';

export type SapMessageType = 'S' | 'E' | 'W' | 'I';

export interface SapResponse<T = unknown> {
  ok: boolean;
  /** Pesan ala status bar SAP */
  message: string;
  msgType: SapMessageType;
  data?: T;
}

export function ok<T>(data: T, message = 'Operation completed successfully'): NextResponse {
  return NextResponse.json<SapResponse<T>>({ ok: true, message, msgType: 'S', data });
}

export function fail(message: string, status = 400, msgType: SapMessageType = 'E'): NextResponse {
  return NextResponse.json<SapResponse>({ ok: false, message, msgType }, { status });
}

/**
 * Catat error teknis ke konsol server.
 *
 * Tanpa ini `handle()` menelan seluruh error database menjadi satu baris pesan
 * di status bar, sehingga terminal `npm run dev` tidak menampilkan apa pun dan
 * masalahnya sulit dilacak. HttpError sengaja tidak dicatat karena itu memang
 * penolakan bisnis yang normal (validasi, hak akses, stok kurang).
 */
function logServerError(e: unknown): void {
  if (e instanceof HttpError) return;

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(
      `\n[WMS] Prisma ${e.code}` +
        (e.meta ? ` · meta=${JSON.stringify(e.meta)}` : '') +
        `\n${e.message}\n${e.stack ?? ''}\n`
    );
    return;
  }

  console.error('\n[WMS] Unhandled error:', e);
}

/** Nama field dari meta error Prisma (bentuknya berbeda-beda antar kode error). */
function metaFields(meta: unknown): string {
  const m = meta as Record<string, unknown> | undefined;
  const raw = m?.constraint ?? m?.target ?? m?.field_name;
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const f = (raw as { fields?: unknown }).fields;
    if (Array.isArray(f)) return f.join(', ');
  }
  return '';
}

/** Bungkus handler agar semua error menjadi pesan ala SAP. */
export function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return fn().catch((e: unknown) => {
    logServerError(e);

    if (e instanceof HttpError) return fail(e.message, e.status);
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') return fail('Entry already exists (duplicate key).', 409);
      if (e.code === 'P2025') return fail('Record not found in database.', 404);
      if (e.code === 'P2011') {
        const f = metaFields(e.meta);
        return fail(
          `Mandatory field is empty${f ? `: ${f}` : ''} (P2011). ` +
            `Detail lengkap tercatat di konsol server.`,
          400
        );
      }
      return fail(`Database error ${e.code}: ${e.message.split('\n').pop()}`, 400);
    }
    if (e instanceof Prisma.PrismaClientInitializationError) {
      return fail('Cannot connect to database. Check DATABASE_URL.', 500);
    }
    const msg = e instanceof Error ? e.message : 'Unexpected system error';
    return fail(msg, 500);
  });
}

/** Parser angka aman untuk input dari Excel / form. */
export function toInt(v: unknown, field = 'value'): number {
  const n = Number(String(v ?? '').toString().replace(/[, ]/g, ''));
  if (!Number.isFinite(n)) throw new HttpError(400, `Field ${field} is not a valid number.`);
  return Math.trunc(n);
}

/** Excel serial date / string tanggal -> Date | null */
export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    // serial date Excel (basis 1899-12-30)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  // dukung dd.mm.yyyy dan dd/mm/yyyy (format SAP)
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function cleanStr(v: unknown): string {
  return String(v ?? '').trim();
}

/** Batch number kosong -> null (untuk material non-batch) */
export function normBatch(v: unknown): string | null {
  const s = cleanStr(v).toUpperCase();
  return s === '' ? null : s;
}
