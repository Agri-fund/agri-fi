import { useState, useEffect, useCallback } from 'react';
import {
  WalletProvider,
  detectAvailableWallets,
  connectWallet,
  signTransactionWithWallet,
} from '../lib/stellar-wallet';

// Default to testnet; override via NEXT_PUBLIC_STELLAR_NETWORK env var
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';

export type { WalletProvider };

export interface WalletState {
  isConnected: boolean;
  publicKey: string | null;
  provider: WalletProvider | null;
  availableWallets: WalletProvider[];
  isLoading: boolean;
  error: string | null;
}

export interface UseWalletReturn extends WalletState {
  connect: (provider: WalletProvider) => Promise<string>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

export const useWallet = (): UseWalletReturn => {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    publicKey: null,
    provider: null,
    availableWallets: [],
    isLoading: false,
    error: null,
  });

  // Detect available wallets on mount
  useEffect(() => {
    detectAvailableWallets().then((wallets) => {
      setState((prev) => ({ ...prev, availableWallets: wallets }));
    });
  }, []);

  // Restore previously connected wallet from session storage
  useEffect(() => {
    const saved = sessionStorage.getItem('stellar_wallet');
    if (!saved) return;
    try {
      const { publicKey, provider } = JSON.parse(saved) as {
        publicKey: string;
        provider: WalletProvider;
      };
      if (publicKey && provider) {
        setState((prev) => ({
          ...prev,
          isConnected: true,
          publicKey,
          provider,
        }));
      }
    } catch {
      sessionStorage.removeItem('stellar_wallet');
    }
  }, []);

  const connect = useCallback(async (provider: WalletProvider): Promise<string> => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const result = await connectWallet(provider);

      sessionStorage.setItem(
        'stellar_wallet',
        JSON.stringify({ publicKey: result.publicKey, provider }),
      );

      setState((prev) => ({
        ...prev,
        isConnected: true,
        publicKey: result.publicKey,
        provider,
        isLoading: false,
      }));

      return result.publicKey;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to connect wallet';
      setState((prev) => ({
        ...prev,
        isConnected: false,
        publicKey: null,
        provider: null,
        isLoading: false,
        error: message,
      }));
      throw error;
    }
  }, []);

  const disconnect = useCallback(() => {
    sessionStorage.removeItem('stellar_wallet');
    setState((prev) => ({
      ...prev,
      isConnected: false,
      publicKey: null,
      provider: null,
      error: null,
    }));
  }, []);

  const signTransactionXdr = useCallback(
    async (xdr: string): Promise<string> => {
      if (!state.provider) {
        throw new Error('No wallet connected. Please connect a wallet first.');
      }
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));
        const result = await signTransactionWithWallet(
          xdr,
          state.provider,
          NETWORK_PASSPHRASE,
        );
        setState((prev) => ({ ...prev, isLoading: false }));
        return result.signedXdr;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to sign transaction';
        setState((prev) => ({ ...prev, isLoading: false, error: message }));
        throw error;
      }
    },
    [state.provider],
  );

  return {
    ...state,
    connect,
    disconnect,
    signTransaction: signTransactionXdr,
  };
};
