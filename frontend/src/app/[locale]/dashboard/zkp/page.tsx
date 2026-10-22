"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiClient, User } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { useToast } from "@/components/ui/ToastProvider";

/* ── Types ───────────────────────────────────────────────────────────────── */
interface ZkpProof {
  id: string;
  ownerId: string;
  credentialType: string;
  circuitId: string;
  standard: string;
  status: string;
  publicInputs: Record<string, unknown>;
  credentialCommitment: string;
  stellarTxId: string | null;
  expiresAt: string | null;
  generationTimeMs: number | null;
  createdAt: string;
  updatedAt: string;
}

interface VerifyResult {
  valid: boolean;
  proofId: string;
  message: string;
}

const CREDENTIAL_TYPES: Record<string, string> = {
  credit_score: "Credit Score",
  compliance: "Compliance",
  financial_health: "Financial Health",
  kyc: "KYC",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  revoked: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  expired: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
};

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function ZkpDashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [proofs, setProofs] = useState<ZkpProof[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  // Generate form state
  const [credentialType, setCredentialType] = useState("credit_score");
  const [credentialValue, setCredentialValue] = useState("");
  const [threshold, setThreshold] = useState("");

  const fetchProofs = useCallback(async () => {
    const token = apiClient.getStoredToken?.();
    if (!token) {
      router.push("/login");
      return;
    }
    try {
      const res = await fetch("/api/zkp/proofs", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setProofs(Array.isArray(data) ? data : []);
      }
    } catch {
      // Silent fail — toast shown on actions, not on initial load
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const cached = apiClient.getCurrentUser();
    if (!cached) {
      router.push("/login");
      return;
    }
    setUser(cached);
    fetchProofs();
  }, [router, fetchProofs]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credentialValue.trim()) {
      toast({ message: "Credential value is required", type: "error" });
      return;
    }

    setGenerating(true);
    try {
      const token = apiClient.getStoredToken?.();
      const publicInputs: Record<string, unknown> = {};
      if (threshold.trim()) {
        publicInputs.threshold = Number(threshold);
      }

      const res = await fetch("/api/zkp/proofs/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          credentialType,
          credentialValue,
          publicInputs: Object.keys(publicInputs).length > 0 ? publicInputs : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast({ message: data.message || "Failed to generate proof", type: "error" });
        return;
      }

      toast({ message: "ZKP proof generated successfully", type: "success" });
      setCredentialValue("");
      setThreshold("");
      fetchProofs();
    } catch {
      toast({ message: "Failed to generate proof", type: "error" });
    } finally {
      setGenerating(false);
    }
  };

  const handleVerify = async (proofId: string) => {
    setVerifying(proofId);
    try {
      const token = apiClient.getStoredToken?.();
      const res = await fetch(`/api/zkp/proofs/${proofId}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ proofId }),
      });
      const data: VerifyResult = await res.json();
      if (!res.ok) {
        toast({ message: data.message || "Verification failed", type: "error" });
        return;
      }
      toast({
        message: data.valid ? "Proof verified — credential confirmed without disclosure" : `Verification failed: ${data.message}`,
        type: data.valid ? "success" : "error",
      });
    } catch {
      toast({ message: "Verification request failed", type: "error" });
    } finally {
      setVerifying(null);
    }
  };

  const handleRevoke = async (proofId: string) => {
    const reason = window.prompt("Enter revocation reason:");
    if (!reason || reason.trim().length < 5) {
      toast({ message: "Revocation reason must be at least 5 characters", type: "error" });
      return;
    }

    setRevoking(proofId);
    try {
      const token = apiClient.getStoredToken?.();
      const res = await fetch(`/api/zkp/proofs/${proofId}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ message: data.message || "Revocation failed", type: "error" });
        return;
      }
      toast({ message: "Proof revoked successfully", type: "success" });
      fetchProofs();
    } catch {
      toast({ message: "Revocation request failed", type: "error" });
    } finally {
      setRevoking(null);
    }
  };

  const handleAnchor = async (proofId: string) => {
    try {
      const token = apiClient.getStoredToken?.();
      const res = await fetch(`/api/zkp/proofs/${proofId}/anchor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ message: data.message || "Anchoring failed", type: "error" });
        return;
      }
      toast({ message: "Proof anchored on-chain", type: "success" });
      fetchProofs();
    } catch {
      toast({ message: "Anchoring request failed", type: "error" });
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Zero-Knowledge Proof Dashboard
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Generate and manage cryptographic proofs that verify credentials without revealing sensitive data.
          </p>
        </div>

        {/* Generate Proof Card */}
        <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
            Generate New Proof
          </h2>
          <form onSubmit={handleGenerate} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Credential Type
              </label>
              <select
                value={credentialType}
                onChange={(e) => setCredentialType(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="credit_score">Credit Score</option>
                <option value="compliance">Compliance</option>
                <option value="financial_health">Financial Health</option>
                <option value="kyc">KYC</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Credential Value
              </label>
              <input
                type="text"
                value={credentialValue}
                onChange={(e) => setCredentialValue(e.target.value)}
                placeholder="e.g. 750"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Threshold (optional)
              </label>
              <input
                type="text"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="e.g. 600"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={generating}
                className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate Proof"}
              </button>
            </div>
          </form>
        </div>

        {/* Proofs List */}
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Your Proofs
            </h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center p-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
            </div>
          ) : proofs.length === 0 ? (
            <div className="p-12 text-center text-sm text-gray-500 dark:text-gray-400">
              No proofs yet. Generate one above to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 font-medium text-gray-500 dark:text-gray-400">Type</th>
                    <th className="px-6 py-3 font-medium text-gray-500 dark:text-gray-400">Standard</th>
                    <th className="px-6 py-3 font-medium text-gray-500 dark:text-gray-400">Status</th>
                    <th className="px-6 py-3 font-medium text-gray-500 dark:text-gray-400">Generated</th>
                    <th className="px-6 py-3 font-medium text-gray-500 dark:text-gray-400">Expires</th>
                    <th className="px-6 py-3 font-medium text-gray-500 dark:text-gray-400">On-Chain</th>
                    <th className="px-6 py-3 font-medium text-gray-500 dark:text-gray-400">Gen Time</th>
                    <th className="px-6 py-3 font-medium text-gray-500 dark:text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {proofs.map((proof) => (
                    <tr key={proof.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 text-gray-900 dark:text-white">
                        {CREDENTIAL_TYPES[proof.credentialType] ?? proof.credentialType}
                      </td>
                      <td className="px-6 py-4 uppercase text-gray-500 dark:text-gray-400">
                        {proof.standard}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[proof.status] ?? STATUS_STYLES.pending}`}>
                          {proof.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                        {formatDate(proof.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                        {formatDate(proof.expiresAt)}
                      </td>
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                        {proof.stellarTxId ? (
                          <span className="font-mono text-xs">{proof.stellarTxId.slice(0, 10)}…</span>
                        ) : (
                          <span className="text-gray-400">Not anchored</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                        {proof.generationTimeMs != null ? `${proof.generationTimeMs}ms` : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleVerify(proof.id)}
                            disabled={verifying === proof.id || proof.status !== "active"}
                            className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-900/30 dark:text-blue-300"
                          >
                            {verifying === proof.id ? "…" : "Verify"}
                          </button>
                          <button
                            onClick={() => handleAnchor(proof.id)}
                            disabled={proof.status !== "active"}
                            className="rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-purple-900/30 dark:text-purple-300"
                          >
                            Anchor
                          </button>
                          <button
                            onClick={() => handleRevoke(proof.id)}
                            disabled={revoking === proof.id || proof.status !== "active"}
                            className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-900/30 dark:text-red-300"
                          >
                            {revoking === proof.id ? "…" : "Revoke"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
