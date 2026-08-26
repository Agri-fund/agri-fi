"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiClient, User } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { resetTour, isTourCompletedStatic } from "@/components/DashboardTour";
import { FormField } from "@/components/ui/FormField";

type Tab = "account" | "verification" | "wallets" | "currency" | "notifications";

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

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordTouched, setPasswordTouched] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [passwordErrors, setPasswordErrors] = useState<{
    currentPassword: string | undefined;
    newPassword: string | undefined;
    confirmPassword: string | undefined;
  }>({
    currentPassword: undefined,
    newPassword: undefined,
    confirmPassword: undefined,
  });

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

  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState<
    { notificationType: string; emailEnabled: boolean; pushEnabled: boolean; inAppEnabled: boolean }[]
  >([]);
  const [savingNotif, setSavingNotif] = useState(false);
  const [notifMsg, setNotifMsg] = useState<string | null>(null);

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

      // Fetch notification preferences
      try {
        const token = localStorage.getItem("auth_token");
        const notifRes = await fetch("/api/v1/users/me/notification-preferences", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (notifRes.ok) {
          const prefs = await notifRes.json();
          setNotifPrefs(prefs);
        }
      } catch {}
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

  function validatePasswordField(
    field: "currentPassword" | "newPassword" | "confirmPassword",
    val: string,
  ): string | undefined {
    if (field === "currentPassword") {
      return val ? undefined : "Current password is required";
    }
    if (field === "newPassword") {
      if (!val) return "New password is required";
      if (val.length < 8) return "Password must be at least 8 characters";
      return undefined;
    }
    if (field === "confirmPassword") {
      if (!val) return "Please confirm your new password";
      if (val !== newPassword) return "Passwords do not match";
      return undefined;
    }
    return undefined;
  }

  const handlePasswordBlur =
    (field: "currentPassword" | "newPassword" | "confirmPassword") =>
    (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setPasswordTouched((t) => ({ ...t, [field]: true }));
      setPasswordErrors((err) => ({
        ...err,
        [field]: validatePasswordField(field, e.target.value),
      }));
    };

  const handleChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fields = ["currentPassword", "newPassword", "confirmPassword"] as const;
    const vals = { currentPassword, newPassword, confirmPassword };
    const newErrors = fields.reduce(
      (acc, f) => ({ ...acc, [f]: validatePasswordField(f, vals[f]) }),
      {} as typeof passwordErrors,
    );
    setPasswordErrors(newErrors);
    setPasswordTouched({ currentPassword: true, newPassword: true, confirmPassword: true });

    if (fields.some((f) => newErrors[f])) {
      const firstInvalid = fields.find((f) => newErrors[f]);
      if (firstInvalid) {
        setTimeout(
          () =>
            (
              document.getElementById(`settings-${firstInvalid}`) as HTMLElement | null
            )?.focus(),
          0,
        );
      }
      return;
    }

    setSavingPassword(true);
    setPasswordMsg(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/users/me/password", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.message ?? "Failed to change password");
      }
      setPasswordMsg("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordTouched({ currentPassword: false, newPassword: false, confirmPassword: false });
      setPasswordErrors({ currentPassword: undefined, newPassword: undefined, confirmPassword: undefined });
    } catch (err: any) {
      setPasswordMsg(err?.message ?? "Failed to change password. Please try again.");
    } finally {
      setSavingPassword(false);
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

  const handleToggleNotifPref = async (
    notificationType: string,
    field: "emailEnabled" | "pushEnabled" | "inAppEnabled",
    value: boolean,
  ) => {
    setSavingNotif(true);
    setNotifMsg(null);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/v1/users/me/notification-preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notificationType, [field]: value }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const updated = await res.json();
      setNotifPrefs((prev) => {
        const idx = prev.findIndex((p) => p.notificationType === notificationType);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [...prev, updated];
      });
      setNotifMsg("Preference updated.");
      setTimeout(() => setNotifMsg(null), 2000);
    } catch {
      setNotifMsg("Failed to save preference.");
    } finally {
      setSavingNotif(false);
    }
  };

  if (loading || !user) return null;

  const kycKey = user.kycStatus ?? "none";
  const kyc = KYC_INFO[kycKey] ?? KYC_INFO.none;

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "account", label: "Account", icon: "👤" },
    { id: "verification", label: "Verification", icon: "🛡️" },
    { id: "wallets", label: "Wallets", icon: "🔑" },
    { id: "currency", label: "Currency", icon: "💱" },
    { id: "notifications", label: "Notifications", icon: "🔔" },
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
                <FormField
                  id="settings-name"
                  label="Full Name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="max-w-full"
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

            {/* ── Password change section ── */}
            <div className="border-t border-slate-100 pt-5 mt-5">
              <h2 className="section-title mb-4">Change Password</h2>
              <form onSubmit={handleChangePassword} className="space-y-4" noValidate>
                <div className="space-y-1">
                  <label htmlFor="settings-currentPassword" className="label">
                    Current Password
                    <span className="text-red-500 ml-0.5" aria-hidden="true"> *</span>
                  </label>
                  <div className="relative">
                    <input
                      id="settings-currentPassword"
                      type={showCurrentPw ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Your current password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      onBlur={handlePasswordBlur("currentPassword")}
                      required
                      aria-invalid={
                        passwordTouched.currentPassword && !!passwordErrors.currentPassword
                          ? true
                          : undefined
                      }
                      aria-describedby={
                        passwordTouched.currentPassword && passwordErrors.currentPassword
                          ? "settings-currentPassword-error"
                          : undefined
                      }
                      className={[
                        "input pr-11",
                        passwordTouched.currentPassword && passwordErrors.currentPassword
                          ? "border-red-500"
                          : "",
                        passwordTouched.currentPassword &&
                        !passwordErrors.currentPassword &&
                        currentPassword
                          ? "border-green-500"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowCurrentPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                    >
                      {showCurrentPw ? "🙈" : "👁"}
                    </button>
                  </div>
                  {passwordTouched.currentPassword && passwordErrors.currentPassword && (
                    <p
                      id="settings-currentPassword-error"
                      role="alert"
                      className="text-xs text-red-600 flex items-center gap-1 mt-0.5"
                    >
                      <span aria-hidden="true">⚠</span>
                      {passwordErrors.currentPassword}
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label htmlFor="settings-newPassword" className="label">
                    New Password
                    <span className="text-red-500 ml-0.5" aria-hidden="true"> *</span>
                  </label>
                  <div className="relative">
                    <input
                      id="settings-newPassword"
                      type={showNewPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Min. 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      onBlur={handlePasswordBlur("newPassword")}
                      required
                      minLength={8}
                      aria-invalid={
                        passwordTouched.newPassword && !!passwordErrors.newPassword
                          ? true
                          : undefined
                      }
                      aria-describedby={
                        passwordTouched.newPassword && passwordErrors.newPassword
                          ? "settings-newPassword-error"
                          : undefined
                      }
                      className={[
                        "input pr-11",
                        passwordTouched.newPassword && passwordErrors.newPassword
                          ? "border-red-500"
                          : "",
                        passwordTouched.newPassword &&
                        !passwordErrors.newPassword &&
                        newPassword
                          ? "border-green-500"
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowNewPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                    >
                      {showNewPw ? "🙈" : "👁"}
                    </button>
                  </div>
                  {passwordTouched.newPassword && passwordErrors.newPassword && (
                    <p
                      id="settings-newPassword-error"
                      role="alert"
                      className="text-xs text-red-600 flex items-center gap-1 mt-0.5"
                    >
                      <span aria-hidden="true">⚠</span>
                      {passwordErrors.newPassword}
                    </p>
                  )}
                </div>

                <FormField
                  id="settings-confirmPassword"
                  label="Confirm New Password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={handlePasswordBlur("confirmPassword")}
                  error={passwordErrors.confirmPassword}
                  touched={passwordTouched.confirmPassword}
                  required
                />

                {passwordMsg && (
                  <p
                    className={`text-sm font-medium ${
                      passwordMsg.includes("success") ? "text-brand-600" : "text-red-500"
                    }`}
                  >
                    {passwordMsg}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={savingPassword}
                  className="btn-primary w-full"
                >
                  {savingPassword ? "Saving…" : "Change Password"}
                </button>
              </form>
            </div>

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

        {/* ── Notifications tab ── */}
        {tab === "notifications" && (
          <div className="card p-6 space-y-5">
            <h2 className="section-title">Notification Preferences</h2>
            <p className="text-sm text-slate-600">
              Choose how you receive notifications for each category. Toggle
              individual channels on or off.
            </p>

            {notifPrefs.length === 0 && (
              <p className="text-sm text-slate-400">Loading preferences…</p>
            )}

            <div className="space-y-4">
              {notifPrefs.map((pref) => (
                <div
                  key={pref.notificationType}
                  className="p-4 rounded-xl border border-slate-200 space-y-3"
                >
                  <p className="text-sm font-semibold text-slate-800 capitalize">
                    {pref.notificationType.replace(/_/g, " ")}
                  </p>
                  <div className="flex gap-4">
                    {([
                      { field: "emailEnabled" as const, label: "Email" },
                      { field: "pushEnabled" as const, label: "Push" },
                      { field: "inAppEnabled" as const, label: "In-App" },
                    ]).map(({ field, label }) => (
                      <label
                        key={field}
                        className="flex items-center gap-2 text-sm text-slate-600"
                      >
                        <input
                          type="checkbox"
                          checked={pref[field]}
                          onChange={(e) =>
                            handleToggleNotifPref(
                              pref.notificationType,
                              field,
                              e.target.checked,
                            )
                          }
                          disabled={savingNotif}
                          className="w-4 h-4 rounded cursor-pointer"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {notifMsg && (
              <p
                className={`text-sm font-medium ${
                  notifMsg.includes("updated")
                    ? "text-brand-600"
                    : "text-red-500"
                }`}
              >
                {notifMsg}
              </p>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
