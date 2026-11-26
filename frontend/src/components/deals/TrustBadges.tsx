'use client';

import React from 'react';
import { TrustBadge } from '@/types/socialProof';

interface TrustBadgesProps {
  badges: TrustBadge[];
}

export const TrustBadges: React.FC<TrustBadgesProps> = ({ badges }) => {
  return (
    <div className="trust-badges">
      <h3 className="text-lg font-semibold mb-3">Trust Badges</h3>
      {badges.length === 0 ? (
        <p className="text-gray-500 text-sm">No trust badges earned yet.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {badges.map((badge) => (
            <div
              key={badge.id}
              className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg"
              title={badge.description}
            >
              <span className="text-2xl">{badge.icon}</span>
              <div>
                <div className="font-medium text-sm">{badge.name}</div>
                <div className="text-xs text-gray-600">
                  {new Date(badge.earnedAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
