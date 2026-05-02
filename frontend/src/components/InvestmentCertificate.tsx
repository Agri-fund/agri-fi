'use client';

/**
 * InvestmentCertificate
 *
 * Renders a digital investment certificate for a confirmed investment.
 * Shows ownership percentage, investment amount, deal details, and
 * links to the on-chain Stellar transaction for transparency.
 */

import { useEffect, useState } from 'react';
import { getStoredToken } from '../lib/api';
import { getInvestorOwnership, CampaignState, getCampaignState } from '../lib/soroban';

interface CertificateProps {
  investmentId: string;
  dealId: string;
  commodity: string;
  tokenAmount: number;
  amountUsd: number;
  stellarTxId: string | null;
  sorobanContractId: string | null;
  investorAddress: string;
  createdAt: string;
}

export function InvestmentCertificate({
  investmentId,
  dealId,
  commodity,
  tokenAmount,
  amountUsd,
  stellarTxId,
  sorobanContractId,
  investorAddress,
  createdAt,
}: CertificateProps) {
  const [ownershipPct, setOwnershipPct] = useState<string | null>(null);
  const [campaignState, setCampaignState] = useState<CampaignState | null>(null);

  useEffect(() => {
    if (!sorobanContractId || !investorAddress) return;
    const token = getStoredToken();
    if (!token) return;

    getInvestorOwnership(sorobanContractId, investorAddress, token)
      .then((d) => setOwnershipPct(d.ownershipPct))
      .catch(() => {});

    getCampaignState(sorobanContractId, token)
      .then((s) => setCampaignState(s))
      .catch(() => {});
  }, [sorobanContractId, investorAddress]);

  const horizonBase =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
      ? 'https://stellar.expert/explorer/public/tx'
      : 'https://stellar.expert/explorer/testnet/tx';

  return (
    <div className="relative bg-gradient-to-br from-green-900 via-green-800 to-emerald-900 rounded-2xl p-8 text-white shadow-2xl overflow-hidden max-w-2xl">
      {/* Decorative background pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-4 right-4 w-48 h-48 rounded-full border-4 border-white" />
        <div className="absolute bottom-4 left-4 w-32 h-32 rounded-full border-2 border-white" />
      </div>

      {/* Header */}
      <div className="relative flex items-start justify-between mb-6">
        <div>
          <p className="text-green-300 text-xs font-semibold uppercase tracking-widest mb-1">
            AgriFi Investment Certificate
          </p>
          <h2 className="text-2xl font-bold">{commodity} Project</h2>
          <p className="text-green-300 text-sm mt-1">
            Powered by Stellar Blockchain
          </p>
        </div>
        <div className="text-right">
          <div className="bg-green-700/50 rounded-lg px-3 py-2">
            <p className="text-xs text-green-300">Status</p>
            <p className="font-semibold text-sm">
              {campaignState?.status ?? 'Loading...'}
            </p>
          </div>
        </div>
      </div>

      {/* Main stats */}
      <div className="relative grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white/10 rounded-xl p-4">
          <p className="text-green-300 text-xs uppercase tracking-wide mb-1">
            Investment Amount
          </p>
          <p className="text-2xl font-bold">${amountUsd.toLocaleString()}</p>
          <p className="text-green-300 text-xs">USDC</p>
        </div>
        <div className="bg-white/10 rounded-xl p-4">
          <p className="text-green-300 text-xs uppercase tracking-wide mb-1">
            Tokens Owned
          </p>
          <p className="text-2xl font-bold">{tokenAmount.toLocaleString()}</p>
          <p className="text-green-300 text-xs">Project tokens</p>
        </div>
        <div className="bg-white/10 rounded-xl p-4">
          <p className="text-green-300 text-xs uppercase tracking-wide mb-1">
            Ownership Share
          </p>
          <p className="text-2xl font-bold">
            {ownershipPct ? `${ownershipPct}%` : '—'}
          </p>
          <p className="text-green-300 text-xs">On-chain verified</p>
        </div>
        <div className="bg-white/10 rounded-xl p-4">
          <p className="text-green-300 text-xs uppercase tracking-wide mb-1">
            Milestones Released
          </p>
          <p className="text-2xl font-bold">
            {campaignState?.milestones_released ?? '—'}
          </p>
          <p className="text-green-300 text-xs">Farmer payouts</p>
        </div>
      </div>

      {/* Certificate details */}
      <div className="relative space-y-2 mb-6 text-sm">
        <div className="flex justify-between">
          <span className="text-green-300">Certificate ID</span>
          <span className="font-mono text-xs">{investmentId.slice(0, 16)}...</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-300">Deal ID</span>
          <span className="font-mono text-xs">{dealId.slice(0, 16)}...</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-300">Issued</span>
          <span>{new Date(createdAt).toLocaleDateString()}</span>
        </div>
        {sorobanContractId && (
          <div className="flex justify-between">
            <span className="text-green-300">Smart Contract</span>
            <span className="font-mono text-xs">{sorobanContractId.slice(0, 16)}...</span>
          </div>
        )}
      </div>

      {/* Blockchain links */}
      <div className="relative flex gap-3">
        {stellarTxId && (
          <a
            href={`${horizonBase}/${stellarTxId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-white/10 hover:bg-white/20 transition-colors rounded-lg py-2 text-sm font-medium"
          >
            View on Stellar
          </a>
        )}
        {sorobanContractId && (
          <a
            href={`https://stellar.expert/explorer/${
              process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet'
            }/contract/${sorobanContractId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center bg-white/10 hover:bg-white/20 transition-colors rounded-lg py-2 text-sm font-medium"
          >
            View Contract
          </a>
        )}
      </div>

      {/* Footer */}
      <div className="relative mt-4 pt-4 border-t border-white/20 text-center">
        <p className="text-green-300 text-xs">
          This certificate is backed by an immutable Stellar blockchain record.
          Ownership is verifiable on-chain at any time.
        </p>
      </div>
    </div>
  );
}
