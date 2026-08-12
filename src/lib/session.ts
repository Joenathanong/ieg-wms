import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'sap_session';
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 jam

export interface SessionPayload {
  uid: string;
  username: string;
  name: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  /** izin membuka T-Code PDT (flag user DAN master switch sistem) */
  pdt: boolean;
  /**
   * Daftar T-Code yang diizinkan dari role otorisasi (PFCG).
   * null = tidak dibatasi (akses penuh sesuai role dasar).
   * Perubahan role berlaku pada login berikutnya (disematkan di token).
   */
  tcodes: string[] | null;
  /** nama role otorisasi (untuk tampilan) */
  auth_role?: string | null;
}

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET || 'dev-only-insecure-secret-change-me-32chars';
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

/** Edge-safe (dipakai juga oleh middleware). */
export async function verifySession(token?: string | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload?.uid) return null;
    return {
      uid: String(payload.uid),
      username: String(payload.username),
      name: String(payload.name),
      role: payload.role as SessionPayload['role'],
      pdt: payload.pdt === true,
      tcodes: Array.isArray(payload.tcodes) ? (payload.tcodes as string[]) : null,
      auth_role: typeof payload.auth_role === 'string' ? payload.auth_role : null,
    };
  } catch {
    return null;
  }
}
