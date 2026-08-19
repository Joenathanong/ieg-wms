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

/**
 * Nilai cadangan untuk pengembangan lokal saja. Nilainya sengaja ditulis
 * terang-terangan supaya jelas bahwa siapa pun yang membaca repositori ini
 * bisa memakainya — karena itu di production nilai ini DITOLAK.
 */
const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret-change-me-32chars';

/**
 * Kunci penandatangan session.
 *
 * Di production, AUTH_SECRET yang hilang, terlalu pendek, atau masih memakai
 * nilai cadangan akan MENGGAGALKAN pembuatan dan pemeriksaan session — bukan
 * diam-diam memakai nilai cadangan. Bedanya besar: dengan nilai cadangan,
 * siapa pun yang tahu isinya bisa menempa token ADMIN, dan tidak akan ada
 * satu pun gejala yang terlihat. Lebih baik aplikasi menolak login sama
 * sekali (langsung ketahuan saat deploy) daripada berjalan mulus tanpa
 * pengamanan sama sekali.
 */
function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET ?? '';
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && (s.length < 32 || s === DEV_FALLBACK_SECRET)) {
    throw new Error(
      'AUTH_SECRET belum diisi dengan benar di lingkungan production. ' +
        'Isi environment variable AUTH_SECRET dengan string acak minimal 32 karakter: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"'
    );
  }

  return new TextEncoder().encode(s || DEV_FALLBACK_SECRET);
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
