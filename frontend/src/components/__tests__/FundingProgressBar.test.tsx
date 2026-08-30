import { render, screen } from '@testing-library/react';
import FundingProgressBar from '../FundingProgressBar';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      raised: `$${(params?.amount as string) ?? '0'} raised`,
      remainingOf: `$${(params?.remaining as string) ?? '0'} remaining of $${(params?.total as string) ?? '0'}`,
    };
    return translations[key] ?? key;
  },
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { initial, animate, transition, ...domProps } = props;
      return <div {...domProps}>{children}</div>;
    },
  },
  useReducedMotion: () => false,
}));

vi.mock('../../hooks/useCurrencyFormat', () => ({
  useCurrencyFormat: () => ({
    formatCurrency: (val: number, _currency?: string) => `$${val.toLocaleString()}`,
  }),
}));

vi.mock('../../hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatNumber: (val: number, opts?: { decimalPlaces?: number }) =>
      val.toFixed(opts?.decimalPlaces ?? 0),
  }),
}));

describe('FundingProgressBar', () => {
  it('renders correct percentage and remaining amount for partial funding', () => {
    render(<FundingProgressBar totalValue={10000} totalInvested={3000} />);

    expect(screen.getByText('30.0%')).toBeInTheDocument();
    expect(screen.getByText('$3,000 raised')).toBeInTheDocument();
    expect(screen.getByText('$7,000 remaining of $10,000')).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '30');
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '100');
  });

  it('renders 100% when fully funded with badge', () => {
    render(<FundingProgressBar totalValue={5000} totalInvested={5000} />);

    expect(screen.getByText('100.0%')).toBeInTheDocument();
    expect(screen.getByText('$5,000 raised')).toBeInTheDocument();
    expect(screen.getByText('Fully Funded')).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');
  });

  it('caps percentage at 100% when over-funded', () => {
    render(<FundingProgressBar totalValue={1000} totalInvested={1500} />);

    expect(screen.getByText('100.0%')).toBeInTheDocument();
    expect(screen.getByText('$1,500 raised')).toBeInTheDocument();
    expect(screen.getByText('Fully Funded')).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');
  });

  it('handles zero total value gracefully', () => {
    render(<FundingProgressBar totalValue={0} totalInvested={0} />);

    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.getByText('$0 raised')).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '0');
  });

  it('formats large numbers with commas', () => {
    render(<FundingProgressBar totalValue={1000000} totalInvested={250000} />);

    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(screen.getByText('$250,000 raised')).toBeInTheDocument();
    expect(screen.getByText('$750,000 remaining of $1,000,000')).toBeInTheDocument();
  });

  it('renders milestone markers', () => {
    render(<FundingProgressBar totalValue={10000} totalInvested={3000} />);

    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows amber color class for low funding', () => {
    const { container } = render(
      <FundingProgressBar totalValue={10000} totalInvested={2000} />,
    );
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar.className).toContain('from-amber-400');
  });

  it('shows blue color class for mid funding', () => {
    render(<FundingProgressBar totalValue={10000} totalInvested={6000} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar.className).toContain('from-blue-400');
  });

  it('shows green color class for fully funded', () => {
    render(<FundingProgressBar totalValue={10000} totalInvested={10000} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar.className).toContain('from-emerald-400');
  });
});
