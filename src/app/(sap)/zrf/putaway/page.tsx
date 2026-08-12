'use client';

import { TrScreen } from '@/components/pdt/TrScreen';

export default function ZrfPutawayPage() {
  return (
    <TrScreen
      type="PUTAWAY"
      code="ZRF02"
      title="Put-away"
      binLabel="Scan rak tujuan"
    />
  );
}
