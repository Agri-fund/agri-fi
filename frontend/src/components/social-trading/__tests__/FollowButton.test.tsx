import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FollowButton } from '../FollowButton';
import { useSocialTrading } from '@/hooks/useSocialTrading';
import { FOLLOW_STORAGE_KEY } from '@/lib/social-trading/follow';
import { DEMO_FOLLOWER_ID } from '@/lib/social-trading/sample-data';

function Harness() {
  const social = useSocialTrading();
  const traderId = 'trader-koji';
  const profile = social.getProfile(traderId);
  if (!profile) return null;
  return (
    <FollowButton
      traderId={traderId}
      displayName={profile.displayName}
      following={social.isFollowingTrader(traderId)}
      onToggle={social.toggleFollow}
      followerCount={social.followerCountFor(traderId)}
    />
  );
}

describe('FollowButton', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('toggles aria-pressed on follow and persists the follow graph into localStorage', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const button = screen.getByRole('button', { name: 'Follow Koji Tanaka' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);

    const pressed = screen.getByRole('button', { name: 'Unfollow Koji Tanaka' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');

    const raw = window.localStorage.getItem(FOLLOW_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw as string) as {
      relationships: Array<{ followerId: string; traderId: string }>;
    };
    expect(
      stored.relationships.some(
        (rel) => rel.followerId === DEMO_FOLLOWER_ID && rel.traderId === 'trader-koji',
      ),
    ).toBe(true);
  });

  it('unfollows on a second press and removes the edge from storage', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Follow Koji Tanaka' }));
    await user.click(screen.getByRole('button', { name: 'Unfollow Koji Tanaka' }));

    expect(
      screen.getByRole('button', { name: 'Follow Koji Tanaka' }),
    ).toHaveAttribute('aria-pressed', 'false');

    const stored = JSON.parse(
      window.localStorage.getItem(FOLLOW_STORAGE_KEY) as string,
    ) as { relationships: Array<{ followerId: string; traderId: string }> };
    expect(
      stored.relationships.some(
        (rel) => rel.followerId === DEMO_FOLLOWER_ID && rel.traderId === 'trader-koji',
      ),
    ).toBe(false);
  });
});
