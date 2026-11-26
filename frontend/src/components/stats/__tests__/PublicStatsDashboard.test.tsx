import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PublicStatsDashboard,
  PublicStatsPayload,
} from '../PublicStatsDashboard';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="recharts-responsive">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="recharts-barchart">{children}</div>
  ),
  Bar: () => <div data-testid="recharts-bar" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

describe('PublicStatsDashboard (#1396)', () => {
  const mockStats: PublicStatsPayload = {
    total_deals_completed: 142,
    active_deals: 24,
    total_capital_deployed_usd: 2840000,
    avg_yield_pct: 14.8,
    on_time_delivery_rate: 94.5,
    top_5_commodities: [
      { commodity: 'Cocoa', deal_count: 18, total_volume_usd: 950000 },
      { commodity: 'Coffee', deal_count: 12, total_volume_usd: 640000 },
    ],
    monthly_capital_deployed: [
      { month: '2026-10', label: 'Oct 2026', capital_deployed_usd: 320000, deal_count: 5 },
      { month: '2026-11', label: 'Nov 2026', capital_deployed_usd: 410000, deal_count: 7 },
    ],
    cache_ttl_seconds: 300,
    updated_at: '2026-11-26T08:00:00.000Z',
  };

  it('renders KPI cards, monthly bar chart, and top commodities', () => {
    render(<PublicStatsDashboard stats={mockStats} />);

    expect(screen.getByText('AgriFi Performance Dashboard')).toBeInTheDocument();
    expect(screen.getByText('$2.84M')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
    expect(screen.getByText('14.8%')).toBeInTheDocument();
    expect(screen.getByText('94.5%')).toBeInTheDocument();
    expect(screen.getByTestId('monthly-capital-chart')).toBeInTheDocument();
    expect(screen.getByTestId('recharts-barchart')).toBeInTheDocument();
    expect(screen.getByText('Cocoa')).toBeInTheDocument();
    expect(screen.getByText('Coffee')).toBeInTheDocument();
  });
});
