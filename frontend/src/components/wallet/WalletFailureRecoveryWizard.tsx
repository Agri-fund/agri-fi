'use client';

import React, { useState } from 'react';
import { AlertCircle, RefreshCw, ExternalLink, CheckCircle2, ShieldAlert } from 'lucide-react';

export interface WalletFailureRecoveryWizardProps {
  isOpen: boolean;
  onClose: () => void;
  targetNetwork?: 'PUBLIC' | 'TESTNET';
  currentNetwork?: string;
  errorMessage?: string;
  onRetry?: () => void;
  onFallbackToAlbedo?: () => void;
}

export const WalletFailureRecoveryWizard: React.FC<WalletFailureRecoveryWizardProps> = ({
  isOpen,
  onClose,
  targetNetwork = 'TESTNET',
  currentNetwork = 'PUBLIC',
  errorMessage,
  onRetry,
  onFallbackToAlbedo,
}) => {
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);

  if (!isOpen) return null;

  const isNetworkMismatch =
    Boolean(errorMessage?.toLowerCase().includes('network')) ||
    Boolean(errorMessage?.toLowerCase().includes('passphrase')) ||
    (currentNetwork && targetNetwork && currentNetwork.toUpperCase() !== targetNetwork.toUpperCase());

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl text-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 id="wizard-title" className="text-lg font-bold">
              Transaction Recovery Wizard
            </h3>
            <p className="text-xs text-slate-400">Step {activeStep} of 3: Network & Signing Diagnosis</p>
          </div>
        </div>

        {/* Step 1: Issue Diagnosis */}
        {activeStep === 1 && (
          <div className="space-y-4">
            <div className="p-3.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-sm space-y-2">
              <div className="flex items-center gap-2 text-amber-300 font-semibold">
                <AlertCircle className="w-4 h-4" />
                {isNetworkMismatch ? 'Network Passphrase Mismatch Detected' : 'Signing Interaction Failed'}
              </div>
              <p className="text-xs text-slate-300">
                {isNetworkMismatch
                  ? `Your connected wallet is set to ${currentNetwork || 'another network'}, but Agri-Fi requires ${targetNetwork}.`
                  : errorMessage || 'The transaction could not be signed in the connected wallet.'}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
              >
                Dismiss
              </button>
              <button
                onClick={() => setActiveStep(2)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5"
              >
                How to Fix in Freighter
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Switch Guide */}
        {activeStep === 2 && (
          <div className="space-y-4">
            <ol className="list-decimal list-inside text-xs text-slate-300 space-y-2 bg-slate-800/50 p-4 rounded-xl border border-slate-700/40">
              <li>Open your <strong>Freighter browser extension</strong>.</li>
              <li>Click on the <strong>Network dropdown</strong> at the top right.</li>
              <li>Select <strong>{targetNetwork === 'PUBLIC' ? 'Public Network' : 'Test Net'}</strong>.</li>
              <li>Return here and click <strong>Retry Transaction</strong>.</li>
            </ol>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => setActiveStep(3)}
                className="text-xs text-amber-400 hover:underline flex items-center gap-1"
              >
                Still failing? Try Albedo fallback
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => setActiveStep(1)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    onRetry?.();
                    onClose();
                  }}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry Now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Albedo Fallback */}
        {activeStep === 3 && (
          <div className="space-y-4">
            <div className="p-4 bg-sky-950/40 border border-sky-800/50 rounded-xl text-xs text-sky-200 space-y-2">
              <p className="font-semibold text-sky-300">Albedo Web Signing Fallback</p>
              <p>
                Albedo works directly in the browser without extension network conflicts and supports testnet and mainnet seamlessly.
              </p>
            </div>

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setActiveStep(2)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
              >
                Back
              </button>
              <button
                onClick={() => {
                  onFallbackToAlbedo?.();
                  onClose();
                }}
                className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Sign with Albedo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WalletFailureRecoveryWizard;
