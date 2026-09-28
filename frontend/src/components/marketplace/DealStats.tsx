'use client';

import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';

interface DealStatsProps {
  quantity: number | string;
  quantityUnit: string;
  totalValue: number | string;
  tokenPrice: number;
  tokensRemaining: number;
  deliveryDate: string;
}

export default function DealStats({
  quantity,
  quantityUnit,
  totalValue,
  tokenPrice,
  tokensRemaining,
  deliveryDate,
}: DealStatsProps) {
  const { formatCurrency } = useCurrencyFormat();
  const { formatNumber } = useNumberFormat();

  const stats = [
    { label: 'Quantity', value: `${formatNumber(quantity)} ${quantityUnit}` },
    { label: 'Total Value', value: formatCurrency(totalValue, 'USD', { decimalPlaces: 0 }) },
    { label: 'Token Price', value: formatCurrency(tokenPrice, 'USD', { decimalPlaces: 0 }) },
    { label: 'Tokens Remaining', value: formatNumber(tokensRemaining) },
    {
      label: 'Delivery',
      value: new Date(deliveryDate).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {stats.map(({ label, value }) => (
        <div key={label} className="bg-slate-50 rounded-2xl p-4">
          <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
          <p className="font-bold text-slate-900 mt-1">{value}</p>
        </div>
      ))}
    </div>
  );
}
