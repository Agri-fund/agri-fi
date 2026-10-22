'use client';

import React, { useState } from 'react';
import { EcoCertification } from '@/lib/sustainability';

interface EcoCertificationBadgesProps {
  certifications?: EcoCertification[];
  size?: 'sm' | 'md' | 'lg';
  showDetails?: boolean;
}

const CERT_ICONS: Record<string, string> = {
  organic: '🌱',
  fair_trade: '🤝',
  carbon_neutral: '🌍',
  rainforest_alliance: '🐸',
  regenerative_organic: '♻️',
  non_gmo: '🌾',
};

export default function EcoCertificationBadges({
  certifications = [],
  size = 'md',
  showDetails = false,
}: EcoCertificationBadgesProps) {
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);

  if (!certifications || certifications.length === 0) {
    return null;
  }

  const isSmall = size === 'sm';

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Eco-friendly certifications">
      {certifications.map((cert) => {
        const icon = CERT_ICONS[cert.type] || '✨';
        const isHovered = activeTooltip === cert.id;

        return (
          <div
            key={cert.id}
            className="relative inline-flex items-center"
            onMouseEnter={() => setActiveTooltip(cert.id)}
            onMouseLeave={() => setActiveTooltip(null)}
          >
            <span
              className={`inline-flex items-center gap-1 font-semibold rounded-full border transition-all cursor-pointer ${
                isSmall
                  ? 'px-2 py-0.5 text-[10px]'
                  : 'px-2.5 py-1 text-xs'
              } ${cert.badgeColor} hover:shadow-sm`}
              title={`${cert.name} - Issued by ${cert.issuer}`}
              role="button"
              tabIndex={0}
              aria-label={`${cert.name}: ${cert.badgeText}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTooltip(isHovered ? null : cert.id);
              }}
            >
              <span aria-hidden="true">{icon}</span>
              <span>{cert.badgeText}</span>
              {cert.type === 'carbon_neutral' && (
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse ml-0.5" />
              )}
            </span>

            {/* Hover Tooltip / Detail Card */}
            {(isHovered || showDetails) && (
              <div
                className="absolute bottom-full left-0 mb-2 z-50 w-64 p-3 bg-white text-slate-800 rounded-xl shadow-xl border border-slate-200 text-xs animate-in fade-in zoom-in-95 pointer-events-auto"
                role="tooltip"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900">
                    <span className="text-base">{icon}</span>
                    <span>{cert.name}</span>
                  </div>
                  <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                    {cert.verificationCode}
                  </span>
                </div>
                <p className="mt-1.5 text-slate-600 text-[11px] leading-relaxed">
                  {cert.description}
                </p>
                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                  <span>Issuer: <strong className="text-slate-700">{cert.issuer}</strong></span>
                  {cert.verificationUrl && (
                    <a
                      href={cert.verificationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 hover:text-brand-800 underline font-medium"
                    >
                      Verify ↗
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
