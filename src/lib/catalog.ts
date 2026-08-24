'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './client';

/**
 * Katalog material untuk saran ketik, disimpan di localStorage.
 *
 * Bedanya dengan `useMasterData`:
 *  - muatannya ringkas (tanpa master pallet), jadi jauh lebih kecil;
 *  - bertahan setelah tab ditutup, bukan hanya selama tab hidup;
 *  - dipagari pemeriksaan versi, sehingga pembukaan layar berikutnya biasanya
 *    hanya menghasilkan satu query agregat di server.
 *
 * Kesegarannya tidak bergantung jadwal: begitu ada material ditambah atau
 * disunting, versinya berubah dan katalog ditarik ulang pada pembukaan layar
 * berikutnya di browser mana pun.
 */

export interface CatalogMaterial {
  material_code: string;
  description: string;
  uom: string;
  is_batch_managed: boolean;
  fix_bin: string | null;
}

interface Stored {
  version: string;
  materials: CatalogMaterial[];
}

const KEY = 'wms_material_catalog_v1';

/**
 * localStorage bisa gagal: mode penyamaran, kuota penuh, atau setelan browser
 * yang memblokir penyimpanan situs. Semua akses dibungkus supaya kegagalan
 * menyimpan hanya berarti "tidak ada cache", bukan layar yang rusak.
 */
function readStore(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    return Array.isArray(parsed?.materials) && typeof parsed?.version === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function writeStore(s: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* cache hanya mempercepat — kegagalan menyimpan diabaikan */
  }
}

/** Buang cache — dipakai bila katalog perlu ditarik ulang paksa. */
export function clearMaterialCatalog(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* diabaikan */
  }
}

export function useMaterialCatalog() {
  const [materials, setMaterials] = useState<CatalogMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  /** true = daftar datang dari cache, belum diperiksa ke server */
  const [fromCache, setFromCache] = useState(false);

  const sync = useCallback(async (force = false) => {
    const cached = force ? null : readStore();
    if (cached) {
      setMaterials(cached.materials);
      setFromCache(true);
    }

    setLoading(true);
    const r = await api<{ unchanged: boolean; version: string; materials: CatalogMaterial[] }>(
      `/api/materials/catalog${cached ? `?v=${encodeURIComponent(cached.version)}` : ''}`
    );
    setLoading(false);
    if (!r.ok || !r.data) return;

    setFromCache(false);
    if (r.data.unchanged) return;

    writeStore({ version: r.data.version, materials: r.data.materials });
    setMaterials(r.data.materials);
  }, []);

  useEffect(() => {
    void sync();
  }, [sync]);

  return { materials, loading, fromCache, refresh: () => sync(true) };
}
