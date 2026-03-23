'use client';

import { useState, useEffect } from 'react';
import { InvestmentForm } from '../../../components/InvestmentForm';

interface TradeDeal {
  id: string;
  commodity: string;
  quantity: number;
  unit: string;
  totalValue: number;
  deliveryDate: string;
  status: string;
  tokenCount: number;
  tokensRemaining: number;
  traderName: string;
  description?: string;
}

export default function DealDetailPage({ params }: { params: { id: string } }) {
  const [deal, setDeal] = useState<TradeDeal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDeal();
  }, [params.id]);

  const fetchDeal = async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        throw new Error('Please log in to view deals');
      }

      const response = await fetch(`/api/trade-deals/${params.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch deal details');
      }

      const dealData = await response.json();
      setDeal(dealData);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load deal');
    } finally {
      setLoading(false);
    }
  };

  const handleInvestmentSuccess = () => {
    // Refresh deal data to update remaining tokens
    fetchDeal();
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-6"></div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-4"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-red-800 mb-2">Error Loading Deal</h2>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <p className="text-gray-600">Deal not found</p>
        </div>
      </div>
    );
  }

  const fundingProgress = ((deal.tokenCount - deal.tokensRemaining) / deal.tokenCount) * 100;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {deal.commodity} Trade Deal
          </h1>
          <div className="flex items-center space-x-4 text-sm text-gray-600">
            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
              {deal.status}
            </span>
            <span>Trader: {deal.traderName}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Deal Details */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <h2 className="text-xl font-semibold mb-4">Deal Details</h2>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-sm font-medium text-gray-500">Commodity</label>
                  <p className="text-lg font-semibold">{deal.commodity}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Quantity</label>
                  <p className="text-lg font-semibold">{deal.quantity} {deal.unit}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Total Value</label>
                  <p className="text-lg font-semibold">${deal.totalValue.toLocaleString()}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-500">Delivery Date</label>
                  <p className="text-lg font-semibold">
                    {new Date(deal.deliveryDate).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {deal.description && (
                <div>
                  <label className="text-sm font-medium text-gray-500">Description</label>
                  <p className="text-gray-700 mt-1">{deal.description}</p>
                </div>
              )}
            </div>

            {/* Funding Progress */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Funding Progress</h2>
              
              <div className="mb-4">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>Progress</span>
                  <span>{Math.round(fundingProgress)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-green-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${fundingProgress}%` }}
                  ></div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-green-600">
                    {deal.tokenCount - deal.tokensRemaining}
                  </p>
                  <p className="text-sm text-gray-500">Tokens Sold</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-600">
                    {deal.tokensRemaining}
                  </p>
                  <p className="text-sm text-gray-500">Available</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {deal.tokenCount}
                  </p>
                  <p className="text-sm text-gray-500">Total Tokens</p>
                </div>
              </div>
            </div>
          </div>

          {/* Investment Form */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-6 sticky top-8">
              <h2 className="text-xl font-semibold mb-4">Fund this Deal</h2>
              
              {deal.status === 'open' && deal.tokensRemaining > 0 ? (
                <InvestmentForm
                  dealId={deal.id}
                  maxTokens={deal.tokensRemaining}
                  tokenPrice={100}
                  onSuccess={handleInvestmentSuccess}
                />
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-gray-600 text-sm text-center">
                    {deal.status !== 'open' 
                      ? `This deal is ${deal.status} and no longer accepting investments.`
                      : 'This deal is fully funded.'
                    }
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}