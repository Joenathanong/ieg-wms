'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';

export interface MaterialLite {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  is_batch_managed: boolean;
  min_safety_stock: number;
}

export interface BinLite {
  id: string;
  bin_code: string;
  zone_id: string;
  max_weight_kg: number;
  status: 'EMPTY' | 'OCCUPIED' | 'BLOCKED';
}

/** Cache sederhana agar master data tidak di-fetch berulang antar halaman. */
let cacheMat: MaterialLite[] | null = null;
let cacheBin: BinLite[] | null = null;

export function useMasterData(auto = true) {
  const [materials, setMaterials] = useState<MaterialLite[]>(cacheMat ?? []);
  const [bins, setBins] = useState<BinLite[]>(cacheBin ?? []);
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    const [m, b] = await Promise.all([
      api<MaterialLite[]>('/api/materials?limit=2000'),
      api<BinLite[]>('/api/bins?limit=5000'),
    ]);
    if (m.ok && m.data) {
      cacheMat = m.data;
      setMaterials(m.data);
    }
    if (b.ok && b.data) {
      cacheBin = b.data;
      setBins(b.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!auto) return;
    if (cacheMat && cacheBin) {
      setMaterials(cacheMat);
      setBins(cacheBin);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return { materials, bins, loading, reload };
}

export function invalidateMasterData() {
  cacheMat = null;
  cacheBin = null;
}
