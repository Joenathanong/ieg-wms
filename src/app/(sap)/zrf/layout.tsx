import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ZrfLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.pdt) {
    return (
      <div className="mx-auto w-full max-w-[520px] sap-panel p-4 text-2xs text-sap-errtext">
        Terminal PDT tidak aktif untuk user <b>{session.username}</b>. Hubungi administrator (SU01) atau
        periksa master switch di ZSET.
      </div>
    );
  }
  return <div className="py-2">{children}</div>;
}
