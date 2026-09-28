import { ReferralTrackingService, ReferralEvent, ReferralAnalytics } from './referral-tracking.service';

describe('ReferralTrackingService', () => {
  const service = new ReferralTrackingService();

  const events: ReferralEvent[] = [
    { id: '1', type: 'click', channel: 'email', createdAt: '2024-01-01T00:00:00.000Z' },
    { id: '2', type: 'click', channel: 'email', createdAt: '2024-01-01T00:00:00.000Z' },
    { id: '3', type: 'click', channel: 'social', createdAt: '2024-01-02T00:00:00.000Z' },
    { id: '4', type: 'signup', channel: 'email', referredUserId: 'u-1', createdAt: '2024-01-02T00:00:00.000Z' },
    { id: '5', type: 'signup', channel: 'social', referredUserId: 'u-2', createdAt: '2024-01-03T00:00:00.000Z' },
    { id: '6', type: 'activated', channel: 'email', referredUserId: 'u-1', createdAt: '2024-01-04T00:00:00.000Z' },
    { id: '7', type: 'reward', channel: 'email', amount: 15, createdAt: '2024-01-05T00:00:00.000Z' },
    { id: '8', type: 'reward', channel: 'social', amount: 7.5, createdAt: '2024-01-06T00:00:00.000Z' },
  ];

  it('builds funnel totals and channel breakdowns', () => {
    const analytics: ReferralAnalytics = service.buildAnalytics(events);

    expect(analytics.totalClicks).toBe(3);
    expect(analytics.totalSignups).toBe(2);
    expect(analytics.totalActivated).toBe(1);
    expect(analytics.totalRewards).toBe(22.5);

    expect(analytics.funnel).toEqual([
      { stage: 'clicks', value: 3, conversionRate: 100 },
      { stage: 'signups', value: 2, conversionRate: 66.67 },
      { stage: 'activated', value: 1, conversionRate: 33.33 },
    ]);

    expect(analytics.channels).toEqual([
      {
        channel: 'email',
        clicks: 2,
        signups: 1,
        activated: 1,
        rewards: 15,
        rewardRate: 100,
      },
      {
        channel: 'social',
        clicks: 1,
        signups: 1,
        activated: 0,
        rewards: 7.5,
        rewardRate: 0,
      },
    ]);
  });

  it('groups reward accrual by day', () => {
    const timeline = service.buildRewardTimeline(events);

    expect(timeline).toEqual([
      { date: '2024-01-05', rewards: 15 },
      { date: '2024-01-06', rewards: 7.5 },
    ]);
  });
});
