import { useState, useEffect } from 'react';

/**
 * Hook to track whether the user is online or offline.
 * Listens to window online/offline events and syncs state.
 *
 * @returns {boolean} true if online, false if offline
 *
 * @example
 * const isOnline = useOnline();
 * if (!isOnline) {
 *   // Show offline UI
 * }
 */
export function useOnline(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof window !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    // Handler for when connection is established
    const handleOnline = () => {
      console.log('[useOnline] Connection restored');
      setIsOnline(true);
    };

    // Handler for when connection is lost
    const handleOffline = () => {
      console.log('[useOnline] Connection lost');
      setIsOnline(false);
    };

    // Add event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cleanup event listeners on unmount
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
