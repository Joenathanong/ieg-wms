import { PdtModuleGuard } from '@/components/pdt/ModuleGuard';

export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <PdtModuleGuard code="ZRF06" title="Inquiry">
      {children}
    </PdtModuleGuard>
  );
}
