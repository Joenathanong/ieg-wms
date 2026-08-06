'use client';

export interface SapResult<T = any> {
  ok: boolean;
  message: string;
  msgType: 'S' | 'E' | 'W' | 'I';
  data?: T;
}

/** Wrapper fetch yang selalu mengembalikan bentuk SapResult. */
export async function api<T = any>(url: string, init?: RequestInit): Promise<SapResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, message: `Invalid server response (HTTP ${res.status})`, msgType: 'E' };
    }
    if (!res.ok) {
      return {
        ok: false,
        message: json.message ?? `Request failed (HTTP ${res.status})`,
        msgType: 'E',
      };
    }
    return json as SapResult<T>;
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Network error — connection to server lost',
      msgType: 'E',
    };
  }
}

export function post<T = any>(url: string, body: unknown) {
  return api<T>(url, { method: 'POST', body: JSON.stringify(body) });
}

export function patch<T = any>(url: string, body: unknown) {
  return api<T>(url, { method: 'PATCH', body: JSON.stringify(body) });
}

export function del<T = any>(url: string) {
  return api<T>(url, { method: 'DELETE' });
}

export function qs(params: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Format tanggal ala SAP: dd.mm.yyyy */
export function fmtDate(v?: string | Date | null): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function fmtDateTime(v?: string | Date | null): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${fmtDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtNum(n?: number | null): string {
  if (n === null || n === undefined) return '';
  return n.toLocaleString('de-DE');
}

/** yyyy-mm-dd untuk <input type="date"> */
export function toInputDate(v?: string | Date | null): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}
