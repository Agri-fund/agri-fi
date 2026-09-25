'use client';

/**
 * WalletSelectionModal — Issue #853
 *
 * Wallet connection onboarding flow:
 * - Freighter (browser extension) with install guide if missing
 * - Albedo (web-based, no install needed)
 * - WalletConnect (coming soon placeholder)
 * - Network mismatch warning banner
 * - Full i18n via next-intl
 */

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { WalletProvider } from '@/hooks/useWallet';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WalletSelectionModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Called when the user closes the modal */
  onClose: () => void;
  /** Called when the user picks a wallet and connection succeeds */
  onConnect: (provider: WalletProvider) => Promise<void>;
  /** Wallets detected as installed in the browser */
  availableWallets: WalletProvider[];
  /** True while a connection is in progress */
  isConnecting: boolean;
  /** Error string to display, or null */
  error: string | null;
  /**
   * When set, a network mismatch banner is shown prompting the user to switch.
   * Expected values: 'testnet' | 'mainnet'
   */
  expectedNetwork?: string | null;
  /** The network currently reported by the connected wallet, if any */
  detectedNetwork?: string | null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface WalletOptionProps {
  icon: React.ReactNode;
  name: string;
  description: string;
  badge?: React.ReactNode;
  disabled?: boolean;
  comingSoon?: boolean;
  onClick?: () => void;
  accentClass?: string;
  testId?: string;
}

function WalletOption({
  icon,
  name,
  description,
  badge,
  disabled = false,
  comingSoon = false,
  onClick,
  accentClass = 'hover:border-blue-400 focus:ring-blue-400',
  testId,
}: WalletOptionProps) {
  if (comingSoon) {
    return (
      <div
        className="w-full flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 opacity-50 cursor-not-allowed select-none"
        aria-disabled="true"
        data-testid={testId}
      >
        <span className="text-2xl flex-shrink-0" aria-hidden="true">{icon}</span>
        <div className="text-left min-w-0">
          <p className="text-sm font-medium text-gray-700">{name}</p>
          <p className="text-xs text-gray-400 truncate">{description}</p>
        </div>
        <span className="ml-auto flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
          {/* Clock icon */}
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {badge}
        </span>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 ${accentClass}`}
      data-testid={testId}
    >
      <span className="text-2xl flex-shrink-0" aria-hidden="true">{icon}</span>
      <div className="text-left min-w-0">
        <p className="text-sm font-medium text-gray-800">{name}</p>
        <p className="text-xs text-gray-400 truncate">{description}</p>
      </div>
      {badge && <span className="ml-auto flex-shrink-0">{badge}</span>}
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function WalletSelectionModal({
  isOpen,
  onClose,
  onConnect,
  availableWallets,
  isConnecting,
  error,
  expectedNetwork,
  detectedNetwork,
}: WalletSelectionModalProps) {
  const t = useTranslations('wallet');
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const freighterInstalled = availableWallets.includes('freighter');
  const showNetworkMismatch =
    !!expectedNetwork &&
    !!detectedNetwork &&
    detectedNetwork.toLowerCase() !== expectedNetwork.toLowerCase();

  // ── Focus management ───────────────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Move focus into the panel after the DOM settles
      requestAnimationFrame(() => {
        const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
          'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])',
        );
        firstFocusable?.focus();
      });
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // ── Keyboard handling ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }

      // Focus trap
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      data-testid="wallet-selection-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wsm-title"
        aria-describedby="wsm-description"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        data-testid="wallet-selection-modal"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 id="wsm-title" className="text-base font-semibold text-gray-900">
              {t('onboarding.title')}
            </h2>
            <p id="wsm-description" className="text-xs text-gray-500 mt-0.5">
              {t('onboarding.subtitle')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400"
            aria-label={t('closeDialog')}
            data-testid="wsm-close-btn"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Network mismatch banner ── */}
        {showNetworkMismatch && (
          <div
            role="alert"
            className="mx-4 mt-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800"
            data-testid="network-mismatch-banner"
          >
            <svg
              className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span>
              {t('onboarding.networkMismatch', {
                detected: detectedNetwork,
                expected: expectedNetwork,
              })}
            </span>
          </div>
        )}

        {/* ── Body ── */}
        <div className="px-6 py-5 space-y-3">

          {/* Privacy notice */}
          <p className="text-xs text-gray-400">{t('description')}</p>

          {/* ── Freighter ── */}
          <WalletOption
            icon="🚀"
            name={t('freighter.name')}
            description={t('freighter.type')}
            disabled={isConnecting}
            onClick={() => onConnect('freighter')}
            accentClass="hover:border-blue-400 focus:ring-blue-400"
            testId="wsm-freighter-btn"
            badge={
              freighterInstalled ? (
                <span className="text-xs text-green-600 font-medium">{t('detected')}</span>
              ) : (
                <a
                  href="https://freighter.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-blue-500 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-400 rounded px-1"
                  data-testid="wsm-freighter-install-link"
                >
                  {t('install')}
                </a>
              )
            }
          />

          {/* Freighter install guide (shown only when Freighter is missing) */}
          {!freighterInstalled && (
            <div
              className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 space-y-1"
              data-testid="wsm-freighter-install-guide"
            >
              <p className="font-medium">{t('onboarding.freighterGuide.title')}</p>
              <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
                <li>{t('onboarding.freighterGuide.step1')}</li>
                <li>{t('onboarding.freighterGuide.step2')}</li>
                <li>{t('onboarding.freighterGuide.step3')}</li>
              </ol>
              <a
                href="https://freighter.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 font-medium text-blue-500 hover:underline focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
                data-testid="wsm-freighter-guide-link"
              >
                {t('onboarding.freighterGuide.cta')}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            </div>
          )}

          {/* ── Albedo ── */}
          <WalletOption
            icon="🌐"
            name={t('albedo.name')}
            description={t('albedo.type')}
            disabled={isConnecting}
            onClick={() => onConnect('albedo')}
            accentClass="hover:border-purple-400 focus:ring-purple-400"
            testId="wsm-albedo-btn"
            badge={
              <span className="text-xs text-green-600 font-medium">{t('alwaysAvailable')}</span>
            }
          />

          {/* ── WalletConnect (coming soon) ── */}
          <WalletOption
            icon="🔗"
            name={t('walletConnect.name')}
            description={t('walletConnect.type')}
            comingSoon
            testId="wsm-walletconnect-btn"
            badge={<span>{t('onboarding.comingSoon')}</span>}
          />

          {/* ── Error message ── */}
          {error && (
            <p
              role="alert"
              className="text-sm text-red-600 rounded-lg bg-red-50 border border-red-100 px-4 py-2"
              data-testid="wsm-error"
            >
              {error}
            </p>
          )}

          {/* ── Loading indicator ── */}
          {isConnecting && (
            <div
              className="flex items-center justify-center gap-2 py-1 text-sm text-gray-500"
              aria-live="polite"
              data-testid="wsm-connecting"
            >
              <svg
                className="w-4 h-4 animate-spin text-blue-500"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {t('connecting')}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 pb-5">
          <p className="text-[11px] text-gray-400 text-center leading-relaxed">
            {t('onboarding.termsNote')}
          </p>
        </div>
      </div>
    </div>
  );
}
