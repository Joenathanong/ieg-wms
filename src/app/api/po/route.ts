import { NextResponse } from 'next/server';
import { fetchAllPOLines } from '@/lib/gsheets/po';

export const revalidate = 60; // cache 60s

export async function GET() {
  try {
    const lines = await fetchAllPOLines();
    return NextResponse.json(lines);
  } catch (err) {
    console.error('PO fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch PO data' }, { status: 500 });
  }
}
