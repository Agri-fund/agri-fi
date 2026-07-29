import React from 'react';
import { render, screen } from '@testing-library/react';
import { OnChainProgressIndicator } from '../OnChainProgressIndicator';

describe('OnChainProgressIndicator', () => {
  it('renders all three step labels', () => {
    render(<OnChainProgressIndicator state="simulating" />);
    expect(screen.getByText('Simulating')).toBeInTheDocument();
    expect(screen.getByText('Submitting')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
  });

  it('marks the simulating step as active (aria-current)', () => {
    const { container } = render(<OnChainProgressIndicator state="simulating" />);
    const activeSteps = container.querySelectorAll('[aria-current="step"]');
    expect(activeSteps).toHaveLength(1);
  });

  it('shows the description for the current state', () => {
    render(<OnChainProgressIndicator state="submitting" />);
    expect(screen.getByText(/Broadcasting to the Stellar network/i)).toBeInTheDocument();
  });

  it('shows the tx hash link when state is confirmed', () => {
    render(
      <OnChainProgressIndicator
        state="confirmed"
        txHash="abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
      />,
    );
    const link = screen.getByRole('link', { name: /View transaction/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'),
    );
  });

  it('uses a custom explorer base URL when provided', () => {
    render(
      <OnChainProgressIndicator
        state="confirmed"
        txHash="tx123"
        explorerBaseUrl="https://custom.explorer/tx"
      />,
    );
    const link = screen.getByRole('link', { name: /View transaction/i });
    expect(link).toHaveAttribute('href', 'https://custom.explorer/tx/tx123');
  });

  it('does not render a tx link when state is not confirmed', () => {
    render(<OnChainProgressIndicator state="submitting" txHash="tx123" />);
    expect(screen.queryByRole('link', { name: /View transaction/i })).toBeNull();
  });

  it('shows the confirmed banner when state is confirmed', () => {
    render(<OnChainProgressIndicator state="confirmed" />);
    expect(screen.getByText(/Transaction confirmed on-chain/i)).toBeInTheDocument();
  });

  it('has accessible role and aria-label', () => {
    render(<OnChainProgressIndicator state="simulating" />);
    expect(screen.getByRole('status', { name: /transaction status: simulating/i })).toBeInTheDocument();
  });
});
