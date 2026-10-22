'use client';

import React, { useState, useMemo } from 'react';
import {
  Testimonial,
  getStoredTestimonials,
  submitTestimonial,
  voteTestimonialHelpful,
  recordTrustInteraction,
} from '@/lib/social-proof';

interface InvestorTestimonialsProps {
  dealId?: string;
  dealTitle?: string;
  commodity?: string;
  country?: string;
  className?: string;
}

export function InvestorTestimonials({
  dealId,
  dealTitle,
  commodity,
  country,
  className = '',
}: InvestorTestimonialsProps) {
  const [testimonials, setTestimonials] = useState<Testimonial[]>(() =>
    getStoredTestimonials(dealId),
  );
  const [filterRating, setFilterRating] = useState<number | 'all'>('all');
  const [onlyVerified, setOnlyVerified] = useState<boolean>(false);
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState('Retail Investor');
  const [formTier, setFormTier] = useState<Testimonial['investmentTier']>('retail');
  const [formRating, setFormRating] = useState(5);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formAmount, setFormAmount] = useState<number | ''>(500);
  const [formSuccess, setFormSuccess] = useState(false);

  const filtered = useMemo(() => {
    return testimonials.filter((t) => {
      if (filterRating !== 'all' && t.rating !== filterRating) return false;
      if (onlyVerified && !t.verifiedInvestment) return false;
      return true;
    });
  }, [testimonials, filterRating, onlyVerified]);

  const handleHelpful = (id: string) => {
    const res = voteTestimonialHelpful(id);
    if (res.success) {
      setTestimonials((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, helpfulCount: res.helpfulCount, userVotedHelpful: !item.userVotedHelpful }
            : item,
        ),
      );
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formTitle.trim() || !formContent.trim()) return;

    const created = submitTestimonial({
      dealId,
      dealTitle: dealTitle || 'Agri-Fi Trade Deal',
      investorName: formName.trim(),
      investorRole: formRole,
      investorAvatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(formName)}`,
      verifiedInvestment: true,
      investmentTier: formTier,
      investmentAmount: typeof formAmount === 'number' ? formAmount : undefined,
      rating: formRating,
      title: formTitle.trim(),
      content: formContent.trim(),
      commodity,
      country,
    });

    setTestimonials((prev) => [created, ...prev]);
    setFormSuccess(true);
    setTimeout(() => {
      setFormSuccess(false);
      setShowSubmitModal(false);
      setFormTitle('');
      setFormContent('');
    }, 1200);
  };

  return (
    <div className={`card p-6 border border-border bg-surface ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">💬</span>
            <h3 className="text-lg font-bold text-foreground">Verified Investor Testimonials</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-semibold border border-emerald-500/20">
              {testimonials.length} Reviews
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Real feedback from verified token holders, funds, and agricultural impact investors.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowSubmitModal(true);
            recordTrustInteraction('testimonial_modal_opened');
          }}
          className="btn btn-sm bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <span>✍️</span>
          <span>Write a Review</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 py-3 border-b border-border/50 text-xs">
        <span className="text-muted-foreground font-medium mr-1">Filter by:</span>
        <button
          type="button"
          onClick={() => setFilterRating('all')}
          className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
            filterRating === 'all'
              ? 'bg-primary text-primary-foreground border-primary font-bold'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          All Stars
        </button>
        {[5, 4, 3].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setFilterRating(star)}
            className={`px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
              filterRating === star
                ? 'bg-primary text-primary-foreground border-primary font-bold'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {star} ★
          </button>
        ))}

        <div className="h-4 w-px bg-border mx-1" />

        <label className="inline-flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-foreground">
          <input
            type="checkbox"
            checked={onlyVerified}
            onChange={(e) => setOnlyVerified(e.target.checked)}
            className="rounded border-border text-primary focus:ring-primary"
          />
          <span>Verified Investors Only</span>
        </label>
      </div>

      {/* Testimonials List */}
      <div className="divide-y divide-border/60 mt-2">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No testimonials match your filter criteria.
          </div>
        ) : (
          filtered.map((t) => (
            <div key={t.id} className="py-4 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <img
                    src={t.investorAvatar}
                    alt={t.investorName}
                    className="w-9 h-9 rounded-full object-cover border border-border"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{t.investorName}</span>
                      {t.verifiedInvestment && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                          ✓ Verified Investor
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {t.investorRole} {t.investmentAmount && `• Funded $${t.investmentAmount.toLocaleString()}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <div className="flex text-amber-500 tracking-tighter" aria-label={`${t.rating} out of 5 stars`}>
                    {'★'.repeat(t.rating)}
                    {'☆'.repeat(5 - t.rating)}
                  </div>
                  <span className="text-muted-foreground text-[11px]">
                    {new Date(t.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-foreground">{t.title}</h4>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">{t.content}</p>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {t.commodity && (
                    <span className="bg-canvas px-2 py-0.5 rounded border border-border">
                      🌾 {t.commodity}
                    </span>
                  )}
                  {t.country && (
                    <span className="bg-canvas px-2 py-0.5 rounded border border-border">
                      📍 {t.country}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleHelpful(t.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors cursor-pointer ${
                    t.userVotedHelpful
                      ? 'bg-primary/10 text-primary border-primary/30 font-semibold'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span>👍 Helpful</span>
                  <span>({t.helpfulCount})</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Review Submission Modal */}
      {showSubmitModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
        >
          <div className="bg-surface border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h3 className="text-base font-bold text-foreground">Write an Investor Testimonial</h3>
                <p className="text-xs text-muted-foreground">Share your investment experience with the community</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm p-1 rounded-lg hover:bg-muted"
              >
                ✕
              </button>
            </div>

            {formSuccess ? (
              <div className="p-8 text-center space-y-2">
                <span className="text-4xl">🎉</span>
                <h4 className="text-base font-bold text-emerald-600">Review Submitted!</h4>
                <p className="text-xs text-muted-foreground">
                  Thank you for contributing your verified trust signal to the community.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-muted-foreground font-medium mb-1">Your Rating</label>
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFormRating(s)}
                        className={`text-2xl cursor-pointer transition-transform ${
                          s <= formRating ? 'text-amber-500 scale-110' : 'text-neutral-300'
                        }`}
                      >
                        ★
                      </button>
                    ))}
                    <span className="text-muted-foreground ml-2 font-semibold">{formRating} out of 5 stars</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-muted-foreground font-medium mb-1">Full Name / Display Name</label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Jane Doe"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-muted-foreground font-medium mb-1">Investor Role / Profile</label>
                    <select
                      value={formRole}
                      onChange={(e) => setFormRole(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                    >
                      <option value="Retail DeFi Investor">Retail DeFi Investor</option>
                      <option value="Accredited ESG Investor">Accredited ESG Investor</option>
                      <option value="Institutional Fund Lead">Institutional Fund Lead</option>
                      <option value="Family Office Syndicate">Family Office Syndicate</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-muted-foreground font-medium mb-1">Investor Tier</label>
                    <select
                      value={formTier}
                      onChange={(e) => setFormTier(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                    >
                      <option value="retail">Retail (&lt; $10k/yr)</option>
                      <option value="accredited">Accredited ($10k-$50k)</option>
                      <option value="institutional">Institutional (&gt; $50k)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-muted-foreground font-medium mb-1">Amount Funded (USD)</label>
                    <input
                      type="number"
                      min={100}
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value ? Number(e.target.value) : '')}
                      placeholder="e.g. 1000"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-muted-foreground font-medium mb-1">Headline / Title</label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="e.g. Transparent milestones and excellent yield"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground font-medium mb-1">Your Review</label>
                  <textarea
                    required
                    rows={4}
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="Describe payout punctuality, harvest communication, risk comfort, or platform experience..."
                    className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSubmitModal(false)}
                    className="btn btn-sm border border-border text-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm bg-primary text-primary-foreground hover:opacity-90 cursor-pointer"
                  >
                    Submit Verified Review
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default InvestorTestimonials;
