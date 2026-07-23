'use client';

import { useState, useMemo } from 'react';
import { Deal } from '@/lib/api';
import { InvestmentForm } from '../InvestmentForm';

interface InvestmentModalProps {
  deal: Deal;
  onClose: () => void;
}

export function InvestmentModal({ deal, onClose }: InvestmentModalProps) {
  const [tokenQuantity, setTokenQuantity] = useState<number>(1);
  
  const tokenPrice = Number(deal.total_value) / Number(deal.token_count);
  const annualRoi = deal.annual_roi ?? 0.15;
  const termDays = deal.term_days ?? 90;
  
  const principal = tokenQuantity * tokenPrice;
  // Formula: expected return = principal * (1 + annual_roi * term_days / 365)
  const expectedReturn = principal * (1 + (annualRoi * termDays) / 365);
  const profit = expectedReturn - principal;
  
  // Simulated fees: 1.5% of principal
  const platformFee = principal * 0.015;
  const netReturn = expectedReturn - platformFee;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col md:flex-row shadow-emerald-900/20">
        {/* Left Side: ROI Calculator Panel */}
        <div className="bg-emerald-600 p-8 text-white md:w-5/12 flex flex-col justify-between">
          <div>
            <h2 className="text-2xl font-black mb-2 flex items-center gap-2">
              <span>📈</span> ROI Stats
            </h2>
            <p className="text-emerald-100 text-sm mb-8">Real-time earnings projection</p>
            
            <div className="space-y-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200">Expected ROI</p>
                <p className="text-3xl font-black">{(annualRoi * 100).toFixed(1)}%</p>
              </div>
              
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200">Term Length</p>
                <p className="text-xl font-bold">{termDays} Days</p>
              </div>
              
              <div className="pt-6 border-t border-emerald-500/50">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200">Estimated Payout</p>
                <p className="text-4xl font-black text-yellow-300">
                  ${netReturn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-emerald-100 mt-1 italic">
                  Net of platform fees (${platformFee.toFixed(2)})
                </p>
              </div>
            </div>
          </div>
          
          <div className="mt-8 p-4 bg-white/10 rounded-2xl border border-white/10 text-xs">
            <p className="font-semibold text-emerald-50">Token Economics</p>
            <div className="flex justify-between mt-2">
              <span className="text-emerald-200">Profit:</span>
              <span className="font-bold text-emerald-50">+${profit.toFixed(2)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-emerald-200">Maturity:</span>
              <span className="font-bold text-emerald-50">
                {new Date(deal.delivery_date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: Investment Form */}
        <div className="p-8 md:w-7/12 bg-white relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          <h3 className="text-xl font-bold text-slate-900 mb-6">Invest in {deal.commodity}</h3>
          
          <div className="space-y-6">
            <InvestmentForm
              dealId={deal.id}
              maxTokens={deal.tokens_remaining}
              tokenPrice={tokenPrice}
              onQuantityChange={(qty) => setTokenQuantity(qty)}
              onSuccess={() => {
                // Success handled by InvestmentForm internal state, but we could close modal here
              }}
            />
            
            {/* We hook into the same state to sync the ROI calculator */}
            {/* Note: In a real app we'd use a context or lift state up, 
                but here we'll let InvestmentForm handle the submission. */}
          </div>
          
          <div className="mt-6 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Secure Stellar Escrow · Cancel anytime</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
