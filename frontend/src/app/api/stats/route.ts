import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

const FALLBACK_STATS = {
  totalFunded: 2840000,
  totalFundedFormatted: '$2.8M+',
  activeFarmers: 384,
  activeFarmersFormatted: '380+',
  dealsCompleted: 142,
  dealsCompletedFormatted: '140+',
  avgReturn: 14.8,
  avgReturnFormatted: '14.8%',
  updatedAt: new Date().toISOString(),
  source: 'fallback',
};

export async function GET() {
  const backendUrl =
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3000';

  try {
    const res = await fetch(`${backendUrl}/config/stats`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      return NextResponse.json(FALLBACK_STATS, {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      });
    }

    const data = await res.json();
    return NextResponse.json(data, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch {
    return NextResponse.json(FALLBACK_STATS, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  }
}
