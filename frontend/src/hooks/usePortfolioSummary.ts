import { useEffect, useState } from 'react';
import { apiClient, PortfolioSummary } from '../lib/api';

export interface UsePortfolioSummaryReturn {
  summary: PortfolioSummary | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the investor's portfolio summary for the dashboard widget (#789)
 * from `GET /investments/summary`.
 */
export function usePortfolioSummary(): UsePortfolioSummaryReturn {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await apiClient.getPortfolioSummary();
        if (active) {
          setSummary(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load portfolio summary');
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

  return { summary, loading, error };
}
