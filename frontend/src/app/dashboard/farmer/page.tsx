'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, Deal, User } from '@/lib/api';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function FarmerDashboard() {
  const [deals, setDeals] = useState<Deal[]>([]);
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

    if (currentUser.role !== 'farmer') {
      // Redirect to correct dashboard based on role
      router.push(`/dashboard/${currentUser.role}`);
      return;
    }

    setUser(currentUser);
    fetchFarmerDeals();
  }, [router]);

  const fetchFarmerDeals = async () => {
    try {
      setLoading(true);
      const farmerDeals = await apiClient.getFarmerDeals();
      setDeals(farmerDeals);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to fetch deals');
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

  const getLatestMilestone = (deal: Deal) => {
    if (!deal.milestones || deal.milestones.length === 0) {
      return null;
    }
    return deal.milestones.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your deals...</p>
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
              onClick={fetchFarmerDeals}
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
                <h1 className="text-2xl font-bold text-gray-900">Farmer Dashboard</h1>
                <p className="text-gray-600">Manage your agricultural deals</p>
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

        {/* Main Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {deals.length === 0 ? (
            // Empty State
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <div className="bg-green-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No deals found</h3>
              <p className="text-gray-600 mb-4">
                You haven&apos;t created any agricultural deals yet. Get started by creating your first deal.
              </p>
              <button className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 transition-colors">
                Create Your First Deal
              </button>
            </div>
          ) : (
            // Deals List
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-900">Your Deals</h2>
                <span className="text-sm text-gray-600">{deals.length} deals</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {deals.map((deal) => {
                  const latestMilestone = getLatestMilestone(deal);
                  const fundingProgress = deal.total_value > 0 ? (deal.funded_amount / deal.total_value) * 100 : 0;

                  return (
                    <div key={deal.id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
                      <div className="p-6">
                        {/* Deal Header */}
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900 capitalize">{deal.commodity}</h3>
                            <p className="text-sm text-gray-600">Deal ID: {deal.id.slice(0, 8)}...</p>
                          </div>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(deal.status)}`}>
                            {deal.status}
                          </span>
                        </div>

                        {/* Deal Details */}
                        <div className="space-y-3">
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">Quantity:</span>
                            <span className="text-sm font-medium">{deal.quantity.toLocaleString()} units</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">Total Value:</span>
                            <span className="text-sm font-medium">{formatCurrency(deal.total_value)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600">Funded:</span>
                            <span className="text-sm font-medium">{formatCurrency(deal.funded_amount)}</span>
                          </div>

                          {/* Funding Progress */}
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-gray-600">Progress</span>
                              <span className="text-gray-900">{fundingProgress.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-green-600 h-2 rounded-full transition-all"
                                style={{ width: `${Math.min(fundingProgress, 100)}%` }}
                              ></div>
                            </div>
                          </div>

                          {/* Latest Milestone */}
                          {latestMilestone && (
                            <div className="border-t pt-3">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-gray-900">Latest Milestone</p>
                                  <p className="text-sm text-gray-600">{latestMilestone.title}</p>
                                  <p className="text-xs text-gray-500 mt-1">
                                    {formatDate(latestMilestone.created_at)}
                                  </p>
                                </div>
                                <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(latestMilestone.status)}`}>
                                  {latestMilestone.status}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Created Date */}
                          <div className="border-t pt-3">
                            <p className="text-xs text-gray-500">
                              Created on {formatDate(deal.created_at)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

