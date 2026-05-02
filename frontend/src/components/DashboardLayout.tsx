'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { apiClient, User } from '@/lib/api';

/* ── Nav config ───────────────────────────────────────────────────────────── */
interface NavItem { label: string; href: string; icon: ReactNode; exact?: boolean; }

const farmerNav: NavItem[] = [
  { label: 'Dashboard',   href: '/dashboard/farmer',  icon: <HomeIcon />,   exact: true },
  { label: 'Marketplace', href: '/marketplace',        icon: <ShopIcon /> },
];
const traderNav: NavItem[] = [
  { label: 'Dashboard',   href: '/dashboard/trader',  icon: <HomeIcon />,   exact: true },
  { label: 'Marketplace', href: '/marketplace',        icon: <ShopIcon /> },
];
const investorNav: NavItem[] = [
  { label: 'Dashboard',   href: '/dashboard/investor', icon: <HomeIcon />,  exact: true },
  { label: 'Marketplace', href: '/marketplace',         icon: <ShopIcon /> },
];
const adminNav: NavItem[] = [
  { label: 'Dashboard',   href: '/dashboard/admin',   icon: <HomeIcon />,   exact: true },
  { label: 'Marketplace', href: '/marketplace',        icon: <ShopIcon /> },
];

function navForRole(role: string): NavItem[] {
  if (role === 'farmer')   return farmerNav;
  if (role === 'trader')   return traderNav;
  if (role === 'investor') return investorNav;
  if (role === 'admin')    return adminNav;
  return farmerNav;
}

/* ── Role theming ─────────────────────────────────────────────────────────── */
const ROLE_THEME: Record<string, { accent: string; light: string; text: string; label: string; emoji: string }> = {
  farmer:       { accent: 'bg-emerald-600', light: 'bg-emerald-50',  text: 'text-emerald-700', label: 'Farmer',   emoji: '👨‍🌾' },
  trader:       { accent: 'bg-blue-600',    light: 'bg-blue-50',     text: 'text-blue-700',    label: 'Trader',   emoji: '🤝' },
  investor:     { accent: 'bg-violet-600',  light: 'bg-violet-50',   text: 'text-violet-700',  label: 'Investor', emoji: '💼' },
  company_admin:{ accent: 'bg-orange-600',  light: 'bg-orange-50',   text: 'text-orange-700',  label: 'Company',  emoji: '🏢' },
  admin:        { accent: 'bg-slate-800',   light: 'bg-slate-100',   text: 'text-slate-700',   label: 'Admin',    emoji: '⚙️' },
};

/* ── Component ────────────────────────────────────────────────────────────── */
interface Props { user: User; children: ReactNode; }

export default function DashboardLayout({ user, children }: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav   = navForRole(user.role);
  const theme = ROLE_THEME[user.role] ?? ROLE_THEME.farmer;

  const handleLogout = async () => {
    try { await apiClient.logout(); } catch { apiClient.clearAuth(); }
    router.push('/login');
  };

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  /* ── Sidebar ── */
  const Sidebar = ({ onClose }: { onClose?: () => void }) => (
    <aside className="flex flex-col h-full w-[15rem] bg-white border-r border-slate-100">
      {/* Logo */}
      <div className="px-5 h-16 flex items-center border-b border-slate-100 flex-shrink-0">
        <Link href="/" onClick={onClose} className="flex items-center gap-2.5 group">
          <span className="text-2xl group-hover:animate-bounce-sm">🌾</span>
          <span className="font-black text-slate-900 text-base tracking-tight">AgriFi</span>
        </Link>
      </div>

      {/* User card */}
      <div className="px-4 py-4 border-b border-slate-100 flex-shrink-0">
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50">
          <div className={`w-9 h-9 rounded-xl ${theme.accent} flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm`}>
            {theme.emoji}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-900 truncate">{user.email}</p>
            <span className={`inline-flex items-center gap-1 text-xs font-semibold mt-0.5 ${theme.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${theme.accent}`} />
              {theme.label}
            </span>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Menu</p>
        {nav.map(item => {
          const active = isActive(item);
          return (
            <Link key={item.href + item.label} href={item.href} onClick={onClose}
              className={active ? 'nav-link-active' : 'nav-link'}>
              <span className="w-4 h-4 flex-shrink-0 opacity-80">{item.icon}</span>
              {item.label}
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/60" />}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-3 py-4 border-t border-slate-100 flex-shrink-0 space-y-1">
        <Link href="/kyc" onClick={onClose} className="nav-link text-xs">
          <ShieldIcon /> KYC Status
          {user.kycStatus === 'verified'
            ? <span className="ml-auto badge-green text-[10px] py-0">Verified</span>
            : <span className="ml-auto badge-yellow text-[10px] py-0">Pending</span>
          }
        </Link>
        <button onClick={handleLogout}
          className="nav-link w-full text-left hover:bg-red-50 hover:text-red-600">
          <LogoutIcon />
          Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)} />
          <div className="relative z-50 flex flex-col h-full animate-slide-up">
            <Sidebar onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center justify-between px-4 h-14 bg-white border-b border-slate-100 flex-shrink-0">
          <button onClick={() => setMobileOpen(true)}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
            <MenuIcon />
          </button>
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl">🌾</span>
            <span className="font-black text-slate-900 text-base">AgriFi</span>
          </Link>
          <div className={`w-8 h-8 rounded-xl ${theme.accent} flex items-center justify-center text-white text-sm`}>
            {theme.emoji}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

/* ── Icons ────────────────────────────────────────────────────────────────── */
function HomeIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>; }
function ShopIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>; }
function ShieldIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>; }
function LogoutIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>; }
function MenuIcon()   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>; }
