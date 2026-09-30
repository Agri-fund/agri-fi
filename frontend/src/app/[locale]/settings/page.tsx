"use client";

import { getAuthToken } from "@/lib/auth-token";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { apiClient, User } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { resetTour, isTourCompletedStatic } from "@/components/DashboardTour";
import BrowserPushNotificationsCard from "@/components/BrowserPushNotificationsCard";
import { FormField } from "@/components/ui/FormField";

type Tab = "account" | "verification" | "wallets" | "currency" | "notifications" | "security";

interface MfaSetup {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

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
  const searchParams = useSearchParams();
  const tValidation = useTranslations("common.validation");
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("account");
  const [loading, setLoading] = useState(true);

  // Account form state
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string | undefined>>({});
  const [passwordTouched, setPasswordTouched] = useState<Record<string, boolean>>({});
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const passwordRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [disableMfaCode, setDisableMfaCode] = useState("");
  const [disableMfaPassword, setDisableMfaPassword] = useState("");
  const [mfaErrors, setMfaErrors] = useState<Record<string, string | undefined>>({});
  const [mfaTouched, setMfaTouched] = useState<Record<string, boolean>>({});
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaMessage, setMfaMessage] = useState<string | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);
  const mfaCodeRef = useRef<HTMLInputElement>(null);
  const disableMfaCodeRef = useRef<HTMLInputElement>(null);
  const disableMfaPasswordRef = useRef<HTMLInputElement>(null);

  const loadMfaSetup = useCallback(async () => {
    setMfaLoading(true);
    setMfaError(null);
    try {
      const response = await fetch("/api/auth/security/mfa/setup", {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? tValidation("mfaSetupFailed"));
      setMfaSetup(data);
    } catch (error) {
      setMfaError(error instanceof Error ? error.message : tValidation("mfaSetupFailed"));
    } finally {
      setMfaLoading(false);
    }
  }, [tValidation]);

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
        const token = getAuthToken();
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

  useEffect(() => {
    if (searchParams.get("tab") !== "security") return;
    setTab("security");
    if (searchParams.get("mfa") === "enroll" && user && !user.isMfaEnabled) void loadMfaSetup();
  }, [searchParams, loadMfaSetup, user]);

  const validatePasswordField = (field: "current" | "new" | "confirm", value: string) => {
    if (field === "current" && !value.trim()) return tValidation("currentPasswordRequired");
    if (field === "new") {
      if (!value.trim()) return tValidation("newPasswordRequired");
      if (value.length < 8) return tValidation("passwordMin");
      if (currentPassword && value === currentPassword) return tValidation("passwordMustDiffer");
    }
    if (field === "confirm") {
      if (!value.trim()) return tValidation("confirmPasswordRequired");
      if (value !== newPassword) return tValidation("passwordMismatch");
    }
    return undefined;
  };

  const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = {
      current: validatePasswordField("current", currentPassword),
      new: validatePasswordField("new", newPassword),
      confirm: validatePasswordField("confirm", confirmPassword),
    };
    setPasswordErrors(errors);
    setPasswordTouched({ current: true, new: true, confirm: true });
    const firstInvalid = (["current", "new", "confirm"] as const).find((field) => errors[field]);
    if (firstInvalid) {
      passwordRefs.current[firstInvalid]?.focus();
      return;
    }

    setChangingPassword(true);
    setPasswordError(null);
    try {
      const response = await fetch("/api/auth/security/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to change password.");
      apiClient.clearAuth();
      router.push("/login?notice=password-changed");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Unable to change password.");
    } finally {
      setChangingPassword(false);
    }
  };

  const validateMfaCode = (value: string) => {
    if (!value.trim()) return tValidation("mfaCodeRequired");
    if (!/^\d{6}$/.test(value)) return tValidation("mfaCodeInvalid");
    return undefined;
  };

  const handleEnableMfa = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const codeError = validateMfaCode(mfaCode);
    setMfaErrors({ code: codeError });
    setMfaTouched({ code: true });
    if (codeError) {
      mfaCodeRef.current?.focus();
      return;
    }
    setMfaLoading(true);
    setMfaError(null);
    try {
      const response = await fetch("/api/auth/security/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ token: mfaCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to enable MFA.");
      setUser((current) => current ? { ...current, isMfaEnabled: true } : current);
      setMfaSetup(null);
      setMfaCode("");
      setMfaMessage("MFA is enabled for your account.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Invalid MFA verification code")) {
        setMfaErrors((current) => ({ ...current, code: tValidation("mfaCodeInvalid") }));
        setMfaTouched((current) => ({ ...current, code: true }));
        mfaCodeRef.current?.focus();
      } else {
        setMfaError(message || tValidation("mfaEnableFailed"));
      }
    } finally {
      setMfaLoading(false);
    }
  };

  const handleDisableMfa = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = {
      code: validateMfaCode(disableMfaCode),
      password: disableMfaPassword.trim() ? undefined : tValidation("currentPasswordRequired"),
    };
    setMfaErrors(errors);
    setMfaTouched({ disableCode: true, disablePassword: true });
    const firstInvalid = errors.code ? "code" : errors.password ? "password" : undefined;
    if (firstInvalid) {
      (firstInvalid === "code" ? disableMfaCodeRef : disableMfaPasswordRef).current?.focus();
      return;
    }
    setMfaLoading(true);
    setMfaError(null);
    try {
      const response = await fetch("/api/auth/security/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
        body: JSON.stringify({ token: disableMfaCode, password: disableMfaPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to disable MFA.");
      setUser((current) => current ? { ...current, isMfaEnabled: false } : current);
      setDisableMfaCode("");
      setDisableMfaPassword("");
      setMfaMessage("MFA has been disabled.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Invalid password")) {
        setMfaErrors((current) => ({ ...current, password: tValidation("currentPasswordIncorrect") }));
        setMfaTouched((current) => ({ ...current, disablePassword: true }));
        disableMfaPasswordRef.current?.focus();
      } else if (message.includes("Invalid MFA token")) {
        setMfaErrors((current) => ({ ...current, code: tValidation("mfaCodeInvalid") }));
        setMfaTouched((current) => ({ ...current, disableCode: true }));
        disableMfaCodeRef.current?.focus();
      } else {
        setMfaError(message || tValidation("mfaDisableFailed"));
      }
    } finally {
      setMfaLoading(false);
    }
  };

  const handleSaveAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const validationError = name.trim() ? undefined : tValidation("nameRequired");
    setNameError(validationError);
    setNameTouched(true);
    if (validationError) {
      nameRef.current?.focus();
      return;
    }
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const token = getAuthToken();
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
      const token = getAuthToken();
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
      const token = getAuthToken();
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
      const token = getAuthToken();
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
    { id: "security", label: "Security", icon: "🔐" },
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
            <form onSubmit={handleSaveAccount} noValidate className="space-y-4">
              <FormField
                id="settings-email"
                label="Email"
                type="email"
                value={user.email}
                disabled
                hint="Email cannot be changed."
                className="bg-slate-50 text-slate-400 cursor-not-allowed"
              />

              <FormField
                ref={nameRef}
                id="settings-name"
                label="Full Name"
                type="text"
                value={name}
                required
                onChange={(e) => {
                  setName(e.target.value);
                  setSaveMsg(null);
                  if (nameTouched) setNameError(e.target.value.trim() ? undefined : tValidation("nameRequired"));
                }}
                onBlur={() => {
                  setNameTouched(true);
                  setNameError(name.trim() ? undefined : tValidation("nameRequired"));
                }}
                placeholder="Your full name"
                maxLength={100}
                error={nameError}
                touched={nameTouched}
                success={!nameError && !!name.trim()}
              />

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

        {tab === "security" && (
          <div className="card p-6 space-y-8">
            <section>
              <h2 className="section-title">Change Password</h2>
              <p className="text-sm text-slate-500 mt-1 mb-5">Changing your password signs out all active sessions.</p>
              <form onSubmit={handleChangePassword} noValidate className="space-y-4">
                {passwordError && <p role="alert" className="text-sm text-red-600">{passwordError}</p>}
                <FormField
                  ref={(node) => { passwordRefs.current.current = node; }}
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  error={passwordErrors.current}
                  touched={passwordTouched.current}
                  success={!passwordErrors.current && !!currentPassword}
                  onBlur={() => {
                    setPasswordTouched((current) => ({ ...current, current: true }));
                    setPasswordErrors((current) => ({ ...current, current: validatePasswordField("current", currentPassword) }));
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCurrentPassword(value);
                    if (passwordTouched.current) setPasswordErrors((current) => ({ ...current, current: validatePasswordField("current", value) }));
                  }}
                />
                <FormField
                  ref={(node) => { passwordRefs.current.new = node; }}
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={newPassword}
                  error={passwordErrors.new}
                  touched={passwordTouched.new}
                  success={!passwordErrors.new && newPassword.length >= 8}
                  onBlur={() => {
                    setPasswordTouched((current) => ({ ...current, new: true }));
                    setPasswordErrors((current) => ({ ...current, new: validatePasswordField("new", newPassword) }));
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    setNewPassword(value);
                    if (passwordTouched.new) setPasswordErrors((current) => ({ ...current, new: validatePasswordField("new", value) }));
                    if (passwordTouched.confirm) {
                      const confirmError = !confirmPassword.trim()
                        ? tValidation("confirmPasswordRequired")
                        : confirmPassword === value ? undefined : tValidation("passwordMismatch");
                      setPasswordErrors((current) => ({ ...current, confirm: confirmError }));
                    }
                  }}
                />
                <FormField
                  ref={(node) => { passwordRefs.current.confirm = node; }}
                  label="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  error={passwordErrors.confirm}
                  touched={passwordTouched.confirm}
                  success={!passwordErrors.confirm && !!confirmPassword && confirmPassword === newPassword}
                  onBlur={() => {
                    setPasswordTouched((current) => ({ ...current, confirm: true }));
                    setPasswordErrors((current) => ({ ...current, confirm: validatePasswordField("confirm", confirmPassword) }));
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    setConfirmPassword(value);
                    if (passwordTouched.confirm) setPasswordErrors((current) => ({ ...current, confirm: validatePasswordField("confirm", value) }));
                  }}
                />
                <button type="submit" disabled={changingPassword} className="btn-primary">
                  {changingPassword ? "Updating…" : "Update Password"}
                </button>
              </form>
            </section>

            <section className="border-t border-slate-100 pt-6">
              <h2 className="section-title">Multi-factor authentication</h2>
              <p className="text-sm text-slate-500 mt-1 mb-5">Use an authenticator app to add another layer of account protection.</p>
              {mfaError && <p role="alert" className="text-sm text-red-600 mb-4">{mfaError}</p>}
              {mfaMessage && <p role="status" className="text-sm text-emerald-700 mb-4">{mfaMessage}</p>}

              {user.isMfaEnabled ? (
                <form onSubmit={handleDisableMfa} noValidate className="space-y-4">
                  <p className="text-sm font-medium text-emerald-700">MFA is enabled.</p>
                  <FormField
                    ref={disableMfaCodeRef}
                    label="Authenticator code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={disableMfaCode}
                    error={mfaErrors.code}
                    touched={mfaTouched.disableCode}
                    success={!mfaErrors.code && /^\d{6}$/.test(disableMfaCode)}
                    onBlur={() => {
                      setMfaTouched((current) => ({ ...current, disableCode: true }));
                      setMfaErrors((current) => ({ ...current, code: validateMfaCode(disableMfaCode) }));
                    }}
                    onChange={(event) => {
                      const value = event.target.value.replace(/\D/g, "").slice(0, 6);
                      setDisableMfaCode(value);
                      if (mfaTouched.disableCode) setMfaErrors((current) => ({ ...current, code: validateMfaCode(value) }));
                    }}
                  />
                  <FormField
                    ref={disableMfaPasswordRef}
                    label="Current password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={disableMfaPassword}
                    error={mfaErrors.password}
                    touched={mfaTouched.disablePassword}
                    success={!mfaErrors.password && !!disableMfaPassword}
                    onBlur={() => {
                      setMfaTouched((current) => ({ ...current, disablePassword: true }));
                      setMfaErrors((current) => ({ ...current, password: disableMfaPassword.trim() ? undefined : tValidation("currentPasswordRequired") }));
                    }}
                    onChange={(event) => {
                      setDisableMfaPassword(event.target.value);
                      if (mfaTouched.disablePassword) setMfaErrors((current) => ({ ...current, password: event.target.value.trim() ? undefined : tValidation("currentPasswordRequired") }));
                    }}
                  />
                  <button type="submit" disabled={mfaLoading} className="btn-danger">
                    {mfaLoading ? "Updating…" : "Disable MFA"}
                  </button>
                </form>
              ) : mfaSetup ? (
                <div className="space-y-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <Image src={mfaSetup.qrCodeUrl} alt="Authenticator setup QR code" width={160} height={160} unoptimized className="h-40 w-40 border border-slate-200 p-2" />
                    <div className="space-y-2 text-sm">
                      <p>Scan this QR code or enter the setup key manually:</p>
                      <code className="block break-all rounded bg-slate-50 p-3 font-mono">{mfaSetup.secret}</code>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Backup codes</h3>
                    <p className="text-xs text-slate-500 mt-1">Save these codes somewhere secure. Each code can be used once.</p>
                    <ul className="mt-2 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
                      {mfaSetup.backupCodes.map((code) => <li key={code} className="rounded border border-slate-200 px-2 py-1">{code}</li>)}
                    </ul>
                  </div>
                  <form onSubmit={handleEnableMfa} noValidate className="space-y-4">
                    <FormField
                      ref={mfaCodeRef}
                      label="Authenticator code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      value={mfaCode}
                      error={mfaErrors.code}
                      touched={mfaTouched.code}
                      success={!mfaErrors.code && /^\d{6}$/.test(mfaCode)}
                      onBlur={() => {
                        setMfaTouched((current) => ({ ...current, code: true }));
                        setMfaErrors((current) => ({ ...current, code: validateMfaCode(mfaCode) }));
                      }}
                      onChange={(event) => {
                        const value = event.target.value.replace(/\D/g, "").slice(0, 6);
                        setMfaCode(value);
                        if (mfaTouched.code) setMfaErrors((current) => ({ ...current, code: validateMfaCode(value) }));
                      }}
                    />
                    <button type="submit" disabled={mfaLoading} className="btn-primary">
                      {mfaLoading ? "Verifying…" : "Enable MFA"}
                    </button>
                  </form>
                </div>
              ) : (
                <button type="button" onClick={() => void loadMfaSetup()} disabled={mfaLoading} className="btn-primary">
                  {mfaLoading ? "Preparing setup…" : "Set up MFA"}
                </button>
              )}
            </section>
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

            <BrowserPushNotificationsCard />

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
