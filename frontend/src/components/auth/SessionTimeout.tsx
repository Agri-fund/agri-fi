'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Time in milliseconds before the warning modal is shown (15 min) */
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** Countdown duration once the warning modal appears (60 seconds) */
const WARNING_COUNTDOWN_SECS = 60;

/** DOM events that reset the idle timer */
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'click',
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionTimeoutProps {
  /**
   * Override the idle timeout in milliseconds.
   * Defaults to IDLE_TIMEOUT_MS (15 minutes).
   */
  idleTimeoutMs?: number;
  /**
   * Override the warning countdown in seconds.
   * Defaults to WARNING_COUNTDOWN_SECS (60 seconds).
   */
  warningCountdownSecs?: number;
  /**
   * Called when the session should be ended (countdown expired or manual logout).
   * If omitted the component handles logout itself:
   *   - clears localStorage/sessionStorage auth tokens
   *   - redirects to /login
   */
  onLogout?: () => void | Promise<void>;
  /**
   * Path to redirect to after logout. Defaults to '/login'.
   */
  loginPath?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearAuthTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('auth_token');
  sessionStorage.removeItem('auth_token');
  sessionStorage.removeItem('stellar_wallet');
}

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * SessionTimeout — monitors user inactivity and shows a warning modal after
 * IDLE_TIMEOUT_MS milliseconds of no mouse/keyboard/touch activity.
 *
 * Once the warning modal appears a 60-second countdown begins. If the user
 * does not dismiss the modal in time the component logs them out and redirects
 * to the login page.
 *
 * Usage: Mount once near the root of authenticated layouts, e.g.
 *
 * ```tsx
 * // app/[locale]/dashboard/layout.tsx
 * import SessionTimeout from '@/components/auth/SessionTimeout';
 *
 * export default function DashboardLayout({ children }) {
 *   return (
 *     <>
 *       <SessionTimeout />
 *       {children}
 *     </>
 *   );
 * }
 * ```
 */
export default function SessionTimeout({
  idleTimeoutMs = IDLE_TIMEOUT_MS,
  warningCountdownSecs = WARNING_COUNTDOWN_SECS,
  onLogout,
  loginPath = '/login',
}: SessionTimeoutProps) {
  const router = useRouter();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(warningCountdownSecs);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLoggingOut = useRef(false);

  // ── Logout logic ──────────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    if (isLoggingOut.current) return;
    isLoggingOut.current = true;

    // Stop all timers
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    setShowWarning(false);

    if (onLogout) {
      await onLogout();
    } else {
      clearAuthTokens();
      router.push(loginPath);
    }
  }, [onLogout, router, loginPath]);

  // ── Countdown management ──────────────────────────────────────────────────

  const startCountdown = useCallback(() => {
    setCountdown(warningCountdownSecs);

    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          // Countdown expired — logout
          logout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [warningCountdownSecs, logout]);

  const stopCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  // ── Idle timer management ─────────────────────────────────────────────────

  const resetIdleTimer = useCallback(() => {
    if (isLoggingOut.current) return;

    // If warning is showing, user activity dismisses it
    if (showWarning) return;

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    idleTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      startCountdown();
    }, idleTimeoutMs);
  }, [showWarning, idleTimeoutMs, startCountdown]);

  // ── User stays — reset everything ─────────────────────────────────────────

  const handleStayLoggedIn = useCallback(() => {
    setShowWarning(false);
    stopCountdown();
    resetIdleTimer();
  }, [stopCountdown, resetIdleTimer]);

  // ── Mount: attach activity listeners & start idle timer ───────────────────

  useEffect(() => {
    resetIdleTimer();

    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, resetIdleTimer, { passive: true });
    });

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, resetIdleTimer);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-register listeners when resetIdleTimer reference changes
  useEffect(() => {
    ACTIVITY_EVENTS.forEach((event) => {
      window.removeEventListener(event, resetIdleTimer);
      window.addEventListener(event, resetIdleTimer, { passive: true });
    });
    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, resetIdleTimer);
      });
    };
  }, [resetIdleTimer]);

  // ── Keyboard trap: pressing Escape = stay logged in ───────────────────────

  useEffect(() => {
    if (!showWarning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleStayLoggedIn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showWarning, handleStayLoggedIn]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!showWarning) return null;

  // Urgency changes once <= 10 seconds remain
  const isUrgent = countdown <= 10;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-timeout-title"
      aria-describedby="session-timeout-desc"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden">
        {/* Countdown bar */}
        <div
          className={`h-1.5 transition-all duration-1000 ${isUrgent ? 'bg-red-500' : 'bg-amber-400'}`}
          style={{
            width: `${(countdown / warningCountdownSecs) * 100}%`,
          }}
          role="progressbar"
          aria-valuenow={countdown}
          aria-valuemin={0}
          aria-valuemax={warningCountdownSecs}
          aria-label="Time remaining before logout"
        />

        <div className="p-8">
          {/* Icon */}
          <div
            className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${
              isUrgent ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-500'
            }`}
            aria-hidden="true"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>

          {/* Heading */}
          <h2
            id="session-timeout-title"
            className="text-center text-xl font-bold text-foreground"
          >
            Session Timeout Warning
          </h2>

          {/* Body */}
          <p
            id="session-timeout-desc"
            className="mt-3 text-center text-sm text-muted-foreground"
          >
            You have been inactive for a while. For your security, you will be
            automatically logged out in:
          </p>

          {/* Countdown display */}
          <p
            className={`mt-5 text-center text-5xl font-black tabular-nums transition-colors duration-300 ${
              isUrgent ? 'text-red-500' : 'text-amber-500'
            }`}
            aria-live="polite"
            aria-atomic="true"
            aria-label={`${countdown} seconds remaining`}
          >
            {formatCountdown(countdown)}
          </p>

          {/* Actions */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-3">
            <button
              autoFocus
              onClick={handleStayLoggedIn}
              className="flex-1 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Stay Logged In
            </button>
            <button
              onClick={logout}
              className="flex-1 rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-neutral-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Log Out Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
