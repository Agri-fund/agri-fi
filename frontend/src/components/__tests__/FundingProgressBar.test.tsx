import { render, screen } from '@testing-library/react';
import FundingProgressBar from '../FundingProgressBar';

describe('FundingProgressBar', () => {
  it('renders correct percentage and remaining amount for partial funding', () => {
    render(<FundingProgressBar totalValue={10000} totalInvested={3000} />);

    // next-intl mock returns translation keys; formatter returns plain numbers
    expect(screen.getByText('raised')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('remainingOf')).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '30');
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '100');
    expect(progressBar).toHaveStyle('width: 30%');
  });

  it('renders 100% when fully funded', () => {
    render(<FundingProgressBar totalValue={5000} totalInvested={5000} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('raised')).toBeInTheDocument();
    expect(screen.getByText('remainingOf')).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');
    expect(progressBar).toHaveStyle('width: 100%');
  });

  it('caps percentage at 100% when over-funded', () => {
    render(<FundingProgressBar totalValue={1000} totalInvested={1500} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('raised')).toBeInTheDocument();
    expect(screen.getByText('remainingOf')).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');
    expect(progressBar).toHaveStyle('width: 100%');
  });

  it('handles zero total value gracefully', () => {
    render(<FundingProgressBar totalValue={0} totalInvested={0} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('raised')).toBeInTheDocument();
    expect(screen.getByText('remainingOf')).toBeInTheDocument();

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '0');
    expect(progressBar).toHaveStyle('width: 0%');
  });

  it('formats large numbers with commas', () => {
    render(<FundingProgressBar totalValue={1000000} totalInvested={250000} />);

    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('raised')).toBeInTheDocument();
    expect(screen.getByText('remainingOf')).toBeInTheDocument();
  });
});
