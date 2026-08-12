import 'server-only';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, type SessionPayload } from './session';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Ambil session dari cookie (server component / route handler). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function requireUser(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) throw new HttpError(401, 'Session expired. Please log on again.');
  return s;
}

export async function requireAdmin(): Promise<SessionPayload> {
  const s = await requireUser();
  if (s.role !== 'ADMIN') throw new HttpError(403, 'No authorization for this transaction (S_TCODE).');
  return s;
}

export async function requireWrite(): Promise<SessionPayload> {
  const s = await requireUser();
  if (s.role === 'VIEWER') throw new HttpError(403, 'Display-only user. Posting not allowed.');
  return s;
}

/**
 * Untuk endpoint terminal PDT (ZRF).
 * Butuh flag pdt pada session — flag itu sudah menggabungkan izin per user
 * (users.pdt_enabled) dan master switch sistem (ZSET / PDT_ENABLED).
 */
export async function requirePdt(): Promise<SessionPayload> {
  const s = await requireWrite();
  if (!s.pdt)
    throw new HttpError(403, 'PDT terminal is not enabled for this user. Contact your administrator (SU01).');
  return s;
}
