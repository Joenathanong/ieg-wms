'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client';

export interface PackagingLite {
  id: string;
  material_code: string;
  pack_code: string;
  su_type: string;
  zone_group: string | null;
  description: string;
  qty_per_unit: number;
  is_default: boolean;
}

export interface MaterialLite {
  id: string;
  material_code: string;
  description: string;
  uom: string;
  is_batch_managed: boolean;
  min_safety_stock: number;
  barcode_bpom?: string | null;
  barcode_produk?: string | null;
  kode_ocs?: string | null;
  fix_bin?: string | null;
  packagings?: PackagingLite[];
}

export interface BinLite {
  id: string;
  bin_code: string;
  zone_id: string;
  max_weight_kg: number;
  status: 'EMPTY' | 'OCCUPIED' | 'BLOCKED';
  is_interim: boolean;
}

export interface CostCenterLite {
  id: string;
  cost_center: string;
  description: string;
  department: string | null;
  is_active: boolean;
}

export interface ZoneLite {
  zone_code: string;
  label: string;
  zone_group: string;
  bin_pattern: string | null;
  is_interim: boolean;
  is_pick: boolean;
  is_active: boolean;
  bin_count: number;
}

/** Cache sederhana agar master data tidak di-fetch berulang antar halaman. */
let cacheMat: MaterialLite[] | null = null;
let cacheBin: BinLite[] | null = null;
let cacheZone: ZoneLite[] | null = null;
let cacheCc: CostCenterLite[] | null = null;

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

/**
 * Master zone (T-Code ZZONE). Dipisah dari useMasterData karena dipakai juga
 * oleh layar yang tidak butuh daftar material/bin.
 */
export function useZones(auto = true) {
  const [zones, setZones] = useState<ZoneLite[]>(cacheZone ?? []);
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    const r = await api<ZoneLite[]>('/api/zones');
    setLoading(false);
    if (r.ok && r.data) {
      cacheZone = r.data;
      setZones(r.data);
    }
    return r;
  }

  useEffect(() => {
    if (!auto) return;
    if (cacheZone) {
      setZones(cacheZone);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return { zones, loading, reload };
}

export function invalidateZones() {
  cacheZone = null;
}

/** Master cost center (T-Code KS01) — dipakai MIGO untuk goods issue 201. */
export function useCostCenters(auto = true) {
  const [costCenters, setCostCenters] = useState<CostCenterLite[]>(cacheCc ?? []);
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    const r = await api<CostCenterLite[]>('/api/costcenters');
    setLoading(false);
    if (r.ok && r.data) {
      cacheCc = r.data;
      setCostCenters(r.data);
    }
    return r;
  }

  useEffect(() => {
    if (!auto) return;
    if (cacheCc) {
      setCostCenters(cacheCc);
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return { costCenters, loading, reload };
}

export function invalidateCostCenters() {
  cacheCc = null;
}
