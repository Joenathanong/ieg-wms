export interface ParsedBarcode {
  sapCode: string;
  batch: string;
  qtyCarton: number;
  description: string;
}

/**
 * Parse Zebra barcode string.
 * Format (separator ";"): SAP_CODE ; BATCH ; UNIT1 ; QTY ; UNIT2 ; [REF] ; [DESC] ; [LOCATION]
 * Fields after index 0–3 are optional.
 */
export function parseBarcode(raw: string): ParsedBarcode | null {
  if (!raw || !raw.trim()) return null;

  const parts = raw.split(';');
  if (parts.length < 4) return null;

  const sapCode    = parts[0].trim();
  const batch      = parts[1].trim();
  // parts[2] = unit type (CTN) — skip
  const qtyRaw     = parts[3].trim();
  const description = parts[6]?.trim() ?? '';

  // Strip trailing zeros after decimal: "12.00000" -> 12
  const qtyCarton = parseFloat(qtyRaw);
  if (isNaN(qtyCarton)) return null;

  return { sapCode, batch, qtyCarton: Math.round(qtyCarton), description };
}

/** Format qty carton: remove trailing decimal zeros */
export function formatCartonQty(qty: number): string {
  return Number.isInteger(qty) ? qty.toString() : qty.toFixed(2).replace(/\.?0+$/, '');
}
