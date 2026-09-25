import { useEffect, useState } from 'react';

interface ExchangeRates {
  KES: number;
  NGN: number;
  GHS: number;
  TZS: number;
}

interface DualCurrencyDisplay {
  usdAmount: number;
  localAmount: number;
  localCurrency: string;
  formatted: string;
  disclaimer: string;
}

/**
 * Hook to fetch exchange rates and convert USD to local currency
 */
export function useCurrencyConversion(preferredCurrency?: string) {
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    if (!preferredCurrency || preferredCurrency === 'USD') {
      setRates(null);
      return;
    }

    const fetchRates = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/prices/fx');
        if (!res.ok) throw new Error('Failed to fetch rates');
        const data = await res.json();
        setRates(data.rates);
        setLastUpdated(data.timestamp);
      } catch (error) {
        console.error('Failed to fetch exchange rates:', error);
        setRates(null);
      } finally {
        setLoading(false);
      }
    };

    fetchRates();
    // Refresh every 30 minutes
    const interval = setInterval(fetchRates, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [preferredCurrency]);

  const convert = (usdAmount: number): DualCurrencyDisplay | null => {
    if (!rates || !preferredCurrency || preferredCurrency === 'USD') {
      return null;
    }

    const rate = rates[preferredCurrency as keyof ExchangeRates];
    if (!rate) return null;

    const localAmount = Number((usdAmount * rate).toFixed(2));
    const formatted = `${usdAmount} USDC (~${localAmount.toLocaleString()} ${preferredCurrency})`;

    const dateObj = lastUpdated ? new Date(lastUpdated) : new Date();
    const timeStr = dateObj.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    const disclaimer = `Rates updated ${timeStr} UTC`;

    return {
      usdAmount,
      localAmount,
      localCurrency: preferredCurrency,
      formatted,
      disclaimer,
    };
  };

  return { rates, loading, convert, lastUpdated };
}
