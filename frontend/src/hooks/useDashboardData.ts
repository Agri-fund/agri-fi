import { useEffect, useState } from 'react';
import { apiClient, Investment, User } from '../lib/api';

const CACHE_KEY_PREFIX = 'dashboard_data_';

export interface DashboardData {
  user: User | null;
  investments: Investment[];
}

export interface UseDashboardDataReturn {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  isOffline: boolean;
}

function cacheKey(userId: string): string {
  return `${CACHE_KEY_PREFIX}${userId}`;
}

function readCache(userId: string): DashboardData | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    return raw ? (JSON.parse(raw) as DashboardData) : null;
  } catch {
    return null;
  }
}

function writeCache(userId: string, data: DashboardData): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(data));
  } catch {
    // Storage may be full or unavailable (e.g. private browsing) — caching
    // is a best-effort enhancement, not required for the dashboard to work.
  }
}

export function useDashboardData(): UseDashboardDataReturn {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let active = true;
    const userId = apiClient.getCurrentUser()?.id;

    // 1. Serve cached data immediately so the dashboard is usable before
    //    the network request resolves (stale-while-revalidate).
    const cached = userId ? readCache(userId) : null;
    if (cached && active) {
      setData(cached);
      setLoading(false);
    }

    // 2. Revalidate against the API in the background.
    async function revalidate() {
      try {
        const [user, investments] = await Promise.all([
          apiClient.refreshCurrentUser(),
          apiClient.getInvestorInvestments(),
        ]);

        const result: DashboardData = { user, investments };
        const resolvedUserId = user?.id ?? userId;
        if (resolvedUserId) writeCache(resolvedUserId, result);

        if (active) {
          setData(result);
          setIsOffline(false);
          setError(null);
        }
      } catch (err) {
        if (active) {
          if (cached) {
            // Keep showing the cached data; just flag it as stale.
            setIsOffline(true);
          } else {
            setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void revalidate();
    return () => {
      active = false;
    };
  }, []);

  return { data, loading, error, isOffline };
}
