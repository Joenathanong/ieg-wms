import { PdtModuleGuard } from '@/components/pdt/ModuleGuard';

export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <PdtModuleGuard code="ZRF07" title="Goods Issue">
      {children}
    </PdtModuleGuard>
  );
}
