'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { InvestmentModal } from './marketplace/InvestmentModal';
import { apiClient, Deal } from '@/lib/api';

export default function InvestmentSection({ deal }: { deal: Deal }) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(apiClient.getCurrentUser());
    setLoading(false);
  }, []);

  if (deal.status !== 'open') return null;

  const handleFundClick = () => {
    if (!user) {
      router.push(`/login?redirect=/marketplace/${deal.id}`);
      return;
    }
    if (user.role !== 'investor') {
      alert('Only registered investors can fund trade deals.');
      return;
    }
    setIsModalOpen(true);
  };

  if (loading) return <div className="h-10 w-36 skeleton rounded-xl" />;

  return (
    <div className="mt-2">
      <button onClick={handleFundClick} className="btn-primary">
        💰 Fund this Deal
      </button>

      {isModalOpen && (
        <InvestmentModal
          deal={deal}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
}
