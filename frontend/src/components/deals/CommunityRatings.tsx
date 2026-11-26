'use client';

import React from 'react';
import { CommunityRating } from '@/types/socialProof';

interface CommunityRatingsProps {
  rating: CommunityRating;
}

export const CommunityRatings: React.FC<CommunityRatingsProps> = ({
  rating,
}) => {
  const { averageRating, totalRatings, ratingDistribution } = rating;

  const getBarWidth = (count: number) => {
    if (totalRatings === 0) return 0;
    return (count / totalRatings) * 100;
  };

  return (
    <div className="community-ratings space-y-4 p-4 border rounded-lg">
      <h3 className="text-lg font-semibold">Community Ratings</h3>

      <div className="flex items-center gap-4">
        <div className="text-center">
          <div className="text-4xl font-bold">{averageRating.toFixed(1)}</div>
          <div className="text-yellow-400 text-2xl">★</div>
          <div className="text-sm text-gray-600">{totalRatings} ratings</div>
        </div>

        <div className="flex-1 space-y-1">
          {[5, 4, 3, 2, 1].map((star) => (
            <div key={star} className="flex items-center gap-2">
              <span className="text-sm w-8">{star}★</span>
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-yellow-400 h-2 rounded-full"
                  style={{
                    width: `${getBarWidth(ratingDistribution[star as keyof typeof ratingDistribution])}%`,
                  }}
                />
              </div>
              <span className="text-sm text-gray-600 w-12 text-right">
                {ratingDistribution[star as keyof typeof ratingDistribution]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
