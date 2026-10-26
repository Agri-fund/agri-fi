import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LeaderboardTable } from '../LeaderboardTable';
import { useSocialTrading } from '@/hooks/useSocialTrading';
import { buildLeaderboard } from '@/lib/social-trading/leaderboard';
import { SAMPLE_AS_OF, buildSampleProfiles } from '@/lib/social-trading/sample-data';
import type { LeaderboardMetric, SocialMetricWindow } from '@/lib/social-trading/types';

const profiles = buildSampleProfiles(SAMPLE_AS_OF);

function expectedOrder(metric: LeaderboardMetric, window: SocialMetricWindow): string[] {
  return buildLeaderboard(profiles, { metric, window }).map((entry) => entry.traderId);
}

function Harness() {
  const social = useSocialTrading();
  return (
    <LeaderboardTable
      entries={social.leaderboard}
      metric={social.metric}
      window={social.window}
      onMetricChange={social.setMetric}
      onWindowChange={social.setWindow}
      region={social.region}
      regions={social.regions}
      onRegionChange={social.setRegion}
      onSelectTrader={vi.fn()}
      followingIds={social.followingIds}
    />
  );
}

function traderIdsInDisplayOrder(): string[] {
  const rows = screen.getAllByRole('row');
  return rows
    .slice(1)
    .map((row) => row.getAttribute('data-trader-id'))
    .filter((id): id is string => id !== null);
}

describe('LeaderboardTable', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the ROI leaderboard in the order buildLeaderboard produces', () => {
    render(<Harness />);

    expect(traderIdsInDisplayOrder()).toEqual(expectedOrder('roi', '12m'));
  });

  it('ranks change when the metric selector changes', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const before = traderIdsInDisplayOrder();
    expect(before).toEqual(expectedOrder('roi', '12m'));

    await user.selectOptions(screen.getByLabelText('Leaderboard metric'), 'consistency');

    const after = traderIdsInDisplayOrder();
    expect(after).toEqual(expectedOrder('consistency', '12m'));
    expect(after).not.toEqual(before);
    expect(after[0]).toBe(expectedOrder('consistency', '12m')[0]);
  });

  it('re-ranks when the window selector changes', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.selectOptions(screen.getByLabelText('Metric window'), '3m');

    expect(traderIdsInDisplayOrder()).toEqual(expectedOrder('roi', '3m'));
  });
});
