'use client';

import React, { useState } from 'react';
import { generateSocialShareUrl, recordTrustInteraction } from '@/lib/social-proof';

interface SocialShareModalProps {
  dealTitle: string;
  dealId?: string;
  roi?: number | string;
  commodity?: string;
  referralCode?: string;
  onClose: () => void;
}

export function SocialShareModal({
  dealTitle,
  dealId,
  roi,
  commodity,
  referralCode = 'AGRI-INVEST-88',
  onClose,
}: SocialShareModalProps) {
  const [copied, setCopied] = useState(false);

  const channels = [
    { id: 'twitter' as const, name: 'X / Twitter', icon: '𝕏', bg: 'hover:bg-neutral-900 hover:text-white' },
    { id: 'linkedin' as const, name: 'LinkedIn', icon: '💼', bg: 'hover:bg-blue-600 hover:text-white' },
    { id: 'whatsapp' as const, name: 'WhatsApp', icon: '💬', bg: 'hover:bg-emerald-600 hover:text-white' },
    { id: 'telegram' as const, name: 'Telegram', icon: '✈️', bg: 'hover:bg-sky-500 hover:text-white' },
    { id: 'facebook' as const, name: 'Facebook', icon: '👥', bg: 'hover:bg-indigo-600 hover:text-white' },
  ];

  const preview = generateSocialShareUrl({
    channel: 'copy',
    dealTitle,
    dealId,
    roi,
    commodity,
    referralCode,
  });

  const handleChannelClick = (channel: any) => {
    const { shareUrl } = generateSocialShareUrl({
      channel,
      dealTitle,
      dealId,
      roi,
      commodity,
      referralCode,
    });
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(preview.directUrl);
      setCopied(true);
      recordTrustInteraction('referral_link_copied');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
    >
      <div className="bg-surface border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-xl">📣</span>
            <div>
              <h3 className="text-base font-bold text-foreground">Share Deal & Earn Referral</h3>
              <p className="text-xs text-muted-foreground">Invite peers and receive $50 bonus credit per funded deal</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm p-1 rounded-lg hover:bg-muted"
          >
            ✕
          </button>
        </div>

        {/* Share Preview Card */}
        <div className="bg-muted/40 p-3.5 rounded-xl border border-border space-y-2 text-xs">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Message Preview</span>
            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">
              Ref: {referralCode}
            </span>
          </div>
          <p className="text-foreground/90 font-mono text-[11px] leading-relaxed bg-canvas p-2.5 rounded border border-border/60">
            {preview.shareText}
          </p>
        </div>

        {/* Social Buttons Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {channels.map((ch) => (
            <button
              key={ch.id}
              type="button"
              onClick={() => handleChannelClick(ch.id)}
              className={`flex items-center gap-2 p-2.5 rounded-xl border border-border bg-canvas text-xs font-semibold text-foreground transition-all cursor-pointer ${ch.bg}`}
            >
              <span className="text-base">{ch.icon}</span>
              <span>{ch.name}</span>
            </button>
          ))}
        </div>

        {/* Direct Link Copy */}
        <div className="pt-2 space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">Your Personalized Referral URL</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={preview.directUrl}
              className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-canvas text-muted-foreground font-mono focus:outline-none select-all"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className={`btn btn-sm px-4 whitespace-nowrap cursor-pointer transition-colors ${
                copied
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
            >
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="text-center pt-2">
          <p className="text-[11px] text-muted-foreground">
            Your referees also receive a <strong className="text-foreground">2.5% platform fee discount</strong> on their first deal.
          </p>
        </div>
      </div>
    </div>
  );
}
export default SocialShareModal;
