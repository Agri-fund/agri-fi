'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export interface CommodityPrice {
  symbol: string;
  name: string;
  priceUsdc: number;
  change24h: number;
  lastUpdated: string;
  isStale?: boolean;
}

interface CommodityTickerProps {
  initialPrices?: CommodityPrice[];
}

export const CommodityTicker: React.FC<CommodityTickerProps> = ({ initialPrices = [] }) => {
  const [prices, setPrices] = useState<CommodityPrice[]>(initialPrices);
  const [isPaused, setIsPaused] = useState(false);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch('/api/prices/commodities');
        if (res.ok) {
          const data = await res.json();
          setPrices(data);
          setIsStale(false);
        } else {
          setIsStale(true);
        }
      } catch (err) {
        setIsStale(true);
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="w-full overflow-hidden bg-slate-900 text-white border-b border-slate-800 py-2.5 px-4"
      aria-live="polite"
      aria-label="Agricultural Commodities Live DEX Ticker"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-wider whitespace-nowrap">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
          Stellar DEX Prices
          {isStale && <span className="text-amber-400 text-[10px] ml-1">(Stale)</span>}
        </div>

        <div
          className={`flex gap-8 items-center transition-all ${
            isPaused ? '' : 'animate-marquee motion-reduce:animate-none'
          }`}
        >
          {prices.map((item) => {
            const isPositive = item.change24h >= 0;
            return (
              <Link
                key={item.symbol}
                href={`/deals?commodity=${item.symbol.toLowerCase()}`}
                className="flex items-center gap-2.5 text-sm hover:text-emerald-400 transition-colors whitespace-nowrap cursor-pointer"
              >
                <span className="font-semibold text-slate-200">{item.name}</span>
                <span className="font-mono text-white">${item.priceUsdc.toFixed(2)}</span>
                <span
                  className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                    isPositive ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'
                  }`}
                >
                  {isPositive ? '+' : ''}
                  {item.change24h.toFixed(2)}%
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CommodityTicker;
