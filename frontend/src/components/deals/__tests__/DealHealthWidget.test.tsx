import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { DealHealthWidget } from '../DealHealthWidget';
import type { DealHealthSnapshot } from '../DealHealthWidget';

// Recharts measures container size via ResizeObserver/getBoundingClientRect,
// which jsdom doesn't implement meaningfully. Stub it out so the widget's
// own logic (status pill, values, error/offline states) is what's under test.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="sparkline">{children}</div>
  ),
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

function buildSnapshot(
  overrides: Partial<DealHealthSnapshot> = {},
): DealHealthSnapshot {
  return {
    dealId: 'deal-1',
    riskScore: 30,
    riskRating: 'Medium',
    status: 'Healthy',
    funding: {
      raisedPct: 50,
      expectedPctByNow: 50,
      totalValue: 10000,
      totalInvested: 5000,
      daysRemaining: 50,
      timeline: [
        { date: '2026-01-01T00:00:00Z', raisedPct: 10 },
        { date: '2026-02-01T00:00:00Z', raisedPct: 50 },
      ],
    },
    milestones: {
      completedCount: 2,
      expectedCountByNow: 2,
      totalCount: 4,
      timeline: [
        { date: '2026-01-05T00:00:00Z', completedCount: 1 },
        { date: '2026-01-20T00:00:00Z', completedCount: 2 },
      ],
    },
    computedAt: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    writable: true,
    value,
  });
}

describe('DealHealthWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();
    setOnline(true);
  });

  it('renders a Healthy status pill when the deal is on pace', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => buildSnapshot({ status: 'Healthy' }),
    });

    render(<DealHealthWidget dealId="deal-1" />);

    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/trade-deals/deal-1/health',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('renders a Warning status pill when moderately behind pace', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildSnapshot({
          status: 'Warning',
          funding: {
            raisedPct: 30,
            expectedPctByNow: 50,
            totalValue: 10000,
            totalInvested: 3000,
            daysRemaining: 50,
            timeline: [{ date: '2026-01-01T00:00:00Z', raisedPct: 30 }],
          },
        }),
    });

    render(<DealHealthWidget dealId="deal-1" />);

    await waitFor(() => {
      expect(screen.getByText('Warning')).toBeInTheDocument();
    });
  });

  it('renders an At-risk status pill when severely behind or past deadline', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () =>
        buildSnapshot({
          status: 'At-risk',
          funding: {
            raisedPct: 10,
            expectedPctByNow: 90,
            totalValue: 10000,
            totalInvested: 1000,
            daysRemaining: 2,
            timeline: [{ date: '2026-01-01T00:00:00Z', raisedPct: 10 }],
          },
        }),
    });

    render(<DealHealthWidget dealId="deal-1" />);

    await waitFor(() => {
      expect(screen.getByText('At-risk')).toBeInTheDocument();
    });
  });

  it('shows a graceful "unable to load" state when the request fails, with a retry action', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network error'));

    render(<DealHealthWidget dealId="deal-1" />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load health data')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('degrades gracefully offline without hitting the network', async () => {
    setOnline(false);

    render(<DealHealthWidget dealId="deal-1" />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load health data')).toBeInTheDocument();
    });
    expect(screen.getByText(/you appear to be offline/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
