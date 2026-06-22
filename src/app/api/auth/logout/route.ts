import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  cookies().delete('wms_session');
  return NextResponse.json({ status: 'ok' });
}
