'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, Investment, User } from '@/lib/api';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function InvestorDashboard() {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Check authentication and role
    const currentUser = apiClient.getCurrentUser();
    if (!currentUser) {
      router.push('/login');
      return;
    }

    if (currentUser.role !== 'investor') {
      // Redirect to correct dashboard based on role
      router.push(`/dashboard/${currentUser.role}`);
      return;
    }

    setUser(currentUser);
    fetchInvestorInvestments();
  }, [router]);

  const fetchInvestorInvestments = async () => {
    try {
      setLoading(true);
      const investorInvestments = await apiClient.getInvestorInvestments();
      setInvestments(investorInvestments);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to fetch investments');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'funded':
        return 'bg-blue-100 text-blue-800';
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const calculateTotalInvested = () => {
    return investments.reduce((total, investment) => total + investment.amount_invested, 0);
  };

  const calculateTotalTokens = () => {
    return investments.reduce((total, investment) => total + investment.token_holdings, 0);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your investments...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-red-800 text-lg font-semibold mb-2">Error</h2>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={fetchInvestorInvestments}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Investor Dashboard</h1>
                <p className="text-gray-600">Track your agricultural investments</p>
              </div>
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-600">
                  Welcome, {user?.name || user?.email}
                </span>
                <button
                  onClick={() => {
                    apiClient.clearAuth();
                    router.push('/login');
                  }}
                  className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="bg-purple-50 rounded-full p-3">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Total Invested</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(calculateTotalInvested())}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="bg-green-50 rounded-full p-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Total Tokens</p>
                  <p className="text-2xl font-bold text-gray-900">{calculateTotalTokens().toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="bg-blue-50 rounded-full p-3">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Active Investments</p>
                  <p className="text-2xl font-bold text-gray-900">{investments.length}</p>
                </div>
              </div>
            </div>
          </div>

          {investments.length === 0 ? (
            // Empty State
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <div className="bg-purple-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No investments found</h3>
              <p className="text-gray-600 mb-4">
                You haven't made any investments yet. Browse available deals to start investing in agricultural projects.
              </p>
              <button className="bg-purple-600 text-white px-6 py-2 rounded hover:bg-purple-700 transition-colors">
                Browse Available Deals
              </button>
            </div>
          ) : (
            // Investments List
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Your Investments</h2>
                <span className="text-sm text-gray-600">{investments.length} investments</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {investments.map((investment) => (
                  <div key={investment.id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
                    <div className="p-6">
                      {/* Investment Header */}
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 capitalize">
                            {investment.deal.commodity}
                          </h3>
                          <p className="text-sm text-gray-600">Investment ID: {investment.id.slice(0, 8)}...</p>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(investment.deal.status)}`}>
                          {investment.deal.status}
                        </span>
                      </div>

                      {/* Investment Details */}
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Amount Invested:</span>
                          <span className="text-sm font-medium">{formatCurrency(investment.amount_invested)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Token Holdings:</span>
                          <span className="text-sm font-medium">{investment.token_holdings.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Deal Value:</span>
                          <span className="text-sm font-medium">{formatCurrency(investment.deal.total_value)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm text-gray-600">Deal Quantity:</span>
                          <span className="text-sm font-medium">{investment.deal.quantity.toLocaleString()} units</span>
                        </div>

                        {/* Deal Funding Progress */}
                        <div className="border-t pt-3">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-600">Deal Funding</span>
                            <span className="text-gray-900">
                              {investment.deal.total_value > 0 
                                ? ((investment.deal.funded_amount / investment.deal.total_value) * 100).toFixed(1)
                                : '0'}%
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-purple-600 h-2 rounded-full transition-all"
                              style={{ 
                                width: `${Math.min(
                                  investment.deal.total_value > 0 
                                    ? (investment.deal.funded_amount / investment.deal.total_value) * 100
                                    : 0, 
                                  100
                                )}%` 
                              }}
                            ></div>
                          </div>
                        </div>

                        {/* Your Share */}
                        <div className="border-t pt-3">
                          <p className="text-sm font-medium text-gray-900 mb-1">Your Investment Share</p>
                          <p className="text-sm text-gray-600">
                            {investment.deal.total_value > 0 
                              ? ((investment.amount_invested / investment.deal.total_value) * 100).toFixed(1)
                              : '0'}% of deal
                          </p>
                        </div>

                        {/* Investment Date */}
                        <div className="border-t pt-3">
                          <p className="text-xs text-gray-500">
                            Invested on {formatDate(investment.created_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
