'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { apiClient, User } from '@/lib/api';

interface Referral {
  id: string;
  refereeId: string | null;
  status: 'clicked' | 'registered' | 'rewarded';
  rewardAmount: number;
  createdAt: string;
  referee?: { email: string } | null;
}

interface ReferralStats {
  code: string;
  totalClicks: number;
  totalRegistered: number;
  totalRewarded: number;
  totalRewardAmount: number;
  referrals: Referral[];
}

export default function ReferralsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const u = apiClient.getCurrentUser();
    if (!u) {
      window.location.href = '/login';
      return;
    }
    setUser(u);
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('http://localhost:3001/v1/users/me/referrals', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch referral stats', err);
    } finally {
      setLoading(false);
    }
  };

  if (!user || loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
      </div>
    );
  }

  const referralLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/register?ref=${stats?.code ?? ''}`;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = referralLink;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareWhatsApp = () => {
    const msg = encodeURIComponent(
      `Join Agri-Fi and invest in agricultural trade deals! Use my referral link: ${referralLink}`,
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  const shareTwitter = () => {
    const msg = encodeURIComponent(
      `Check out Agri-Fi - blockchain-backed agricultural trade finance! Use my referral: ${referralLink}`,
    );
    window.open(`https://twitter.com/intent/tweet?text=${msg}`, '_blank');
  };

  const statusColors: Record<string, string> = {
    clicked: 'bg-yellow-100 text-yellow-700',
    registered: 'bg-blue-100 text-blue-700',
    rewarded: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <DashboardLayout user={user}>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Referral Program</h1>
          <p className="text-slate-600 mt-1">
            Share your referral link and earn rewards when referred users make their first investment.
          </p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Link Clicks', value: stats?.totalClicks ?? 0, color: 'bg-slate-100' },
            { label: 'Registered', value: stats?.totalRegistered ?? 0, color: 'bg-blue-50' },
            { label: 'Rewarded', value: stats?.totalRewarded ?? 0, color: 'bg-emerald-50' },
            { label: 'Total Earned', value: `$${(stats?.totalRewardAmount ?? 0).toFixed(2)}`, color: 'bg-violet-50' },
          ].map((card) => (
            <div key={card.label} className={`p-4 rounded-xl ${card.color}`}>
              <p className="text-xs font-semibold text-slate-500 uppercase">{card.label}</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{card.value}</p>
            </div>
          ))}
        </div>

        {/* Referral link */}
        <div className="p-5 rounded-xl border border-slate-200 bg-white space-y-4">
          <h2 className="font-semibold text-slate-900">Your Referral Link</h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={referralLink}
              className="flex-1 px-4 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700 font-mono"
            />
            <button
              onClick={copyToClipboard}
              className={`px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {/* Share buttons */}
          <div className="flex gap-2">
            <button
              onClick={shareWhatsApp}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.611.611l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.37 0-4.567-.814-6.3-2.18l-.44-.352-3.242 1.087 1.087-3.242-.352-.44A9.96 9.96 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z" />
              </svg>
              WhatsApp
            </button>
            <button
              onClick={shareTwitter}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 text-white text-sm font-semibold hover:bg-sky-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Twitter
            </button>
          </div>
        </div>

        {/* Referral table */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Referred Users</h2>
          </div>
          {stats?.referrals && stats.referrals.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left px-5 py-3 font-semibold text-slate-600">User</th>
                    <th className="text-left px-5 py-3 font-semibold text-slate-600">Status</th>
                    <th className="text-left px-5 py-3 font-semibold text-slate-600">Reward</th>
                    <th className="text-left px-5 py-3 font-semibold text-slate-600">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.referrals.map((ref) => (
                    <tr key={ref.id} className="border-t border-slate-100">
                      <td className="px-5 py-3 text-slate-700">
                        {ref.referee?.email ?? 'Anonymous'}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${statusColors[ref.status]}`}>
                          {ref.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-700">
                        {ref.status === 'rewarded' ? `$${Number(ref.rewardAmount).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {new Date(ref.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 py-10 text-center text-slate-500">
              <p className="text-lg mb-1">No referrals yet</p>
              <p className="text-sm">Share your link to start earning rewards!</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
