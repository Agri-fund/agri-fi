import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PublicUserProfile {
  id: string;
  role: string;
  country: string;
  kycStatus: 'pending' | 'verified' | 'rejected' | 'expired';
  walletAddress: string | null;
  creditScore: number | null;
  createdAt: string;
  dealsCompleted: number;
  activeDeals: number;
  reputationScore: number;
  onTimeRepaymentRate: number;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchPublicProfile(id: string): Promise<PublicUserProfile | null> {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  try {
    const res = await fetch(
      `${appUrl}/api/users/${encodeURIComponent(id)}/public-profile`,
      { next: { revalidate: 900 } }, // 15-min ISR matches Redis TTL
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Unexpected status ${res.status}`);
    return res.json();
  } catch {
    return null;
  }
}

// ─── Metadata / Open Graph ────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: { id: string; locale: string };
}): Promise<Metadata> {
  const profile = await fetchPublicProfile(params.id);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://agri-fi.app';

  if (!profile) {
    return { title: 'Farmer Not Found | AgriFi' };
  }

  const name = `Farmer from ${profile.country}`;
  const title = `${name} | AgriFi`;
  const description =
    `${profile.dealsCompleted} completed deal${profile.dealsCompleted !== 1 ? 's' : ''}, ` +
    `reputation score ${profile.reputationScore}/100. ` +
    `KYC status: ${profile.kycStatus}. Member since ${new Date(profile.createdAt).getFullYear()}.`;

  const pageUrl = `${appUrl}/${params.locale}/farmers/${profile.id}`;
  const ogImage = `${appUrl}/og-default.png`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'AgriFi',
      images: [{ url: ogImage, width: 1200, height: 630, alt: name }],
      type: 'profile',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
    alternates: {
      canonical: pageUrl,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a Tailwind colour class set for a given KYC status.
 */
function kycBadgeClass(status: PublicUserProfile['kycStatus']) {
  switch (status) {
    case 'verified':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'pending':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'rejected':
    case 'expired':
      return 'bg-red-100 text-red-800 border-red-200';
  }
}

/**
 * Maps a 0–100 reputation score to a colour class.
 */
function reputationColour(score: number) {
  if (score >= 70) return 'text-emerald-700';
  if (score >= 40) return 'text-amber-600';
  return 'text-red-600';
}

function reputationRingColour(score: number) {
  if (score >= 70) return 'stroke-emerald-500';
  if (score >= 40) return 'stroke-amber-400';
  return 'stroke-red-500';
}

function reputationLabel(score: number, t: (k: string) => string) {
  if (score >= 80) return t('reputation.excellent');
  if (score >= 60) return t('reputation.good');
  if (score >= 40) return t('reputation.fair');
  return t('reputation.poor');
}

/** Circular SVG gauge for the reputation score. */
function ReputationGauge({ score }: { score: number }) {
  const r = 36;
  const circumference = 2 * Math.PI * r;
  const progress = circumference - (score / 100) * circumference;
  const ringColour = reputationRingColour(score);

  return (
    <svg
      width="96"
      height="96"
      viewBox="0 0 96 96"
      aria-hidden="true"
      className="rotate-[-90deg]"
    >
      {/* Track */}
      <circle cx="48" cy="48" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
      {/* Progress */}
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={progress}
        className={`${ringColour} transition-all duration-700`}
      />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function FarmerProfilePage({
  params,
}: {
  params: { id: string; locale: string };
}) {
  const [profile, t] = await Promise.all([
    fetchPublicProfile(params.id),
    getTranslations('farmerProfile'),
  ]);

  if (!profile) {
    notFound();
  }

  const memberSince = new Date(profile.createdAt).toLocaleDateString('en', {
    month: 'long',
    year: 'numeric',
  });

  const repLabel = reputationLabel(profile.reputationScore, t);
  const repColour = reputationColour(profile.reputationScore);

  // Compute FICO-like tier label from creditScore
  const creditTier =
    profile.creditScore !== null
      ? profile.creditScore >= 700
        ? t('creditTier.excellent')
        : profile.creditScore >= 500
          ? t('creditTier.good')
          : t('creditTier.fair')
      : null;

  // Active deals — build placeholder cards (real data fetched by deal count)
  // We only have counts here; for full card detail a separate endpoint would
  // be needed. We render count-based summary cards instead.
  const activeDealCards = Array.from({ length: profile.activeDeals }, (_, i) => i);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Nav ── */}
      <nav className="glass sticky top-0 z-20 border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 font-black text-slate-900">
            <span className="text-xl" aria-hidden="true">🌾</span>
            <span>AgriFi</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={`/${params.locale}/marketplace`}
              className="btn-secondary text-sm px-4 py-2"
            >
              {t('nav.marketplace')}
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* ── Hero ── */}
        <section
          aria-labelledby="farmer-name-heading"
          className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden"
        >
          {/* Cover banner */}
          <div
            className="h-28 sm:h-36 bg-gradient-to-br from-emerald-500 to-teal-600"
            aria-hidden="true"
          />

          <div className="px-6 pb-6 -mt-12 sm:-mt-14 flex flex-col sm:flex-row sm:items-end sm:gap-6">
            {/* Avatar */}
            <div
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-white bg-emerald-100 flex items-center justify-center text-3xl sm:text-4xl shrink-0 shadow"
              role="img"
              aria-label={t('hero.avatarAlt', { country: profile.country })}
            >
              🧑‍🌾
            </div>

            <div className="mt-4 sm:mt-0 flex-1 min-w-0">
              <h1
                id="farmer-name-heading"
                className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight truncate"
              >
                {t('hero.title', { country: profile.country })}
              </h1>

              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                {/* Location */}
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>{profile.country}</span>
                </span>

                {/* Member since */}
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>{t('hero.memberSince', { date: memberSince })}</span>
                </span>

                {/* Role */}
                <span className="capitalize">{profile.role}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Verification badges ── */}
        <section aria-labelledby="verification-heading">
          <h2 id="verification-heading" className="sr-only">{t('verification.heading')}</h2>
          <div className="flex flex-wrap gap-3">
            {/* KYC badge */}
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${kycBadgeClass(profile.kycStatus)}`}
              role="status"
              aria-label={t('verification.kycLabel', { status: profile.kycStatus })}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                {profile.kycStatus === 'verified' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
              </svg>
              {t(`verification.kyc.${profile.kycStatus}`)}
            </div>

            {/* Wallet badge */}
            {profile.walletAddress && (
              <div
                className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800"
                role="status"
                aria-label={t('verification.walletConnected')}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                {t('verification.walletConnected')}
                <code className="font-mono text-xs opacity-70">{profile.walletAddress}</code>
              </div>
            )}

            {/* Deals count badge */}
            <div
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700"
              role="status"
              aria-label={t('verification.dealsCount', { count: profile.dealsCompleted })}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              {t('verification.dealsCount', { count: profile.dealsCompleted })}
            </div>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          <div className="space-y-8">
            {/* ── Active deals ── */}
            <section aria-labelledby="active-deals-heading">
              <h2
                id="active-deals-heading"
                className="text-xl font-black text-slate-900 mb-4"
              >
                {t('activeDeals.heading')}
                {profile.activeDeals > 0 && (
                  <span className="ml-2 rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-bold text-emerald-800">
                    {profile.activeDeals}
                  </span>
                )}
              </h2>

              {activeDealCards.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
                  <p className="text-3xl mb-2" aria-hidden="true">🌱</p>
                  <p className="text-slate-500 text-sm">{t('activeDeals.none')}</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {activeDealCards.map((i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                      aria-label={t('activeDeals.cardAriaLabel', { number: i + 1 })}
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-2xl" aria-hidden="true">🌾</span>
                        <div>
                          <p className="font-bold text-slate-900 text-sm">
                            {t('activeDeals.activeDeal')} #{i + 1}
                          </p>
                          <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                            {t('activeDeals.statusActive')}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400">
                        {t('activeDeals.viewOnMarketplace')}
                      </p>
                      <Link
                        href={`/${params.locale}/marketplace`}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
                      >
                        {t('activeDeals.browseLink')} →
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Completed deals table ── */}
            <section aria-labelledby="completed-deals-heading">
              <h2
                id="completed-deals-heading"
                className="text-xl font-black text-slate-900 mb-4"
              >
                {t('completedDeals.heading')}
              </h2>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('completedDeals.tableCaption')}</caption>
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th scope="col" className="px-5 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wide">
                        {t('completedDeals.colDeal')}
                      </th>
                      <th scope="col" className="px-5 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wide">
                        {t('completedDeals.colStatus')}
                      </th>
                      <th scope="col" className="px-5 py-3 text-right font-semibold text-slate-600 text-xs uppercase tracking-wide">
                        {t('completedDeals.colRepayment')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.dealsCompleted === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-5 py-10 text-center text-slate-400 text-sm">
                          {t('completedDeals.none')}
                        </td>
                      </tr>
                    ) : (
                      Array.from({ length: profile.dealsCompleted }, (_, i) => (
                        <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-3 text-slate-800 font-medium">
                            {t('completedDeals.dealLabel', { number: i + 1 })}
                          </td>
                          <td className="px-5 py-3">
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                              {t('completedDeals.statusCompleted')}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className="text-emerald-700 font-bold">
                              {Math.round(profile.onTimeRepaymentRate * 100)}%
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* ── Sidebar: reputation + stats ── */}
          <aside className="space-y-6" aria-labelledby="reputation-heading">
            {/* Reputation score card */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2
                id="reputation-heading"
                className="text-lg font-black text-slate-900 mb-4"
              >
                {t('reputation.heading')}
              </h2>

              {/* Gauge + score */}
              <div className="flex flex-col items-center gap-2">
                <div className="relative" role="img" aria-label={t('reputation.gaugeAriaLabel', { score: profile.reputationScore })}>
                  <ReputationGauge score={profile.reputationScore} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-2xl font-black tabular-nums ${repColour}`}>
                      {profile.reputationScore}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">/100</span>
                  </div>
                </div>

                {/* Tooltip-style label */}
                <div className="text-center">
                  <p className={`text-sm font-bold ${repColour}`}>{repLabel}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {t('reputation.tooltip')}
                  </p>
                </div>
              </div>

              {/* Credit score (FICO-like) */}
              {profile.creditScore !== null && (
                <div className="mt-5 rounded-xl bg-slate-50 border border-slate-100 p-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                      {t('reputation.creditScore')}
                    </p>
                    <p className="text-xl font-black text-slate-800 tabular-nums">
                      {profile.creditScore}
                    </p>
                  </div>
                  {creditTier && (
                    <span className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600 shadow-sm">
                      {creditTier}
                    </span>
                  )}
                </div>
              )}

              {/* On-time repayment rate */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                    {t('reputation.onTimeRate')}
                  </p>
                  <span className="text-sm font-bold text-slate-700">
                    {Math.round(profile.onTimeRepaymentRate * 100)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(profile.onTimeRepaymentRate * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                    style={{ width: `${Math.round(profile.onTimeRepaymentRate * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Stats summary */}
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-black text-slate-900">{t('stats.heading')}</h2>

              <dl className="space-y-3">
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">{t('stats.dealsCompleted')}</dt>
                  <dd className="text-sm font-bold text-slate-900 tabular-nums">{profile.dealsCompleted}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">{t('stats.activeDeals')}</dt>
                  <dd className="text-sm font-bold text-slate-900 tabular-nums">{profile.activeDeals}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">{t('stats.memberSince')}</dt>
                  <dd className="text-sm font-bold text-slate-900">{memberSince}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-sm text-slate-500">{t('stats.country')}</dt>
                  <dd className="text-sm font-bold text-slate-900">{profile.country}</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
