"use client";

import React, { useState, useEffect, useCallback } from "react";

export interface PlatformLiveStats {
  totalFunded: number;
  totalFundedFormatted: string;
  activeFarmers: number;
  activeFarmersFormatted: string;
  dealsCompleted: number;
  dealsCompletedFormatted: string;
  avgReturn: number;
  avgReturnFormatted: string;
  updatedAt?: string;
}

const DEFAULT_STATS: PlatformLiveStats = {
  totalFunded: 2840000,
  totalFundedFormatted: "$2.8M+",
  activeFarmers: 384,
  activeFarmersFormatted: "380+",
  dealsCompleted: 142,
  dealsCompletedFormatted: "140+",
  avgReturn: 14.8,
  avgReturnFormatted: "14.8%",
};

/* ── Reduced motion and animated counter hook ────────────────────────────── */
function useLiveCounter(target: string, prefersReducedMotion: boolean, duration = 1400) {
  const [display, setDisplay] = useState(target);

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplay(target);
      return;
    }

    const num = parseFloat(target.replace(/[^0-9.]/g, ""));
    const suffix = target.replace(/[0-9.,]/g, "");
    if (isNaN(num)) {
      setDisplay(target);
      return;
    }

    let start = 0;
    const step = num / (duration / 16);
    const timer = setInterval(() => {
      start = Math.min(start + step, num);
      setDisplay(
        (start < 1000
          ? start.toFixed(start < 10 ? 1 : 0)
          : Math.round(start).toLocaleString()) + suffix,
      );
      if (start >= num) clearInterval(timer);
    }, 16);

    return () => clearInterval(timer);
  }, [target, duration, prefersReducedMotion]);

  return display;
}

function StatCard({
  value,
  label,
  icon,
  detail,
  prefersReducedMotion,
}: {
  value: string;
  label: string;
  icon: string;
  detail: string;
  prefersReducedMotion: boolean;
}) {
  const display = useLiveCounter(value, prefersReducedMotion);

  return (
    <div className="relative group p-5 rounded-2xl bg-white/70 hover:bg-white border border-slate-200/80 hover:border-brand-300 shadow-sm hover:shadow-md transition-all duration-300 backdrop-blur-sm text-center">
      <div className="text-3xl mb-2 group-hover:scale-110 transition-transform duration-200">
        {icon}
      </div>
      <p className="text-3xl sm:text-4xl font-black text-brand-700 tracking-tight tabular-nums">
        {display}
      </p>
      <p className="text-sm font-bold text-slate-800 mt-1">{label}</p>
      <p className="text-xs text-slate-400 mt-0.5 font-medium">{detail}</p>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="p-5 rounded-2xl bg-slate-50/80 border border-slate-200/60 text-center animate-pulse">
      <div className="w-10 h-10 mx-auto rounded-full bg-slate-200 mb-3" />
      <div className="h-9 w-28 mx-auto rounded-lg bg-slate-200 mb-2" />
      <div className="h-4 w-20 mx-auto rounded bg-slate-200 mb-1" />
      <div className="h-3 w-16 mx-auto rounded bg-slate-100" />
    </div>
  );
}

export function LiveStatsBand() {
  const [stats, setStats] = useState<PlatformLiveStats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  // Check reduced motion preference
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);
      const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setStats({
          totalFunded: data.totalFunded ?? DEFAULT_STATS.totalFunded,
          totalFundedFormatted: data.totalFundedFormatted || DEFAULT_STATS.totalFundedFormatted,
          activeFarmers: data.activeFarmers ?? DEFAULT_STATS.activeFarmers,
          activeFarmersFormatted: data.activeFarmersFormatted || DEFAULT_STATS.activeFarmersFormatted,
          dealsCompleted: data.dealsCompleted ?? DEFAULT_STATS.dealsCompleted,
          dealsCompletedFormatted: data.dealsCompletedFormatted || DEFAULT_STATS.dealsCompletedFormatted,
          avgReturn: data.avgReturn ?? DEFAULT_STATS.avgReturn,
          avgReturnFormatted: data.avgReturnFormatted || DEFAULT_STATS.avgReturnFormatted,
          updatedAt: data.updatedAt,
        });
        setLastRefreshed(new Date().toLocaleTimeString());
      }
    } catch {
      // Graceful fallback to default stats if network is unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const items = [
    {
      value: stats.totalFundedFormatted,
      label: "Total Funded",
      icon: "💰",
      detail: "Escrowed & disbursed on Stellar",
    },
    {
      value: stats.activeFarmersFormatted,
      label: "Active Farmers",
      icon: "🌾",
      detail: "Verified smallholders supported",
    },
    {
      value: stats.dealsCompletedFormatted,
      label: "Deals Completed",
      icon: "📦",
      detail: "100% milestone settled",
    },
    {
      value: stats.avgReturnFormatted,
      label: "Average Return",
      icon: "📈",
      detail: "Historical harvest APY",
    },
  ];

  return (
    <section className="relative py-12 bg-gradient-to-b from-white via-brand-50/20 to-white border-y border-slate-200/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Live Platform Metrics
            </span>
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>Synchronized with Soroban Ledgers</span>
            {lastRefreshed && (
              <span className="hidden sm:inline text-slate-300">| Updated {lastRefreshed}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {loading ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            items.map((item) => (
              <StatCard
                key={item.label}
                {...item}
                prefersReducedMotion={prefersReducedMotion}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export default LiveStatsBand;
