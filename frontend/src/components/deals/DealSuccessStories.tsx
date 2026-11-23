'use client';

import React from 'react';
import { DealSuccessStory } from '@/types/socialProof';

interface DealSuccessStoriesProps {
  stories: DealSuccessStory[];
}

export const DealSuccessStories: React.FC<DealSuccessStoriesProps> = ({
  stories,
}) => {
  return (
    <div className="success-stories space-y-4">
      <h3 className="text-lg font-semibold">Success Stories</h3>
      {stories.length === 0 ? (
        <p className="text-gray-500 text-sm">No success stories yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {stories.map((story) => (
            <div
              key={story.id}
              className="p-4 border rounded-lg bg-gradient-to-br from-green-50 to-blue-50"
            >
              {story.imageUrl && (
                <img
                  src={story.imageUrl}
                  alt={story.title}
                  className="w-full h-32 object-cover rounded mb-3"
                />
              )}
              <h4 className="font-semibold mb-2">{story.title}</h4>
              <p className="text-sm text-gray-700 mb-3">{story.description}</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-gray-600">Funded</div>
                  <div className="font-semibold">
                    ${story.totalFunded.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">Investors</div>
                  <div className="font-semibold">{story.totalInvestors}</div>
                </div>
                <div>
                  <div className="text-gray-600">ROI</div>
                  <div className="font-semibold text-green-600">
                    {story.roi}%
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Completed: {new Date(story.completedAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
