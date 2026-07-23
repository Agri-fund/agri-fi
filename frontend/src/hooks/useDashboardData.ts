import { useState, useEffect } from 'react';
import { apiClient, Investment, User } from '../lib/api';

const CACHE_KEY = 'dashboard_data';

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

export function useDashboardData(): UseDashboardDataReturn {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [user, investments] = await Promise.all([
          apiClient.refreshCurrentUser(),
          apiClient.getInvestorInvestments(),
        ]);

        const result: DashboardData = { user, investments };
        localStorage.setItem(CACHE_KEY, JSON.stringify(result));

        if (active) {
          setData(result);
          setIsOffline(false);
          setError(null);
        }
      } catch (err) {
        const cached = localStorage.getItem(CACHE_KEY);
        if (active) {
          if (cached) {
            setData(JSON.parse(cached) as DashboardData);
            setIsOffline(true);
          } else {
            setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  return { data, loading, error, isOffline };
}
