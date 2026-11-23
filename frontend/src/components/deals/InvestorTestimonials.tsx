'use client';

import React from 'react';
import { InvestorTestimonial } from '@/types/socialProof';

interface InvestorTestimonialsProps {
  testimonials: InvestorTestimonial[];
}

export const InvestorTestimonials: React.FC<InvestorTestimonialsProps> = ({
  testimonials,
}) => {
  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} className={i < rating ? 'text-yellow-400' : 'text-gray-300'}>
        ★
      </span>
    ));
  };

  return (
    <div className="investor-testimonials space-y-4">
      <h3 className="text-lg font-semibold">Investor Testimonials</h3>
      {testimonials.length === 0 ? (
        <p className="text-gray-500 text-sm">No testimonials yet.</p>
      ) : (
        <div className="space-y-3">
          {testimonials.map((testimonial) => (
            <div
              key={testimonial.id}
              className="p-4 border rounded-lg bg-white shadow-sm"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{testimonial.investorName}</span>
                  {testimonial.verified && (
                    <span className="text-blue-600 text-xs" title="Verified Investor">
                      ✓
                    </span>
                  )}
                </div>
                <div className="flex">{renderStars(testimonial.rating)}</div>
              </div>
              <p className="text-gray-700 text-sm mb-2">{testimonial.comment}</p>
              <p className="text-xs text-gray-500">
                {new Date(testimonial.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
