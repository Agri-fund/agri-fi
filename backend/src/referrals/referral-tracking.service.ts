export type ReferralEventType = 'click' | 'signup' | 'activated' | 'reward';

export interface ReferralEvent {
  id?: string;
  type: ReferralEventType;
  channel?: string;
  createdAt?: string | Date;
  amount?: number | string;
  referredUserId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface ReferralFunnelStep {
  stage: 'clicks' | 'signups' | 'activated';
  value: number;
  conversionRate: number;
}

export interface ReferralChannelSummary {
  channel: string;
  clicks: number;
  signups: number;
  activated: number;
  rewards: number;
  rewardRate: number;
}

export interface RewardTimelinePoint {
  date: string;
  rewards: number;
  clicks: number;
  signups: number;
  activated: number;
}

export interface ReferralAnalytics {
  totalClicks: number;
  totalSignups: number;
  totalActivated: number;
  totalRewards: number;
  funnel: ReferralFunnelStep[];
  channels: ReferralChannelSummary[];
  timeline: RewardTimelinePoint[];
}

interface ChannelAccumulator {
  clicks: number;
  signups: number;
  activated: number;
  rewards: number;
}

export class ReferralTrackingService {
  private round(value: number): number {
    return Number(value.toFixed(2));
  }

  private normalizeChannel(channel?: string): string {
    const value = channel?.trim();
    return value && value.length > 0 ? value : 'unknown';
  }

  private getDateKey(date?: string | Date): string {
    const value = date ? new Date(date) : new Date();
    const iso = value.toISOString();
    return iso.slice(0, 10);
  }

  private getConversionRate(numerator: number, denominator: number): number {
    if (denominator === 0) return 0;
    return this.round((numerator / denominator) * 100);
  }

  buildRewardTimeline(events: ReferralEvent[] = []): Array<{ date: string; rewards: number }> {
    const rewardsByDate = new Map<string, number>();

    for (const event of events) {
      if (event.type !== 'reward') continue;
      const dateKey = this.getDateKey(event.createdAt);
      const amount = Number(event.amount ?? 0);
      rewardsByDate.set(dateKey, (rewardsByDate.get(dateKey) ?? 0) + (Number.isFinite(amount) ? amount : 0));
    }

    return Array.from(rewardsByDate.entries())
      .map(([date, rewards]) => ({ date, rewards: this.round(rewards) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  buildAnalytics(events: ReferralEvent[] = []): ReferralAnalytics {
    const totalClicks = events.filter((event) => event.type === 'click').length;
    const totalSignups = events.filter((event) => event.type === 'signup').length;
    const totalActivated = events.filter((event) => event.type === 'activated').length;
    const totalRewards = events
      .filter((event) => event.type === 'reward')
      .reduce((sum, event) => sum + Number(event.amount ?? 0), 0);

    const channelMap = new Map<string, ChannelAccumulator>();

    for (const event of events) {
      const channel = this.normalizeChannel(event.channel);
      const bucket = channelMap.get(channel) ?? {
        clicks: 0,
        signups: 0,
        activated: 0,
        rewards: 0,
      };

      if (event.type === 'click') {
        bucket.clicks += 1;
      }

      if (event.type === 'signup') {
        bucket.signups += 1;
      }

      if (event.type === 'activated') {
        bucket.activated += 1;
      }

      if (event.type === 'reward') {
        bucket.rewards += Number(event.amount ?? 0);
      }

      channelMap.set(channel, bucket);
    }

    const channels: ReferralChannelSummary[] = Array.from(channelMap.entries())
      .map(([channel, bucket]) => ({
        channel,
        clicks: bucket.clicks,
        signups: bucket.signups,
        activated: bucket.activated,
        rewards: this.round(bucket.rewards),
        rewardRate: bucket.signups === 0 ? 0 : this.getConversionRate(bucket.activated, bucket.signups),
      }))
      .sort((a, b) => b.rewards - a.rewards || a.channel.localeCompare(b.channel));

    const funnel: ReferralFunnelStep[] = [
      {
        stage: 'clicks',
        value: totalClicks,
        conversionRate: totalClicks === 0 ? 0 : 100,
      },
      {
        stage: 'signups',
        value: totalSignups,
        conversionRate: this.getConversionRate(totalSignups, totalClicks),
      },
      {
        stage: 'activated',
        value: totalActivated,
        conversionRate: this.getConversionRate(totalActivated, totalClicks),
      },
    ];

    const timelineByDate = new Map<string, RewardTimelinePoint>();
    for (const event of events) {
      if (event.type !== 'reward') continue;
      const date = this.getDateKey(event.createdAt);
      const point = timelineByDate.get(date) ?? {
        date,
        rewards: 0,
        clicks: 0,
        signups: 0,
        activated: 0,
      };
      point.rewards += Number(event.amount ?? 0);
      timelineByDate.set(date, point);
    }

    const timeline = Array.from(timelineByDate.values())
      .map((point) => ({
        ...point,
        rewards: this.round(point.rewards),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalClicks,
      totalSignups,
      totalActivated,
      totalRewards: this.round(totalRewards),
      funnel,
      channels,
      timeline,
    };
  }
}
