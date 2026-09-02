"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient, getStoredToken, User } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { useToast } from "@/components/ui/ToastProvider";

interface DlqMessage {
  id: string;
  payloadSummary: string;
  failureReason: string;
  retryCount: number;
}

export default function AdminDlqPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<DlqMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const token = getStoredToken();
      const response = await fetch("/api/admin/dlq", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Failed to load dead-letter messages");
      setMessages(await response.json());
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not load DLQ messages",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      const cached = apiClient.getCurrentUser();
      if (!cached) {
        router.push("/login");
        return;
      }
      let currentUser = cached;
      try {
        const fresh = await apiClient.refreshCurrentUser();
        if (fresh) currentUser = fresh;
      } catch {
        // The API request below remains the source of truth for authorization.
      }
      if (currentUser.role !== "admin") {
        router.push(`/dashboard/${currentUser.role}`);
        return;
      }
      setUser(currentUser);
      await loadMessages();
    })();
  }, [loadMessages, router]);

  const replay = async (id?: string) => {
    const isBulk = !id;
    const confirmed = window.confirm(
      isBulk
        ? `Replay all ${messages.length} dead-letter messages?`
        : "Replay this dead-letter message?",
    );
    if (!confirmed) return;

    setAction(id ?? "all");
    try {
      const token = getStoredToken();
      const endpoint = isBulk
        ? "/api/admin/dlq/replay-all"
        : `/api/admin/dlq/${encodeURIComponent(id)}/replay`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "Replay failed");
      toast(
        isBulk
          ? `${body.replayed ?? 0} messages replayed`
          : "Message replayed successfully",
        "success",
      );
      await loadMessages();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Replay failed", "error");
    } finally {
      setAction(null);
    }
  };

  if (!user) return null;

  return (
    <DashboardLayout user={user}>
      <div className="page-content">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500 mb-1">Escrow operations</p>
            <h1 className="page-title">Dead-letter queue</h1>
            <p className="text-sm text-slate-500 mt-2">
              Review failed escrow messages before sending them back for
              processing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => replay()}
            disabled={loading || messages.length === 0 || action !== null}
            className="btn-primary disabled:opacity-50"
          >
            Replay all ({messages.length})
          </button>
        </div>

        {loading ? (
          <div className="card h-48 skeleton" />
        ) : messages.length === 0 ? (
          <div className="card p-12 text-center text-slate-500">
            The escrow dead-letter queue is empty.
          </div>
        ) : (
          <div className="table-wrapper overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="table-head">
                <tr>
                  <th className="table-th">Message ID</th>
                  <th className="table-th">Payload</th>
                  <th className="table-th">Failure reason</th>
                  <th className="table-th">Retries</th>
                  <th className="table-th">Action</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => (
                  <tr key={message.id} className="table-row">
                    <td
                      className="table-td font-mono text-xs text-slate-500 max-w-[180px] truncate"
                      title={message.id}
                    >
                      {message.id}
                    </td>
                    <td
                      className="table-td max-w-[280px] truncate"
                      title={message.payloadSummary}
                    >
                      {message.payloadSummary}
                    </td>
                    <td className="table-td text-red-600">
                      {message.failureReason}
                    </td>
                    <td className="table-td font-semibold">
                      {message.retryCount}
                    </td>
                    <td className="table-td">
                      <button
                        type="button"
                        onClick={() => replay(message.id)}
                        disabled={action !== null}
                        className="btn-secondary text-sm disabled:opacity-50"
                      >
                        {action === message.id ? "Replaying..." : "Replay"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
