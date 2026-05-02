'use client';

/**
 * Transparency Page
 *
 * Public page showing on-chain investment records, smart contract addresses,
 * and Stellar transaction history for all active deals.
 * No authentication required — fully public for investor confidence.
 */

import { useEffect, useState } from 'react';

interface DealSummary {
  id: string;
  commodity: string;
  totalValue: number;
  totalInvested: number;
  status: string;
  sorobanCampaignContractId: string | null;
  stellarAssetTxId: string | null;
  tokenSymbol: string;
  createdAt: string;
}

const STELLAR_EXPERT_BASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
    ? 'https://stellar.expert/explorer/public'
    : 'https://stellar.expert/explorer/testnet';

export default function TransparencyPage() {
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/trade-deals')
      .then((r) => r.json())
      .then((data) => {
        setDeals(Array.isArray(data) ? data : data.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Blockchain Transparency
          </h1>
          <p className="text-gray-500 max-w-xl mx-auto">
            Every investment, payout, and milestone on AgriFi is recorded
            immutably on the Stellar blockchain. Verify any transaction
            independently.
          </p>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Active Deals', value: deals.filter((d) => d.status === 'open').length },
            { label: 'Total Deals', value: deals.length },
            {
              label: 'On-Chain Contracts',
              value: deals.filter((d) => d.sorobanCampaignContractId).length,
            },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl p-4 text-center shadow-sm">
              <p className="text-2xl font-bold text-green-700">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Deals table */}
        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading on-chain data...</div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Commodity', 'Token', 'Status', 'Funded', 'Smart Contract', 'Stellar TX'].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {deals.map((deal) => (
                  <tr key={deal.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{deal.commodity}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {deal.tokenSymbol}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          deal.status === 'open'
                            ? 'bg-green-100 text-green-700'
                            : deal.status === 'funded'
                            ? 'bg-blue-100 text-blue-700'
                            : deal.status === 'completed'
                            ? 'bg-gray-100 text-gray-600'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {deal.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      ${Number(deal.totalInvested).toLocaleString()} /{' '}
                      ${Number(deal.totalValue).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {deal.sorobanCampaignContractId ? (
                        <a
                          href={`${STELLAR_EXPERT_BASE}/contract/${deal.sorobanCampaignContractId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-600 hover:underline font-mono text-xs"
                        >
                          {deal.sorobanCampaignContractId.slice(0, 12)}...
                        </a>
                      ) : (
                        <span className="text-gray-400 text-xs">Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {deal.stellarAssetTxId ? (
                        <a
                          href={`${STELLAR_EXPERT_BASE}/tx/${deal.stellarAssetTxId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-mono text-xs"
                        >
                          {deal.stellarAssetTxId.slice(0, 12)}...
                        </a>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {deals.length === 0 && (
              <div className="text-center py-12 text-gray-400">No deals found</div>
            )}
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          Data sourced from Stellar{' '}
          {process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'Mainnet' : 'Testnet'} ·
          Soroban smart contracts · AgriFi Platform
        </p>
      </div>
    </main>
  );
}
