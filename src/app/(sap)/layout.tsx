import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/sap/Shell';

export const dynamic = 'force-dynamic';

export default async function SapLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  return <Shell user={session}>{children}</Shell>;
}
