'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User } from '@/lib/api';
import { WalletModal } from '../wallet/WalletModal';
import { useStellarWallet, DisconnectReason } from '@/hooks/useStellarWallet';
import { useToast } from '@/components/ui/ToastProvider';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { NotificationBell } from './NotificationBell';

interface HeaderProps {
  user: User;
  onLogout: () => void;
}

const ROLE_THEME: Record<string, { accent: string; label: string; emoji: string }> = {
  farmer:       { accent: 'bg-emerald-600', label: 'Farmer',   emoji: '👨‍🌾' },
  trader:       { accent: 'bg-blue-600',    label: 'Trader',   emoji: '🤝' },
  investor:     { accent: 'bg-violet-600',  label: 'Investor', emoji: '💼' },
  company_admin:{ accent: 'bg-orange-600',  label: 'Company',  emoji: '🏢' },
  admin:        { accent: 'bg-slate-800',   label: 'Admin',    emoji: '⚙️' },
};

export const Header: React.FC<HeaderProps> = ({ user, onLogout }) => {
  const t = useTranslations();
  const [isOpen, setIsOpen] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const pathname = usePathname();
  const { toast } = useToast();

  const handleExternalDisconnect = useCallback(
    (reason: DisconnectReason) => {
      if (reason === 'account_changed') {
        toast(
          t('wallet.errorConnect'),
          'warning',
        );
      } else {
        toast(
          t('wallet.errorConnect'),
          'warning',
        );
      }
    },
    [toast, t],
  );

  const { status, displayKey, network } = useStellarWallet({
    onDisconnect: handleExternalDisconnect,
  });
  const theme = ROLE_THEME[user.role] ?? ROLE_THEME.farmer;

  // Close drawer on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Prevent scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  const navLinks = [
    { label: t('nav.dashboard'), href: `/dashboard/${user.role}` },
    { label: t('nav.marketplace'), href: '/marketplace' },
    { label: t('nav.documents'), href: '/dashboard/documents' },
    { label: t('nav.settings'), href: '/settings' },
  ];

  const toggleMenu = () => setIsOpen(!isOpen);

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 px-4 md:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="text-2xl group-hover:animate-bounce-sm transition-transform">🌾</span>
          <span className="font-black text-slate-900 dark:text-slate-100 text-lg tracking-tight">AgriFi</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              data-tour={link.href.includes('marketplace') ? 'nav-marketplace' : undefined}
              className={`text-sm font-medium transition-colors hover:text-emerald-600 ${
                pathname === link.href ? 'text-emerald-600' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-2" />
          <div data-tour="notification-bell"><NotificationBell /></div>
          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-2" />
          <LanguageSwitcher />
          <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-2" />
          {/* Wallet status indicator */}
          <button
            data-tour="wallet-button"
            onClick={() => setShowWalletModal(true)}
            className={`flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-xl transition-colors ${
              status === 'connected'
                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
              status === 'connected' ? 'bg-emerald-500' :
              status === 'connecting' ? 'bg-amber-400 animate-pulse' :
              'bg-slate-400'
            }`} />
            {status === 'connected' && displayKey ? (
              <span className="font-mono">{displayKey}</span>
            ) : status === 'connecting' ? (
              t('wallet.connecting')
            ) : (
              t('wallet.connectButton')
            )}
            {status === 'connected' && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                network === 'Public' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {network}
              </span>
            )}
          </button>
        </nav>

        {/* Hamburger Menu Button — CSS-only animated icon, no framer-motion */}
        <button
          onClick={toggleMenu}
          className="md:hidden p-2 -mr-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
          aria-expanded={isOpen}
          aria-label={t('nav.menu')}
        >
          <div className="w-6 h-5 relative flex flex-col justify-between items-center">
            {/* Top bar: rotates to form the top arm of × */}
            <span
              className={`w-full h-0.5 bg-slate-900 dark:bg-slate-100 rounded-full origin-center transition-transform duration-300 ${
                isOpen ? 'translate-y-[9px] rotate-45' : ''
              }`}
            />
            {/* Middle bar: fades out when open */}
            <span
              className={`w-full h-0.5 bg-slate-900 dark:bg-slate-100 rounded-full transition-opacity duration-200 ${
                isOpen ? 'opacity-0' : 'opacity-100'
              }`}
            />
            {/* Bottom bar: rotates to form the bottom arm of × */}
            <span
              className={`w-full h-0.5 bg-slate-900 dark:bg-slate-100 rounded-full origin-center transition-transform duration-300 ${
                isOpen ? '-translate-y-[9px] -rotate-45' : ''
              }`}
            />
          </div>
        </button>
      </header>

      {/* Mobile Drawer — CSS transitions, no framer-motion dependency */}
      {/* Backdrop */}
      <div
        onClick={() => setIsOpen(false)}
        className={`fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm md:hidden transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 z-[70] w-[80%] max-w-sm bg-white dark:bg-slate-900 shadow-2xl md:hidden flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        {/* Drawer Header */}
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <span className="font-bold text-slate-900 dark:text-slate-100">Menu</span>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* User Summary */}
        <div className="p-6 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl ${theme.accent} flex items-center justify-center text-white text-xl shadow-lg`}>
              {theme.emoji}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-slate-900 dark:text-slate-100 truncate">{user.email}</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {theme.label} Account
              </p>
            </div>
          </div>
          <div className="mt-6">
            {/* Wallet status in mobile drawer */}
            <button
              onClick={() => { setIsOpen(false); setShowWalletModal(true); }}
              className={`w-full flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors ${
                status === 'connected'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                status === 'connected' ? 'bg-emerald-500' : 'bg-slate-400'
              }`} />
              {status === 'connected' && displayKey ? (
                <span className="font-mono">{displayKey}</span>
              ) : 'Connect Wallet'}
              {status === 'connected' && (
                <span className="ml-auto text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                  {network}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Nav Links */}
        <nav className="flex-1 p-6 space-y-2 overflow-y-auto">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold transition-all ${
                pathname === link.href
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Drawer Footer */}
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <Link
            href="/kyc"
            className="flex items-center justify-between px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              KYC Status
            </span>
            {user.kycStatus === 'verified' ? (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase tracking-widest font-bold">Verified</span>
            ) : (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase tracking-widest font-bold">Pending</span>
            )}
          </Link>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </div>

      {/* Wallet Modal */}
      {showWalletModal && <WalletModal onClose={() => setShowWalletModal(false)} />}
    </>
  );
};
