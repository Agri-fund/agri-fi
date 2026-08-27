'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { useCurrencyFormat } from '../hooks/useCurrencyFormat';
import { useNumberFormat } from '../hooks/useNumberFormat';

interface FundingProgressBarProps {
  totalValue: number;
  totalInvested: number;
  currency?: string;
  dealId?: string;
}

const MILESTONES = [25, 50, 75, 100] as const;

function getProgressColor(pct: number): string {
  if (pct >= 100) return 'bg-emerald-500';
  if (pct >= 50) return 'bg-blue-500';
  return 'bg-amber-500';
}

function getGradientBg(pct: number): string {
  if (pct >= 100) return 'from-emerald-400 to-emerald-600';
  if (pct >= 50) return 'from-blue-400 to-indigo-500';
  return 'from-amber-400 to-orange-500';
}

function ConfettiBurst() {
  const particles = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * 200,
    y: -(Math.random() * 80 + 40),
    rotation: Math.random() * 360,
    color: ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444'][i % 5],
    delay: Math.random() * 0.3,
    size: 6 + Math.random() * 4,
  }));

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-sm"
          style={{
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            left: '50%',
            bottom: '50%',
          }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{
            x: p.x,
            y: p.y,
            opacity: 0,
            rotate: p.rotation,
          }}
          transition={{
            duration: 1.2,
            delay: p.delay,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
}

export default function FundingProgressBar({
  totalValue,
  totalInvested,
  currency = 'USD',
  dealId,
}: FundingProgressBarProps) {
  const t = useTranslations('deals');
  const { formatCurrency } = useCurrencyFormat();
  const { formatNumber } = useNumberFormat();
  const prefersReduced = useReducedMotion();
  const [hasAnimated, setHasAnimated] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [liveTotal, setLiveTotal] = useState(totalInvested);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pct = totalValue > 0 ? Math.min((liveTotal / totalValue) * 100, 100) : 0;
  const remaining = Math.max(totalValue - liveTotal, 0);

  useEffect(() => {
    if (!dealId) return;

    let socket: any = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = async () => {
      try {
        const { io } = await import('socket.io-client');
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

        socket = io({
          path: '/api/socket.io',
          auth: { token },
          transports: ['websocket', 'polling'],
        });

        socket.on('funding_updated', (data: { dealId: string; totalInvested: number }) => {
          if (!mountedRef.current) return;
          if (data.dealId === dealId) {
            setLiveTotal(data.totalInvested);
          }
        });

        socket.on('connect_error', () => {
          reconnectTimeout = setTimeout(connect, 5000);
        });
      } catch {
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (socket) {
        socket.off('funding_updated');
        socket.disconnect();
      }
    };
  }, [dealId]);

  useEffect(() => {
    if (!hasAnimated) {
      setHasAnimated(true);
    }
  }, [hasAnimated]);

  useEffect(() => {
    if (pct >= 100 && hasAnimated) {
      const t = setTimeout(() => setShowConfetti(true), 300);
      return () => clearTimeout(t);
    }
  }, [pct, hasAnimated]);

  const animationDuration = prefersReduced ? 0 : 0.8;

  return (
    <div className="relative w-full min-w-0 space-y-1.5" dir="auto">
      {showConfetti && <ConfettiBurst />}
      <div className="flex flex-wrap justify-between gap-2 text-xs font-medium">
        <span className="min-w-0 text-slate-500">
          {t('raised', {
            amount: formatCurrency(liveTotal, currency),
          })}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {pct >= 100 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60">
              Fully Funded
            </span>
          )}
          <span className="text-brand-600 font-bold">
            {formatNumber(pct, { decimalPlaces: 1 })}%
          </span>
        </div>
      </div>
      <div className="progress-track relative">
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${getGradientBg(pct)}`}
          initial={prefersReduced ? { width: `${pct}%` } : { width: '0%' }}
          animate={{ width: `${pct}%` }}
          transition={{
            duration: animationDuration,
            ease: 'easeOut',
            delay: prefersReduced ? 0 : 0.1,
          }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Funding progress: ${formatNumber(pct, { decimalPlaces: 1 })}%`}
        />
        {/* Milestone markers */}
        {MILESTONES.map((m) => (
          <div
            key={m}
            className="absolute top-0 h-full flex items-center"
            style={{ left: `${m}%` }}
          >
            <div
              className={`w-px h-full ${pct >= m ? 'bg-white/40' : 'bg-slate-300/60'}`}
            />
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 group">
              <span
                className={`text-[9px] font-medium ${
                  pct >= m ? 'text-slate-600' : 'text-slate-400'
                }`}
              >
                {m}%
              </span>
              <div className="absolute top-4 left-1/2 z-10 hidden max-w-[calc(100vw-2rem)] -translate-x-1/2 group-hover:block">
                <div className="bg-slate-800 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap shadow-lg">
                  {formatCurrency((totalValue * m) / 100, currency)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-400">
        {t('remainingOf', {
          remaining: formatCurrency(remaining, currency),
          total: formatCurrency(totalValue, currency),
        })}
      </p>
    </div>
  );
}
