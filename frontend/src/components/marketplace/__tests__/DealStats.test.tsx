import { render, screen } from '@testing-library/react';
import DealStats from '../DealStats';

vi.mock('next-intl', () => ({
  useLocale: vi.fn(() => 'fr'),
}));

describe('DealStats', () => {
  it('formats financial and quantity values using the active locale', () => {
    render(
      <DealStats
        quantity={1234}
        quantityUnit="kg"
        totalValue={50000}
        tokenPrice={100}
        tokensRemaining={25}
        deliveryDate="2027-01-01"
      />,
    );

    expect(screen.getByText(/50[\s\u00a0\u202f]?000/)).toBeInTheDocument();
    expect(screen.getByText(/1[\s\u00a0\u202f]?234 kg/)).toBeInTheDocument();
    expect(screen.getByText(/25/)).toBeInTheDocument();
  });
});
