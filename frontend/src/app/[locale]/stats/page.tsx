import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import {
  PublicStatsDashboard,
  PublicStatsPayload,
} from '@/components/stats/PublicStatsDashboard';

// ISR with 5-minute revalidation (#1396)
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const title = 'Platform Performance & Statistics | AgriFi';
  const description =
    'Explore public AgriFi platform metrics: total capital deployed, active deals, average yield, on-time delivery rate, and top commodities by volume.';

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: '/stats',
      siteName: 'AgriFi',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

function buildFallbackStats(): PublicStatsPayload {
  const now = new Date();
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthly = Array.from({ length: 12 }, (_, idx) => {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - idx), 1),
    );
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return {
      month,
      label,
      capital_deployed_usd: 0,
      deal_count: 0,
    };
  });

  return {
    total_deals_completed: 0,
    active_deals: 0,
    total_capital_deployed_usd: 0,
    avg_yield_pct: 0,
    on_time_delivery_rate: 0,
    top_5_commodities: [],
    monthly_capital_deployed: monthly,
    cache_ttl_seconds: 300,
    updated_at: now.toISOString(),
  };
}

async function fetchPublicStats(): Promise<PublicStatsPayload> {
  const backendUrl = (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001'
  ).replace(/\/+$/, '');

  try {
    const res = await fetch(`${backendUrl}/v1/public/stats`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return buildFallbackStats();
    }
    return (await res.json()) as PublicStatsPayload;
  } catch {
    return buildFallbackStats();
  }
}

export default async function PublicStatsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  setRequestLocale(locale);
  const stats = await fetchPublicStats();

  return <PublicStatsDashboard stats={stats} />;
}
