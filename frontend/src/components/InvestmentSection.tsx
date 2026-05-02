'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { InvestmentForm } from './InvestmentForm';
import { apiClient, Deal } from '@/lib/api';

export default function InvestmentSection({ deal }: { deal: Deal }) {
  const router = useRouter();
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(apiClient.getCurrentUser());
    setLoading(false);
  }, []);

  if (deal.status !== 'open') return null;

  const tokenPrice = Number(deal.total_value) / Number(deal.token_count);

  const handleFundClick = () => {
    if (!user) { router.push(`/login?redirect=/marketplace/${deal.id}`); return; }
    if (user.role !== 'investor') {
      alert('Only registered investors can fund trade deals.');
      return;
    }
    setIsFormVisible(true);
  };

  if (loading) return <div className="h-10 w-36 skeleton rounded-xl" />;

  return (
    <div className="mt-2">
      {!isFormVisible ? (
        <button onClick={handleFundClick} className="btn-primary">
          💰 Fund this Deal
        </button>
      ) : (
        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 mt-4">
          <div className="flex justify-between items-center mb-5">
            <h3 className="font-bold text-slate-900">Investment Form</h3>
            <button onClick={() => setIsFormVisible(false)}
              className="w-7 h-7 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
              ×
            </button>
          </div>
          <InvestmentForm
            dealId={deal.id}
            maxTokens={deal.tokens_remaining}
            tokenPrice={tokenPrice}
            onSuccess={() => {}}
          />
        </div>
      )}
    </div>
  );
}
