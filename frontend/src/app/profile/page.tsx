'use client';

import { useState, useEffect } from 'react';
import { getStoredToken } from '@/lib/api';

export interface AchievementBadge {
  id: string;
  badgeType: string;
  earnedAt: string;
  grantedBy?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

const BADGE_CONFIG: Record<
  string,
  { name: string; description: string; icon: string; bg: string }
> = {
  first_investment: {
    name: 'First Investment',
    description: 'Completed your first agricultural investment',
    icon: '🌱',
    bg: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  },
  diversified: {
    name: 'Diversified',
    description: 'Invested in at least 5 different trade deals',
    icon: '🌾',
    bg: 'bg-blue-50 border-blue-200 text-blue-800',
  },
  early_bird: {
    name: 'Early Bird',
    description: 'Invested within 24 hours of deal launch',
    icon: '🌅',
    bg: 'bg-amber-50 border-amber-200 text-amber-800',
  },
  long_term: {
    name: 'Long-term Investor',
    description: 'Held an investment all the way to full maturity',
    icon: '⏳',
    bg: 'bg-purple-50 border-purple-200 text-purple-800',
  },
  impact_farmer: {
    name: 'Impact Farmer',
    description: 'Funded a trade deal for a first-time farmer',
    icon: '👨‍🌾',
    bg: 'bg-green-50 border-green-200 text-green-800',
  },
  community: {
    name: 'Community Builder',
    description: 'Referred 3 investors who completed their first investment',
    icon: '🤝',
    bg: 'bg-rose-50 border-rose-200 text-rose-800',
  },
};

export default function ProfilePage() {
  const [achievements, setAchievements] = useState<AchievementBadge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAchievements() {
      try {
        const token = getStoredToken();
        if (!token) return;
        const res = await fetch('/api/users/me/achievements', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setAchievements(data);
        }
      } catch (err) {
        console.error('Failed to load achievements', err);
      } finally {
        setLoading(false);
      }
    }
    loadAchievements();
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Investor Profile</h1>
      <p className="text-slate-600 text-sm mb-8">
        Track your agricultural impact, investment portfolio milestones, and earned achievement badges.
      </p>

      <section>
        <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          🏆 Achievement Badges
        </h2>

        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading achievements...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(BADGE_CONFIG).map(([type, config]) => {
              const earned = achievements.find((a) => a.badgeType === type);
              return (
                <div
                  key={type}
                  className={`p-5 rounded-2xl border transition-all ${
                    earned
                      ? `${config.bg} shadow-sm`
                      : 'bg-slate-50 border-slate-200 opacity-60 grayscale'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-3xl">{config.icon}</span>
                    <div>
                      <h3 className="font-bold text-sm">{config.name}</h3>
                      {earned ? (
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white/80">
                          Earned {new Date(earned.earnedAt).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">
                          Locked
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs opacity-90">{config.description}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
