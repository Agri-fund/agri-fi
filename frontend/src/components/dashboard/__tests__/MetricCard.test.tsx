import { render, screen } from '@testing-library/react';
import MetricCard from '../MetricCard';

vi.mock('next-intl', () => ({
  useLocale: vi.fn(() => 'en'),
}));

describe('MetricCard', () => {
  it('formats currency metrics through the currency hook', () => {
    render(
      <MetricCard
        label="Portfolio value"
        value={1234.56}
        icon={<span aria-hidden="true">$</span>}
        isCurrency
        compact={false}
      />,
    );

    expect(screen.getByText('$1,234.56 USD')).toBeInTheDocument();
  });
});
