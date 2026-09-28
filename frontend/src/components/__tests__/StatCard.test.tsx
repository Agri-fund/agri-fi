import { render, screen } from '@testing-library/react';
import StatCard from '../StatCard';

vi.mock('next-intl', () => ({
  useLocale: vi.fn(() => 'en'),
}));

describe('StatCard', () => {
  it('formats numeric currency values using the locale currency formatter', () => {
    render(
      <StatCard
        label="Total raised"
        value={1234.56}
        icon="💰"
        isCurrency
        currency="USD"
        compact={false}
      />,
    );

    expect(screen.getByText('$1,234.56 USD')).toBeInTheDocument();
  });
});
