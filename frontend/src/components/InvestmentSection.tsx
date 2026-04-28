'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { InvestmentForm } from './InvestmentForm';
import { apiClient, Deal } from '@/lib/api';

interface InvestmentSectionProps {
  deal: Deal;
}

export default function InvestmentSection({ deal }: InvestmentSectionProps) {
  const router = useRouter();
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(apiClient.getCurrentUser());
    setLoading(false);
  }, []);

  const handleFundClick = () => {
    if (!user) {
      // Redirect to login with a return URL back to this deal detail page
      router.push(`/login?redirect=/marketplace/${deal.id}`);
      return;
    }
    
    if (user.role !== 'investor') {
      alert('Only registered investors can fund trade deals.');
      return;
    }

    setIsFormVisible(true);
  };

  if (loading) return (
    <div className="mt-2 h-10 w-32 bg-gray-100 animate-pulse rounded-xl" />
  );

  // If the deal is not open, don't show anything (or show a message)
  if (deal.status !== 'open') {
    return null;
  }

  const tokenPrice = Number(deal.total_value) / Number(deal.token_count);

  return (
    <div className="mt-4">
      {!isFormVisible ? (
        <button
          onClick={handleFundClick}
          className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium px-5 py-2.5 rounded-xl transition-colors"
          data-investor-only
        >
          Fund this Deal
        </button>
      ) : (
        <div className="bg-gray-50 rounded-2xl p-6 border border-green-100 shadow-inner animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-gray-800">Investment Form</h3>
            <button 
              onClick={() => setIsFormVisible(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close form"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <InvestmentForm
            dealId={deal.id}
            maxTokens={deal.tokens_remaining}
            tokenPrice={tokenPrice}
            onSuccess={() => {
              // The InvestmentForm component already shows a success message.
              // We could also trigger a refresh of the parent data if needed.
            }}
          />
        </div>
      )}
    </div>
  );
}
