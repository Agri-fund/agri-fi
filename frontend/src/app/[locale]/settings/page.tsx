"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiClient, User } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { resetTour, isTourCompletedStatic } from "@/components/DashboardTour";

type Tab = "account" | "verification" | "wallets" | "currency";

const KYC_INFO: Record<string, { label: string; color: string; note: string }> =
  {
    verified: {
      label: "Tier 2 — Fully Verified",
      color: "badge-green",
      note: "Full access to all investment tiers and deal sizes.",
    },
    pending: {
      label: "Tier 1 — Under Review",
      color: "badge-yellow",
      note: "Your documents are being reviewed. This usually takes 1–2 business days.",
    },
    rejected: {
      label: "Rejected",
      color: "badge-red",
      note: "Your submission was rejected. Please re-submit with valid documents.",
    },
    none: {
      label: "Not Submitted",
      color: "badge-gray",
      note: "Submit KYC to unlock investment features.",
    },
  };

const SUPPORTED_CURRENCIES = [
  { code: "USD", label: "US Dollar (USD)", symbol: "$" },
  { code: "KES", label: "Kenyan Shilling (KES)", symbol: "KES" },
  { code: "NGN", label: "Nigerian Naira (NGN)", symbol: "₦" },
  { code: "GHS", label: "Ghanaian Cedi (GHS)", symbol: "₵" },
  { code: "TZS", label: "Tanzanian Shilling (TZS)", symbol: "TZS" },
];

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("account");
  const [loading, setLoading] = useState(true);

  // Account form state
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Currency preference state
  const [preferredCurrency, setPreferredCurrency] = useState("USD");
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [currencyMsg, setCurrencyMsg] = useState<string | null>(null);

  // Wallet unlink state
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkMsg, setUnlinkMsg] = useState<string | null>(null);

  // Tour restart state
  const [tourRestartMsg, setTourRestartMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const cached = apiClient.getCurrentUser();
      if (!cached) {
        router.push("/login");
        return;
      }
      let u = cached;
      try {
        const f = await apiClient.refreshCurrentUser();
        if (f) u = f;
      } catch {}
      setUser(u);
      setName(u.name ?? "");
      setPreferredCurrency(u.preferredCurrency ?? "USD");
      setLoading(false);
    })();
  }, [router]);

  const handleSaveAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaveMsg("Profile updated successfully.");
      setUser((prev) => (prev ? { ...prev, name } : prev));
    } catch {
      setSaveMsg("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleUnlinkWallet = async () => {
    if (!unlinkConfirm) {
      setUnlinkConfirm(true);
      return;
    }
    setUnlinking(true);
    setUnlinkMsg(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/users/me/wallet", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to unlink");
      setUser((prev) => (prev ? { ...prev, walletAddress: null } : prev));
      setUnlinkMsg("Wallet unlinked successfully.");
      setUnlinkConfirm(false);
    } catch {
      setUnlinkMsg("Failed to unlink wallet. Please try again.");
    } finally {
      setUnlinking(false);
    }
  };

  const handleSaveCurrency = async (newCurrency: string) => {
    setSavingCurrency(true);
    setCurrencyMsg(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ preferredCurrency: newCurrency }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setPreferredCurrency(newCurrency);
      setCurrencyMsg("Currency preference updated successfully.");
      setUser((prev) =>
        prev ? { ...prev, preferredCurrency: newCurrency } : prev,
      );
    } catch {
      setCurrencyMsg("Failed to save currency preference. Please try again.");
    } finally {
      setSavingCurrency(false);
    }
  };

  const handleRestartTour = () => {
    resetTour();
    setTourRestartMsg("Tour reset! Navigate to your dashboard to start the tour.");
    setTimeout(() => setTourRestartMsg(null), 3000);
  };

  if (loading || !user) return null;

  const kycKey = user.kycStatus ?? "none";
  const kyc = KYC_INFO[kycKey] ?? KYC_INFO.none;

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "account", label: "Account", icon: "👤" },
    { id: "verification", label: "Verification", icon: "🛡️" },
    { id: "wallets", label: "Wallets", icon: "🔑" },
    { id: "currency", label: "Currency", icon: "💱" },
  ];

  return (
    <DashboardLayout user={user}>
      <div className="page-content max-w-2xl">
        <div>
          <p className="text-sm text-slate-500 mb-1">Manage your account</p>
          <h1 className="page-title">Settings</h1>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                tab === t.id
                  ? "bg-white text-slate-900 shadow-card"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <span className="mr-1.5">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Account tab ── */}
        {tab === "account" && (
          <div className="card p-6 space-y-5">
            <h2 className="section-title">Profile Information</h2>
            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div>
                <label className="label" htmlFor="settings-email">
                  Email
                </label>
                <input
                  id="settings-email"
                  type="email"
                  value={user.email}
                  disabled
                  className="input bg-slate-50 text-slate-400 cursor-not-allowed"
                  aria-describedby="email-hint"
                />
                <p id="email-hint" className="label-hint">
                  Email cannot be changed.
                </p>
              </div>

              <div>
                <label className="label" htmlFor="settings-name">
                  Full Name
                </label>
                <input
                  id="settings-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="input"
                  maxLength={100}
                />
              </div>

              <div>
                <label className="label">Role</label>
                <p className="input bg-slate-50 text-slate-500 cursor-default capitalize">
                  {user.role.replace("_", " ")}
                </p>
              </div>

              {saveMsg && (
                <p
                  className={`text-sm font-medium ${saveMsg.includes("success") ? "text-brand-600" : "text-red-500"}`}
                >
                  {saveMsg}
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="btn-primary w-full"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </form>

            {/* Help section */}
            <div className="border-t border-slate-100 pt-5 mt-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Help</h3>
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <p className="text-sm font-medium text-slate-900">Dashboard Tour</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Replay the interactive tour to learn about platform features.
                  </p>
                </div>
                <button
                  onClick={handleRestartTour}
                  className="btn-secondary text-sm flex-shrink-0"
                >
                  Restart Tour
                </button>
              </div>
              {tourRestartMsg && (
                <p className="text-sm font-medium text-emerald-600 mt-2">{tourRestartMsg}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Verification tab ── */}
        {tab === "verification" && (
          <div className="card p-6 space-y-5">
            <h2 className="section-title">KYC Verification Status</h2>

            <div className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-xl flex-shrink-0 shadow-card">
                🛡️
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-900">
                    Verification Level
                  </p>
                  <span className={kyc.color}>{kyc.label}</span>
                </div>
                <p className="text-sm text-slate-500 mt-1">{kyc.note}</p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">
                KYC Tiers Explained
              </h3>
              <div className="space-y-2 text-sm text-slate-600">
                <div className="flex items-start gap-2">
                  <span className="badge-yellow mt-0.5 flex-shrink-0">
                    Tier 1
                  </span>
                  <p>
                    Basic identity verification. Allows limited investment
                    amounts.
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="badge-green mt-0.5 flex-shrink-0">
                    Tier 2
                  </span>
                  <p>
                    Full verification with proof of address. Unlocks all deal
                    sizes and investment tiers.
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="badge-red mt-0.5 flex-shrink-0">
                    Rejected
                  </span>
                  <p>
                    Submission was declined. Re-submit with valid, unexpired
                    documents.
                  </p>
                </div>
              </div>
            </div>

            {(kycKey === "none" || kycKey === "rejected") && (
              <a href="/kyc" className="btn-primary w-full text-center block">
                {kycKey === "rejected"
                  ? "Re-submit KYC"
                  : "Start KYC Verification"}
              </a>
            )}
          </div>
        )}

        {/* ── Wallets tab ── */}
        {tab === "wallets" && (
          <div className="card p-6 space-y-5">
            <h2 className="section-title">Stellar Wallet</h2>

            {user.walletAddress ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Linked Address
                  </p>
                  <p className="text-sm font-mono text-slate-800 break-all">
                    {user.walletAddress}
                  </p>
                </div>

                {/* Unlink warning */}
                {unlinkConfirm && (
                  <div className="alert-warning">
                    <span className="text-lg flex-shrink-0">⚠️</span>
                    <div>
                      <p className="font-semibold">
                        Are you sure you want to unlink this wallet?
                      </p>
                      <p className="text-xs mt-0.5">
                        Unlinking will remove your wallet association. Any
                        pending on-chain transactions may be affected. This
                        action cannot be undone without re-linking.
                      </p>
                    </div>
                  </div>
                )}

                {unlinkMsg && (
                  <p
                    className={`text-sm font-medium ${unlinkMsg.includes("success") ? "text-brand-600" : "text-red-500"}`}
                  >
                    {unlinkMsg}
                  </p>
                )}

                <div className="flex gap-3">
                  {unlinkConfirm && (
                    <button
                      onClick={() => setUnlinkConfirm(false)}
                      className="btn-secondary flex-1"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={handleUnlinkWallet}
                    disabled={unlinking}
                    className={`btn-danger ${unlinkConfirm ? "flex-1" : "w-full"}`}
                  >
                    {unlinking
                      ? "Unlinking…"
                      : unlinkConfirm
                        ? "Confirm Unlink"
                        : "Unlink Wallet"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center py-6">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl mx-auto mb-3">
                    🔑
                  </div>
                  <p className="text-sm font-semibold text-slate-700">
                    No wallet linked
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Link a Stellar wallet to participate in on-chain
                    investments.
                  </p>
                </div>
                <a href="/kyc" className="btn-primary w-full text-center block">
                  Link Wallet via KYC
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── Currency tab ── */}
        {tab === "currency" && (
          <div className="card p-6 space-y-5">
            <h2 className="section-title">Display Currency Preference</h2>
            <p className="text-sm text-slate-600">
              Choose how investment amounts are displayed throughout the
              platform. Amounts are always stored in USD but can be shown in
              your preferred local currency.
            </p>

            <div className="space-y-3">
              {SUPPORTED_CURRENCIES.map((currency) => (
                <label
                  key={currency.code}
                  className="flex items-center p-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors"
                >
                  <input
                    type="radio"
                    name="currency"
                    value={currency.code}
                    checked={preferredCurrency === currency.code}
                    onChange={(e) => handleSaveCurrency(e.target.value)}
                    disabled={savingCurrency}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <div className="ml-3 flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {currency.label}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Symbol:{" "}
                      <span className="font-mono">{currency.symbol}</span>
                    </p>
                  </div>
                  {preferredCurrency === currency.code && (
                    <span className="text-sm font-semibold text-brand-600 flex-shrink-0">
                      ✓
                    </span>
                  )}
                </label>
              ))}
            </div>

            {currencyMsg && (
              <p
                className={`text-sm font-medium ${currencyMsg.includes("success") ? "text-brand-600" : "text-red-500"}`}
              >
                {currencyMsg}
              </p>
            )}

            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-sm text-slate-700">
              <p className="font-semibold mb-2">💡 Exchange Rate Info</p>
              <p>
                Conversion rates are fetched from live market data and cached
                for 1 hour. Rates shown on investment cards include a timestamp
                for transparency.
              </p>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
