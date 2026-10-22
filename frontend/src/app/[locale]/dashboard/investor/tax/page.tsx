'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import DashboardLayout from '../../../../../components/DashboardLayout';
import { apiClient, Investment } from '../../../../../lib/api';
import { InvestmentTaxData } from '../../../../../lib/tax/tax-calculator';
import { JurisdictionCode } from '../../../../../lib/tax/jurisdictions';

// Dynamically import the heavy dashboard to keep initial bundle small
const TaxAutomationDashboard = dynamic(
  () =>
    import('../../../../../components/tax/TaxAutomationDashboard').then((m) => ({
      default: m.TaxAutomationDashboard,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center min-h-[400px] text-slate-500">
        Loading tax automation...
      </div>
    ),
  },
);

export default function TaxDashboardPage() {
  const [investments, setInvestments] = useState<InvestmentTaxData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const user = apiClient.getCurrentUser();
        if (!user) return;

        const res = await fetch('/api/investments/my-investments');
        if (!res.ok) return;
        const data = await res.json();

        if (!active) return;

        // Map API investments to tax calculation format
        const mapped: InvestmentTaxData[] = (data as Investment[]).map((inv) => ({
          dealId: inv.deal?.id ?? inv.id,
          dealName: inv.deal?.title ?? 'Unknown Deal',
          investedAmount: Number(inv.amount_invested) ?? 0,
          returnAmount: Number(inv.actual_return_usd ?? inv.expected_return_usd ?? 0),
          feesUsd: 0, // Platform fees handled separately
          purchaseDate: inv.created_at ?? new Date().toISOString(),
          saleDate:
            inv.status === 'completed'
              ? inv.deal?.delivery_date ?? new Date().toISOString()
              : undefined,
          status: (inv.status as InvestmentTaxData['status']) ?? 'pending',
          currency: 'USD',
        }));

        setInvestments(mapped);
      } catch (error) {
        console.error('Failed to load investments for tax dashboard:', error);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <DashboardLayout role="investor">
      {loading ? (
        <div className="flex items-center justify-center min-h-[400px] text-slate-500">
          Loading tax automation...
        </div>
      ) : (
        <TaxAutomationDashboard
          investorName="Investor"
          investments={investments}
        />
      )}
    </DashboardLayout>
  );
}
