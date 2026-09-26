import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WalletFailureRecoveryWizard } from '../components/wallet/WalletFailureRecoveryWizard';

describe('WalletFailureRecoveryWizard', () => {
  it('renders network diagnosis when open', () => {
    render(
      <WalletFailureRecoveryWizard
        isOpen={true}
        onClose={jest.fn()}
        currentNetwork="PUBLIC"
        targetNetwork="TESTNET"
      />
    );

    expect(screen.getByText('Transaction Recovery Wizard')).toBeInTheDocument();
    expect(screen.getByText(/Network Passphrase Mismatch Detected/)).toBeInTheDocument();
  });

  it('navigates through step 2 to explain Freighter network switch', () => {
    render(
      <WalletFailureRecoveryWizard
        isOpen={true}
        onClose={jest.fn()}
        currentNetwork="PUBLIC"
        targetNetwork="TESTNET"
      />
    );

    fireEvent.click(screen.getByText('How to Fix in Freighter'));
    expect(screen.getByText(/Open your/)).toBeInTheDocument();
    expect(screen.getByText('Retry Now')).toBeInTheDocument();
  });

  it('provides Albedo fallback on step 3', () => {
    const handleAlbedo = jest.fn();
    render(
      <WalletFailureRecoveryWizard
        isOpen={true}
        onClose={jest.fn()}
        onFallbackToAlbedo={handleAlbedo}
      />
    );

    fireEvent.click(screen.getByText('How to Fix in Freighter'));
    fireEvent.click(screen.getByText(/Still failing\? Try Albedo fallback/));
    expect(screen.getByText('Albedo Web Signing Fallback')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sign with Albedo'));
    expect(handleAlbedo).toHaveBeenCalled();
  });
});
