'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

interface FeeConfiguration {
  id: string;
  dealType: string;
  investorTier: 'retail' | 'vip' | 'institutional';
  feeType: 'platform_origination' | 'platform_success' | 'investor_entry' | 'early_exit';
  ratePercent: number;
  description: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  skip: number;
  take: number;
}

export default function FeeConfigurationsPage() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState({
    dealType: '',
    investorTier: '',
    feeType: '',
    active: undefined as boolean | undefined,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: [
      'feeConfigurations',
      page,
      pageSize,
      filters,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('skip', String(page * pageSize));
      params.set('take', String(pageSize));

      if (filters.dealType) params.set('dealType', filters.dealType);
      if (filters.investorTier) params.set('investorTier', filters.investorTier);
      if (filters.feeType) params.set('feeType', filters.feeType);
      if (filters.active !== undefined) params.set('active', String(filters.active));

      const res = await fetch(`/api/admin/fee-configurations?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });

      if (!res.ok) throw new Error('Failed to fetch fee configurations');
      return res.json() as Promise<PaginatedResponse<FeeConfiguration>>;
    },
  });

  const { data: dealTypes } = useQuery({
    queryKey: ['dealTypes'],
    queryFn: async () => {
      const res = await fetch('/api/admin/fee-configurations/deal-types', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch deal types');
      return res.json() as Promise<string[]>;
    },
  });

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Error loading fee configurations</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Fee Configurations</h1>
          <p className="text-gray-600 mt-2">Manage platform, farmer, and investor fees by deal type and tier</p>
        </div>
        <Link
          href="/admin/fee-configurations/new"
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
        >
          + Create Configuration
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <h3 className="font-semibold text-gray-900">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deal Type</label>
            <select
              value={filters.dealType}
              onChange={(e) => {
                setFilters({ ...filters, dealType: e.target.value });
                setPage(0);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">All</option>
              {dealTypes?.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Investor Tier</label>
            <select
              value={filters.investorTier}
              onChange={(e) => {
                setFilters({ ...filters, investorTier: e.target.value });
                setPage(0);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">All</option>
              <option value="retail">Retail</option>
              <option value="vip">VIP</option>
              <option value="institutional">Institutional</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fee Type</label>
            <select
              value={filters.feeType}
              onChange={(e) => {
                setFilters({ ...filters, feeType: e.target.value });
                setPage(0);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">All</option>
              <option value="platform_origination">Platform Origination</option>
              <option value="platform_success">Platform Success</option>
              <option value="investor_entry">Investor Entry</option>
              <option value="early_exit">Early Exit</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filters.active === undefined ? '' : String(filters.active)}
              onChange={(e) => {
                const val = e.target.value;
                setFilters({
                  ...filters,
                  active: val === '' ? undefined : val === 'true',
                });
                setPage(0);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-center text-gray-600">Loading...</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Deal Type</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Investor Tier</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Fee Type</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Rate (%)</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Effective From</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Expires</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data?.data.map((config) => {
                    const isActive =
                      new Date(config.effectiveFrom) <= new Date() &&
                      (config.effectiveTo === null ||
                        new Date(config.effectiveTo) > new Date());

                    return (
                      <tr key={config.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                          {config.dealType}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                            {config.investorTier}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {config.feeType.replace(/_/g, ' ')}
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900 text-right">
                          {config.ratePercent.toFixed(3)}%
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {new Date(config.effectiveFrom).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {config.effectiveTo
                            ? new Date(config.effectiveTo).toLocaleDateString()
                            : '∞'}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              isActive
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-right space-x-2">
                          <Link
                            href={`/admin/fee-configurations/${config.id}`}
                            className="text-blue-600 hover:text-blue-900 font-medium"
                          >
                            Edit
                          </Link>
                          {!isActive && (
                            <button
                              onClick={() => {
                                // Delete handler
                                if (
                                  confirm(
                                    'Are you sure? This action cannot be undone.',
                                  )
                                ) {
                                  // Call delete API
                                }
                              }}
                              className="text-red-600 hover:text-red-900 font-medium"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
              <p className="text-sm text-gray-600">
                Showing {data?.data.length || 0} of {data?.total || 0} configurations
              </p>
              <div className="space-x-2">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600">
                  Page {page + 1} of {Math.ceil((data?.total || 0) / pageSize)}
                </span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={!data || page * pageSize + data.data.length >= data.total}
                  className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
