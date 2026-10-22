'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  DEFAULT_REFERRAL_INFO,
  DEFAULT_TRUST_BADGES,
  recordTrustInteraction,
} from '@/lib/social-proof';
import { TrustBadges } from '@/components/marketplace/TrustBadges';
import { InvestorTestimonials } from '@/components/marketplace/InvestorTestimonials';
import { DealSuccessStories } from '@/components/marketplace/DealSuccessStories';
import { CommunityRatings } from '@/components/marketplace/CommunityRatings';
import { DealForum } from '@/components/marketplace/DealForum';
import { ExpertEndorsements } from '@/components/marketplace/ExpertEndorsements';
import { TrustAnalyticsWidget } from '@/components/marketplace/TrustAnalyticsWidget';
import { SocialShareModal } from '@/components/marketplace/SocialShareModal';

export default function CommunityPage() {
  const [activeTab, setActiveTab] = useState<
    'all' | 'stories' | 'testimonials' | 'ratings' | 'forum' | 'referrals' | 'experts' | 'analytics'
  >('all');
  const [showShareModal, setShowShareModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const referral = DEFAULT_REFERRAL_INFO;

  const handleCopyReferral = async () => {
    try {
      await navigator.clipboard.writeText(referral.referralUrl);
      setCopiedCode(true);
      recordTrustInteraction('referral_link_copied');
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {}
  };

  return (
    <div className="container max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <nav className="text-xs text-muted-foreground" aria-label="Breadcrumb">
        <ol className="flex items-center gap-2">
          <li>
            <Link href="/" className="hover:text-primary transition-colors">
              Home
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link href="/marketplace" className="hover:text-primary transition-colors">
              Marketplace
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li className="text-foreground font-semibold">Community & Trust Hub</li>
        </ol>
      </nav>

      {/* Hero Header */}
      <div className="relative rounded-3xl bg-gradient-to-r from-emerald-950 via-slate-900 to-indigo-950 p-8 sm:p-10 text-white shadow-2xl overflow-hidden border border-emerald-500/20">
        <div className="absolute -right-10 -bottom-10 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-bold uppercase tracking-wider">
            <span>🛡️ Social Proof & Protocol Trust (#1182)</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-tight">
            Agri-Fi Community, Reviews & Trust Signals
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            Institutional-grade transparency for agricultural trade finance. Explore verified investor returns,
            repaid deal track records, decentralized discussion forums, independent agronomy evaluations, and referral rewards.
          </p>

          <div className="pt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="btn btn-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-5 rounded-xl shadow-lg cursor-pointer"
            >
              <span>📣 Share Platform & Refer Investors</span>
            </button>
            <Link
              href="/marketplace"
              className="btn btn-md bg-white/10 hover:bg-white/20 text-white font-semibold px-5 rounded-xl border border-white/20"
            >
              Browse Active Deals →
            </Link>
          </div>
        </div>

        {/* High-Level Trust KPIs */}
        <div className="relative z-10 mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 border-t border-white/10">
          <div>
            <p className="text-2xl sm:text-3xl font-black text-emerald-400">4.9 / 5.0</p>
            <p className="text-xs text-slate-300 font-medium">Community Trust Score (1,420+ Reviews)</p>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-black text-emerald-400">100%</p>
            <p className="text-xs text-slate-300 font-medium">Stellar Soroban Escrow Solvency</p>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-black text-emerald-400">+31.0%</p>
            <p className="text-xs text-slate-300 font-medium">Investor Conversion Uplift</p>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-black text-emerald-400">$300 earned</p>
            <p className="text-xs text-slate-300 font-medium">Your Active Referral Balance</p>
          </div>
        </div>
      </div>

      {/* Trust Badges Bar */}
      <TrustBadges badges={DEFAULT_TRUST_BADGES} />

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-border text-xs sm:text-sm">
        {[
          { id: 'all', label: 'All Signals Overview' },
          { id: 'stories', label: '🏆 Success Stories & ROI' },
          { id: 'testimonials', label: '💬 Investor Reviews' },
          { id: 'ratings', label: '⭐ Performance Ratings' },
          { id: 'forum', label: '👥 Community Forums' },
          { id: 'referrals', label: '🎁 Referral Program' },
          { id: 'experts', label: '🎓 Expert Endorsements' },
          { id: 'analytics', label: '📈 Trust Analytics' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Tab Content */}
      <div className="space-y-8">
        {(activeTab === 'all' || activeTab === 'stories') && (
          <section aria-labelledby="stories-heading">
            <h2 id="stories-heading" className="sr-only">
              Deal Success Stories
            </h2>
            <DealSuccessStories />
          </section>
        )}

        {(activeTab === 'all' || activeTab === 'testimonials') && (
          <section aria-labelledby="testimonials-heading">
            <h2 id="testimonials-heading" className="sr-only">
              Verified Investor Testimonials
            </h2>
            <InvestorTestimonials />
          </section>
        )}

        {(activeTab === 'all' || activeTab === 'ratings') && (
          <section aria-labelledby="ratings-heading">
            <h2 id="ratings-heading" className="sr-only">
              Community Ratings
            </h2>
            <CommunityRatings />
          </section>
        )}

        {(activeTab === 'all' || activeTab === 'forum') && (
          <section aria-labelledby="forum-heading">
            <h2 id="forum-heading" className="sr-only">
              Discussion Boards
            </h2>
            <DealForum />
          </section>
        )}

        {(activeTab === 'all' || activeTab === 'referrals') && (
          <section className="card p-6 border border-border bg-gradient-to-br from-surface to-canvas space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎁</span>
                  <h3 className="text-lg font-bold text-foreground">Investor Referral & Reward Program</h3>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-bold border border-amber-500/20">
                    Tier: {referral.currentTier}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Earn ${referral.referrerBonusUsd} USD cash credit per referred investor. Your referee receives a {referral.refereeBonusDiscount}% platform fee discount.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowShareModal(true)}
                className="btn btn-sm bg-primary text-primary-foreground hover:opacity-90 self-start sm:self-auto cursor-pointer"
              >
                Share Referral Link ↗
              </button>
            </div>

            {/* Referral Dashboard Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-canvas border border-border space-y-1">
                <span className="text-muted-foreground font-semibold">Total Referrals</span>
                <p className="text-2xl font-black text-foreground">{referral.totalReferrals}</p>
                <p className="text-[10px] text-muted-foreground">{referral.completedReferrals} funded deals completed</p>
              </div>

              <div className="p-4 rounded-xl bg-canvas border border-border space-y-1">
                <span className="text-muted-foreground font-semibold">Total Earned</span>
                <p className="text-2xl font-black text-emerald-600">${referral.totalEarnedUsd} USD</p>
                <p className="text-[10px] text-emerald-600 font-medium">Disbursed to wallet</p>
              </div>

              <div className="p-4 rounded-xl bg-canvas border border-border space-y-1">
                <span className="text-muted-foreground font-semibold">Pending Bonus</span>
                <p className="text-2xl font-black text-amber-600">${referral.pendingEarnedUsd} USD</p>
                <p className="text-[10px] text-muted-foreground">{referral.pendingReferrals} referees in escrow funding</p>
              </div>

              <div className="p-4 rounded-xl bg-canvas border border-border space-y-1">
                <span className="text-muted-foreground font-semibold">Next Tier: Platinum</span>
                <p className="text-2xl font-black text-indigo-600">{referral.nextTierProgress}%</p>
                <p className="text-[10px] text-muted-foreground">Unlocks $100/ref + VIP early deals</p>
              </div>
            </div>

            {/* Quick Share Link */}
            <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2 text-xs">
              <label className="font-semibold text-foreground">Your Dedicated Referral Link</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={referral.referralUrl}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas font-mono text-muted-foreground select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyReferral}
                  className={`btn btn-sm px-5 whitespace-nowrap cursor-pointer transition-colors ${
                    copiedCode
                      ? 'bg-emerald-600 text-white font-bold'
                      : 'bg-primary text-primary-foreground hover:opacity-90'
                  }`}
                >
                  {copiedCode ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Recent Referee Activity */}
            <div className="space-y-2 text-xs">
              <h4 className="font-bold text-foreground">Recent Referral Activity</h4>
              <div className="divide-y divide-border/60 border border-border rounded-xl bg-canvas overflow-hidden">
                {referral.recentReferrals.map((item) => (
                  <div key={item.id} className="p-3 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-bold text-foreground">{item.refereeMaskedEmail}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Invested in {item.dealTitle} • {item.date}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-emerald-600 block">+${item.rewardUsd} USD</span>
                      <span
                        className={`text-[9px] uppercase font-bold px-1.5 py-0.2 rounded ${
                          item.status === 'completed'
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-amber-500/10 text-amber-600'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {(activeTab === 'all' || activeTab === 'experts') && (
          <section aria-labelledby="experts-heading">
            <h2 id="experts-heading" className="sr-only">
              Expert Endorsements
            </h2>
            <ExpertEndorsements />
          </section>
        )}

        {(activeTab === 'all' || activeTab === 'analytics') && (
          <section aria-labelledby="analytics-heading">
            <h2 id="analytics-heading" className="sr-only">
              Trust Analytics
            </h2>
            <TrustAnalyticsWidget />
          </section>
        )}
      </div>

      {/* Share Modal */}
      {showShareModal && (
        <SocialShareModal
          dealTitle="Agri-Fi Sustainable Agriculture Deals"
          roi={14.2}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}
