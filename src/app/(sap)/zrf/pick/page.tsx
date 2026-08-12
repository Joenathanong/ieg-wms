'use client';

import { TrScreen } from '@/components/pdt/TrScreen';

export default function ZrfPickPage() {
  return (
    <TrScreen
      type="PICK"
      code="ZRF03"
      title="Picking"
      binLabel="Scan rak asal (ambil dari)"
    />
  );
}
