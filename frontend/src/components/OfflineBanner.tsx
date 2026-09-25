"use client";

import { useOnline } from "@/hooks/useOnline";
import { AlertCircle, WifiOff } from "lucide-react";

/**
 * OfflineBanner Component
 *
 * Displays a persistent banner when the user loses internet connectivity.
 * Shows that cached data is being used and when connection is restored.
 *
 * @example
 * <OfflineBanner />
 */
export function OfflineBanner(): JSX.Element | null {
  const isOnline = useOnline();

  if (isOnline) {
    return null;
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 bg-yellow-50 border-b-2 border-yellow-400 px-4 py-3 shadow-md"
      role="status"
      aria-live="polite"
      aria-label="Offline notification"
    >
      <div className="flex items-center gap-3 max-w-7xl mx-auto">
        {/* Icon */}
        <div className="flex-shrink-0">
          <WifiOff className="h-5 w-5 text-yellow-600" aria-hidden="true" />
        </div>

        {/* Message */}
        <div className="flex-1">
          <p className="text-sm font-medium text-yellow-800">You are offline</p>
          <p className="text-xs text-yellow-700 mt-0.5">
            Using cached data. Some features may be limited until connection is
            restored.
          </p>
        </div>

        {/* Alert icon for accessibility */}
        <div className="flex-shrink-0">
          <AlertCircle
            className="h-5 w-5 text-yellow-600 opacity-50"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}
