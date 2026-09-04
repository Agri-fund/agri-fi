import { useState, useEffect, useCallback, useRef } from 'react';
import {
  WalletProvider,
  detectAvailableWallets,
  connectWallet,
  getPublicKeyWithWallet,
  signTransactionWithWallet,
} from '../lib/stellar-wallet';

// ── Network configuration ──────────────────────────────────────────────────
// Default to testnet; override via NEXT_PUBLIC_STELLAR_NETWORK env var.
const CONFIGURED_NETWORK: 'testnet' | 'mainnet' =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';

export const NETWORK_PASSPHRASE =
  CONFIGURED_NETWORK === 'mainnet'
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
 * - `null`              — never disconnected, or disconnect hasn't happened yet
 * - `'user'`            — the user clicked Disconnect inside this app
 * - `'external'`        — Freighter was locked / disconnected outside this app
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
  /**
   * Network reported by the wallet on connect (lowercase: 'testnet' | 'mainnet' | null).
   * A non-null value that differs from CONFIGURED_NETWORK indicates a mismatch.
   */
  detectedNetwork: string | null;
  /**
   * True when detectedNetwork is non-null and differs from CONFIGURED_NETWORK.
   * Consumers can show a banner prompting the user to switch networks.
   */
  networkMismatch: boolean;
}

export interface UseWalletReturn extends WalletState {
  connect: (provider: WalletProvider) => Promise<string>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
  /** The network this app is configured to use ('testnet' | 'mainnet'). */
  configuredNetwork: 'testnet' | 'mainnet';
}

// ── Persistence key ────────────────────────────────────────────────────────
const STORAGE_KEY = 'stellar_wallet';

// ── Helper: derive network mismatch ───────────────────────────────────────
function isNetworkMismatch(detected: string | null): boolean {
  if (!detected) return false;
  return detected.toLowerCase() !== CONFIGURED_NETWORK;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export const useWallet = (): UseWalletReturn => {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    publicKey: null,
    provider: null,
    availableWallets: [],
    isLoading: true,
    error: null,
    disconnectReason: null,
    detectedNetwork: null,
    networkMismatch: false,
  });

  // Keep a ref so the polling closure always reads the latest state without
  // needing to be recreated on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── Detect available wallets on mount ─────────────────────────────────────
  useEffect(() => {
    detectAvailableWallets().then((wallets) => {
      setState((prev) => ({ ...prev, availableWallets: wallets, isLoading: false }));
    });
  }, []);

  // ── Restore previously connected wallet from localStorage ─────────────────
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    let isActive = true;

    (async () => {
      try {
        const { publicKey, provider, network } = JSON.parse(saved) as {
          publicKey: string;
          provider: WalletProvider;
          network?: string;
        };

        if (!publicKey || !provider) {
          localStorage.removeItem(STORAGE_KEY);
          if (!isActive) return;
          setState((prev) => ({
            ...prev,
            isConnected: false,
            publicKey: null,
            provider: null,
            detectedNetwork: null,
            networkMismatch: false,
          }));
          return;
        }

        if (!isActive) return;
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        const actualPublicKey = await getPublicKeyWithWallet(provider);
        const matches = actualPublicKey === publicKey;

        if (!isActive) return;
        if (!matches) {
          localStorage.removeItem(STORAGE_KEY);
          setState((prev) => ({
            ...prev,
            isConnected: false,
            publicKey: null,
            provider: null,
            isLoading: false,
            detectedNetwork: null,
            networkMismatch: false,
          }));
          return;
        }

        const restoredNetwork = network ?? null;
        setState((prev) => ({
          ...prev,
          isConnected: true,
          publicKey,
          provider,
          isLoading: false,
          detectedNetwork: restoredNetwork,
          networkMismatch: isNetworkMismatch(restoredNetwork),
        }));
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        if (!isActive) return;
        setState((prev) => ({
          ...prev,
          isConnected: false,
          publicKey: null,
          provider: null,
          isLoading: false,
          detectedNetwork: null,
          networkMismatch: false,
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
          localStorage.removeItem(STORAGE_KEY);
          setState((prev) => ({
            ...prev,
            isConnected: false,
            publicKey: null,
            provider: null,
            disconnectReason: 'external',
            detectedNetwork: null,
            networkMismatch: false,
          }));
          return;
        }

        if (currentKey !== knownKey) {
          // Account was switched externally.
          localStorage.removeItem(STORAGE_KEY);
          setState((prev) => ({
            ...prev,
            isConnected: false,
            publicKey: null,
            provider: null,
            disconnectReason: 'account_changed',
            detectedNetwork: null,
            networkMismatch: false,
          }));
        }
      } catch {
        // Any error (extension unresponsive, etc.) → treat as external disconnect.
        localStorage.removeItem(STORAGE_KEY);
        setState((prev) => ({
          ...prev,
          isConnected: false,
          publicKey: null,
          provider: null,
          disconnectReason: 'external',
          detectedNetwork: null,
          networkMismatch: false,
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

      // Attempt to detect the wallet's current network.
      // Freighter exposes getNetwork(); Albedo does not have an equivalent —
      // we default to the configured network for Albedo.
      let detectedNet: string | null = null;
      try {
        if (provider === 'freighter') {
          const { getNetwork } = await import('@stellar/freighter-api');
          const netResult = await getNetwork();
          // getNetwork returns a string like 'TESTNET' / 'PUBLIC' or an object
          const raw: string =
            typeof netResult === 'object'
              ? (netResult as any).network ?? ''
              : String(netResult ?? '');
          if (raw) {
            // Normalise: 'TESTNET' → 'testnet', 'PUBLIC' → 'mainnet'
            detectedNet = raw.toLowerCase() === 'public' ? 'mainnet' : 'testnet';
          }
        } else if (provider === 'albedo') {
          // Albedo always uses the network the user passes via intent params;
          // default to the configured network.
          detectedNet = CONFIGURED_NETWORK;
        }
      } catch {
        // Network detection is best-effort; ignore errors.
      }

      const networkMismatchDetected = isNetworkMismatch(detectedNet);

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          publicKey: result.publicKey,
          provider,
          network: detectedNet,
        }),
      );

      setState((prev) => ({
        ...prev,
        isConnected: true,
        publicKey: result.publicKey,
        provider,
        isLoading: false,
        disconnectReason: null,
        detectedNetwork: detectedNet,
        networkMismatch: networkMismatchDetected,
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
        detectedNetwork: null,
        networkMismatch: false,
      }));
      throw error;
    }
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState((prev) => ({
      ...prev,
      isConnected: false,
      publicKey: null,
      provider: null,
      error: null,
      disconnectReason: 'user',
      detectedNetwork: null,
      networkMismatch: false,
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
    configuredNetwork: CONFIGURED_NETWORK,
  };
};
