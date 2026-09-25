"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getStoredToken } from "../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OnboardingProgress {
  profileComplete: boolean;
  kycSubmitted: boolean;
  firstDealCreated: boolean;
  walletConnected: boolean;
  allComplete: boolean;
}

interface StepDef {
  key: keyof Omit<OnboardingProgress, "allComplete">;
  label: string;
  href: string;
}

// ── Step definitions ──────────────────────────────────────────────────────────

const STEPS: StepDef[] = [
  { key: "profileComplete", label: "Complete your profile", href: "/profile" },
  { key: "kycSubmitted", label: "Submit KYC verification", href: "/kyc" },
  {
    key: "firstDealCreated",
    label: "Create your first deal",
    href: "/dashboard/farmer#create-deal",
  },
  { key: "walletConnected", label: "Connect your wallet", href: "/settings" },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  userId: string;
  onDismiss?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OnboardingChecklist({ userId: _userId, onDismiss }: Props) {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  // ── Fetch initial progress ──────────────────────────────────────────────────
  const fetchProgress = useCallback(async () => {
    try {
      const token = getStoredToken();
      const res = await fetch("/api/users/me/onboarding-progress", {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: "no-store",
      });
      if (res.ok) {
        const data: OnboardingProgress = await res.json();
        setProgress(data);
      }
    } catch {
      // Silently fail — checklist is non-critical UI
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check localStorage for prior dismissal
    if (typeof window !== "undefined") {
      if (localStorage.getItem("onboarding_dismissed") === "true") {
        setDismissed(true);
        setLoading(false);
        return;
      }
    }
    fetchProgress();
  }, [fetchProgress]);

  // ── Patch progress when a step is toggled ───────────────────────────────────
  const updateStep = async (
    key: keyof Omit<OnboardingProgress, "allComplete">,
    value: boolean,
  ) => {
    // Optimistic update
    setProgress((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, [key]: value };
      updated.allComplete =
        updated.profileComplete &&
        updated.kycSubmitted &&
        updated.firstDealCreated &&
        updated.walletConnected;
      return updated;
    });

    try {
      const token = getStoredToken();
      const res = await fetch("/api/users/me/onboarding-progress", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ [key]: value }),
      });
      if (res.ok) {
        const data: OnboardingProgress = await res.json();
        setProgress(data);
      }
    } catch {
      // Revert to fetched state on failure
      fetchProgress();
    }
  };

  // ── Dismiss handler ─────────────────────────────────────────────────────────
  const handleDismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("onboarding_dismissed", "true");
    }
    setDismissed(true);
    onDismiss?.();
  };

  // ── Derived state ───────────────────────────────────────────────────────────
  const completedCount = progress
    ? STEPS.filter((s) => progress[s.key]).length
    : 0;
  const totalCount = STEPS.length;
  const pct = Math.round((completedCount / totalCount) * 100);
  const allDone = progress?.allComplete ?? false;

  // Hide if dismissed
  if (dismissed) return null;

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm animate-pulse"
        aria-busy="true"
        aria-label="Loading onboarding checklist"
      >
        <div className="h-4 w-40 rounded bg-slate-200 mb-3" />
        <div className="h-2 w-full rounded-full bg-slate-200 mb-4" />
        {STEPS.map((s) => (
          <div key={s.key} className="flex items-center gap-3 mb-3">
            <div className="h-5 w-5 rounded-full bg-slate-200 flex-shrink-0" />
            <div className="h-3 flex-1 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    );
  }

  if (!progress) return null;

  // ── Rendered checklist ──────────────────────────────────────────────────────
  return (
    <div
      className={`w-full max-w-md rounded-2xl border bg-white p-5 shadow-sm transition-all ${
        allDone ? "border-emerald-400" : "border-emerald-300"
      }`}
      role="region"
      aria-label="Onboarding checklist"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bold text-slate-900 text-base">
          🌱 Get started checklist
        </h2>
        <span
          className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full tabular-nums"
          aria-live="polite"
          aria-label={`${completedCount} of ${totalCount} steps complete`}
        >
          {completedCount}/{totalCount} complete
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="w-full bg-slate-100 rounded-full h-2 mb-4"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% complete`}
      >
        <div
          className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Steps */}
      {allDone ? (
        /* Congratulations state */
        <div className="text-center py-3">
          <div className="text-3xl mb-2">🎉</div>
          <p className="font-semibold text-slate-900 mb-1">
            You&apos;re all set!
          </p>
          <p className="text-sm text-slate-500 mb-4">
            You&apos;ve completed all onboarding steps. Welcome to Agri-fi!
          </p>
          <button
            onClick={handleDismiss}
            className="btn-primary text-sm px-6 py-2"
            aria-label="Dismiss onboarding checklist"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <ul role="list" className="space-y-1">
          {STEPS.map((step) => {
            const done = progress[step.key];
            return (
              <li
                key={step.key}
                role="listitem"
                className="flex items-center gap-3 group"
              >
                {/* Checkbox toggle */}
                <button
                  type="button"
                  onClick={() => updateStep(step.key, !done)}
                  aria-checked={done}
                  aria-label={`Mark "${step.label}" as ${done ? "incomplete" : "complete"}`}
                  role="checkbox"
                  className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 ${
                    done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-slate-300 bg-white hover:border-emerald-400"
                  }`}
                >
                  {done ? (
                    <svg
                      className="w-3 h-3"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-slate-200 group-hover:bg-emerald-200 transition-colors" />
                  )}
                </button>

                {/* Step link */}
                <Link
                  href={step.href}
                  className={`flex-1 text-sm py-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 ${
                    done
                      ? "text-slate-400 line-through"
                      : "text-slate-700 hover:text-emerald-700 font-medium"
                  }`}
                  tabIndex={0}
                  aria-label={
                    done
                      ? `${step.label} — completed`
                      : `Go to: ${step.label}`
                  }
                >
                  {step.label}
                </Link>

                {/* Completion indicator */}
                {done && (
                  <span
                    className="text-emerald-500 text-sm flex-shrink-0"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Dismiss link (when not all done but user wants to hide) */}
      {!allDone && (
        <div className="mt-4 pt-3 border-t border-slate-100 text-center">
          <button
            onClick={handleDismiss}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 rounded"
            aria-label="Dismiss onboarding checklist"
          >
            Dismiss checklist
          </button>
        </div>
      )}
    </div>
  );
}
