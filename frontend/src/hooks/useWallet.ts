import { useState, useEffect, useCallback, useRef } from 'react';
import {
  WalletProvider,
  detectAvailableWallets,
  connectWallet,
  getPublicKeyWithWallet,
  signTransactionWithWallet,
} from '../lib/stellar-wallet';

// Default to testnet; override via NEXT_PUBLIC_STELLAR_NETWORK env var
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';

/**
 * How often (ms) to poll the wallet extension for connection/account changes.
 * Freighter does not emit DOM events for external disconnects, so we poll.
 */
const POLL_INTERVAL_MS = 3_000;

export type { WalletProvider };

/**
 * Reason the wallet was last disconnected.
 *
 * - `null`            — never disconnected, or disconnect hasn't happened yet
 * - `'user'`          — the user clicked Disconnect inside this app
 * - `'external'`      — Freighter was locked / disconnected outside this app
 * - `'account_changed'` — the active Freighter account was switched
 */
export type DisconnectReason = null | 'user' | 'external' | 'account_changed';

export interface WalletState {
  isConnected: boolean;
  publicKey: string | null;
  provider: WalletProvider | null;
  availableWallets: WalletProvider[];
  isLoading: boolean;
  error: string | null;
  /** Reason for the most recent disconnect, reset to null on a new successful connect. */
  disconnectReason: DisconnectReason;
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
    isLoading: true,
    error: null,
    disconnectReason: null,
  });

  // Keep a ref so the polling closure always reads the latest state without
  // needing to be recreated on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Detect available wallets on mount
  useEffect(() => {
    detectAvailableWallets().then((wallets) => {
      setState((prev) => ({ ...prev, availableWallets: wallets, isLoading: false }));
    });
  }, []);

  // Restore previously connected wallet from session storage
  useEffect(() => {
    const saved = sessionStorage.getItem('stellar_wallet');
    if (!saved) return;
    let isActive = true;

    (async () => {
      try {
        const { publicKey, provider } = JSON.parse(saved) as {
          publicKey: string;
          provider: WalletProvider;
        };

        if (!publicKey || !provider) {
          sessionStorage.removeItem('stellar_wallet');
          if (!isActive) return;
          setState((prev) => ({
            ...prev,
            isConnected: false,
            publicKey: null,
            provider: null,
          }));
          return;
        }

        if (!isActive) return;
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        const actualPublicKey = await getPublicKeyWithWallet(provider);
        const matches = actualPublicKey === publicKey;

        if (!isActive) return;
        if (!matches) {
          sessionStorage.removeItem('stellar_wallet');
          setState((prev) => ({
            ...prev,
            isConnected: false,
            publicKey: null,
            provider: null,
            isLoading: false,
          }));
          return;
        }

        setState((prev) => ({
          ...prev,
          isConnected: true,
          publicKey,
          provider,
          isLoading: false,
        }));
      } catch {
        sessionStorage.removeItem('stellar_wallet');
        if (!isActive) return;
        setState((prev) => ({
          ...prev,
          isConnected: false,
          publicKey: null,
          provider: null,
          isLoading: false,
        }));
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  // ── Polling watcher ────────────────────────────────────────────────────────
  // Runs only while the wallet is connected. Every POLL_INTERVAL_MS it fetches
  // the current public key from the wallet extension and compares it to the one
  // stored in state. Three outcomes are possible:
  //
  //   1. Keys match         → still connected, do nothing.
  //   2. Keys differ        → the user switched accounts in Freighter. We treat
  //                           this as an "account_changed" external event and
  //                           reset state so the app doesn't operate on a stale key.
  //   3. Call throws / empty → Freighter is locked or the user removed the
  //                           extension permission. Reset state with reason
  //                           'external'.
  useEffect(() => {
    if (!state.isConnected || !state.provider) return;

    const provider = state.provider;
    const knownKey = state.publicKey;

    const intervalId = setInterval(async () => {
      // If the component has already moved to disconnected, stop.
      if (!stateRef.current.isConnected) return;

      try {
        const currentKey = await getPublicKeyWithWallet(provider);

        if (!currentKey) {
          // Wallet returned empty string — Freighter is locked / disconnected.
          sessionStorage.removeItem('stellar_wallet');
          setState((prev) => ({
            ...prev,
            isConnected: false,
            publicKey: null,
            provider: null,
            disconnectReason: 'external',
          }));
          return;
        }

        if (currentKey !== knownKey) {
          // Account was switched externally.
          sessionStorage.removeItem('stellar_wallet');
          setState((prev) => ({
            ...prev,
            isConnected: false,
            publicKey: null,
            provider: null,
            disconnectReason: 'account_changed',
          }));
        }
      } catch {
        // Any error (extension unresponsive, etc.) → treat as external disconnect.
        sessionStorage.removeItem('stellar_wallet');
        setState((prev) => ({
          ...prev,
          isConnected: false,
          publicKey: null,
          provider: null,
          disconnectReason: 'external',
        }));
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
    // Re-create the watcher whenever the connection itself changes (connect/disconnect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isConnected, state.provider, state.publicKey]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const connect = useCallback(async (provider: WalletProvider): Promise<string> => {
    try {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        disconnectReason: null,
      }));

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
        disconnectReason: null,
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
      disconnectReason: 'user',
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
