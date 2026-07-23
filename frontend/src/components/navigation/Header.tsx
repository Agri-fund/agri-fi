'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { User } from '@/lib/api';
import { WalletButton } from '../WalletButton';
import { WalletModal } from '../wallet/WalletModal';
import { useStellarWallet } from '@/hooks/useStellarWallet';
import { LanguageSwitcher } from '../LanguageSwitcher';

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
  const [isOpen, setIsOpen] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const pathname = usePathname();
  const { status, displayKey, network } = useStellarWallet();
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
    { label: 'Dashboard', href: `/dashboard/${user.role}` },
    { label: 'Marketplace', href: '/marketplace' },
    { label: 'Documents', href: '/dashboard/documents' },
    { label: 'Settings', href: '/settings' },
  ];

  const toggleMenu = () => setIsOpen(!isOpen);

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-slate-100 px-4 md:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="text-2xl group-hover:animate-bounce-sm transition-transform">🌾</span>
          <span className="font-black text-slate-900 text-lg tracking-tight">AgriFi</span>
        </Link>

        {/* Desktop Navigation (Optional but good for completeness) */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-emerald-600 ${
                pathname === link.href ? 'text-emerald-600' : 'text-slate-600'
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="h-6 w-px bg-slate-200 mx-2" />
          <LanguageSwitcher />
          <div className="h-6 w-px bg-slate-200 mx-2" />
          {/* Wallet status indicator — Issue #243 */}
          <button
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
              'Connecting…'
            ) : (
              'Connect Wallet'
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

        {/* Hamburger Menu Button */}
        <button
          onClick={toggleMenu}
          className="md:hidden p-2 -mr-2 rounded-xl hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
          aria-expanded={isOpen}
          aria-label="Toggle navigation menu"
        >
          <div className="w-6 h-5 relative flex flex-col justify-between items-center">
            <motion.span
              animate={isOpen ? { rotate: 45, y: 8 } : { rotate: 0, y: 0 }}
              className="w-full h-0.5 bg-slate-900 rounded-full origin-center"
            />
            <motion.span
              animate={isOpen ? { opacity: 0 } : { opacity: 1 }}
              className="w-full h-0.5 bg-slate-900 rounded-full"
            />
            <motion.span
              animate={isOpen ? { rotate: -45, y: -8 } : { rotate: 0, y: 0 }}
              className="w-full h-0.5 bg-slate-900 rounded-full origin-center"
            />
          </div>
        </button>
      </header>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm md:hidden"
            />

            {/* Drawer Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 z-[70] w-[80%] max-w-sm bg-white shadow-2xl md:hidden flex flex-col"
            >
              {/* Drawer Header */}
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-900">Menu</span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* User Summary */}
              <div className="p-6 bg-slate-50 border-b border-slate-100">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl ${theme.accent} flex items-center justify-center text-white text-xl shadow-lg`}>
                    {theme.emoji}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">{user.email}</p>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
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
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>

              {/* Drawer Footer */}
              <div className="p-6 border-t border-slate-100 space-y-3">
                <Link
                  href="/kyc"
                  className="flex items-center justify-between px-4 py-3 rounded-2xl bg-slate-100 text-slate-700 font-semibold"
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
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Wallet Modal — Issue #243 */}
      {showWalletModal && <WalletModal onClose={() => setShowWalletModal(false)} />}
    </>
  );
};
