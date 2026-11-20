"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";
import {
  flushOfflineOperations,
  getOfflineOperations,
  registerBackgroundSync,
} from "@/lib/offlineQueue";

export const MobileOfflineSyncStatus: React.FC = () => {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [hasInvestmentDraft, setHasInvestmentDraft] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { trigger } = useHapticFeedback();

  const refreshQueueCount = useCallback(async () => {
    try {
      const operations = await getOfflineOperations();
      setPendingSyncCount(operations.length);
      setHasInvestmentDraft(operations.some((operation) => operation.type === 'investment-draft'));
    } catch {
      setPendingSyncCount(0);
      setHasInvestmentDraft(false);
    }
  }, []);

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    setIsSyncing(true);
    try {
      const result = await flushOfflineOperations();
      await refreshQueueCount();
      trigger(result.failed > 0 ? "warning" : "success");
    } catch {
      trigger("warning");
    } finally {
      setIsSyncing(false);
    }
  }, [refreshQueueCount, trigger]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);
    void refreshQueueCount();
    void registerBackgroundSync();

    const handleOnline = () => {
      setIsOnline(true);
      trigger("success");
      void syncQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
      trigger("warning");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const handleServiceWorkerSync = (event: MessageEvent) => {
      if (event.data?.type === "AGRIFI_OFFLINE_SYNC") void syncQueue();
    };
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerSync);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerSync);
    };
  }, [refreshQueueCount, syncQueue, trigger]);

  const handleManualSync = () => {
    if (!isOnline) return;
    trigger("medium");
    void syncQueue();
  };

  if (isOnline && pendingSyncCount === 0) return null;

  return (
    <div
      role="status"
      className={`px-4 py-2 text-xs flex items-center justify-between transition-colors ${
        !isOnline ? "bg-amber-500 text-white" : "bg-blue-600 text-white"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="animate-pulse">●</span>
        <span>
          {!isOnline
            ? "Offline Mode — Changes will sync when network reconnects"
            : hasInvestmentDraft
              ? 'An old investment draft cannot sync automatically. Reopen the investment while online and sign it.'
              : `${pendingSyncCount} offline transaction(s) pending sync`}
        </span>
      </div>

      {isOnline && pendingSyncCount > 0 && (
        <button
          type="button"
          onClick={handleManualSync}
          disabled={isSyncing}
          className="ml-2 px-2.5 py-1 rounded bg-white/20 hover:bg-white/30 text-white text-[11px] font-semibold transition-colors disabled:opacity-50"
        >
          {isSyncing ? "Syncing..." : "Sync Now"}
        </button>
      )}
    </div>
  );
};
