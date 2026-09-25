'use client';

/**
 * useStellarWallet — Issue #243
 * Freighter-focused wallet hook with connecting / connected / disconnected states.
 * Wraps the existing useWallet hook and exposes Freighter-specific detection.
 *
 * Graceful disconnect (polling-based):
 *   - When Freighter is locked or the active account is switched outside this app
 *     the hook updates `status` → 'disconnected' and sets `disconnectReason` to
 *     'external' or 'account_changed' respectively.
 *   - Pass an `onDisconnect` callback to react immediately (e.g. show a toast).
 */

import { useEffect, useRef } from 'react';
import { useWallet, DisconnectReason } from './useWallet';

export type { DisconnectReason };

export type WalletStatus = 'disconnected' | 'connecting' | 'connected';

export interface StellarWalletState {
  status: WalletStatus;
  publicKey: string | null;
  /** Truncated public key for display, e.g. GABCD…XY12 */
  displayKey: string | null;
  /** 'Testnet' | 'Public' derived from NEXT_PUBLIC_STELLAR_NETWORK */
  network: 'Testnet' | 'Public';
  isFreighterInstalled: boolean;
  error: string | null;
  /**
   * Reason the wallet was last disconnected.
   * `null` while connected or before the first disconnect.
   */
  disconnectReason: DisconnectReason;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export interface UseStellarWalletOptions {
  /**
   * Called once whenever the wallet disconnects for a reason other than an
   * explicit in-app disconnect (i.e. `reason === 'external'` or
   * `reason === 'account_changed'`).
   */
  onDisconnect?: (reason: DisconnectReason) => void;
}

const FREIGHTER_INSTALL_URL = 'https://freighter.app/';

function truncateKey(key: string): string {
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export function useStellarWallet(
  options: UseStellarWalletOptions = {},
): StellarWalletState {
  const { onDisconnect } = options;

  const {
    isConnected,
    isLoading,
    publicKey,
    availableWallets,
    error,
    disconnectReason,
    connect,
    disconnect,
  } = useWallet();

  const isFreighterInstalled = availableWallets.includes('freighter');

  const network: 'Testnet' | 'Public' =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'Public' : 'Testnet';

  const status: WalletStatus = isLoading
    ? 'connecting'
    : isConnected
    ? 'connected'
    : 'disconnected';

  // ── External-disconnect callback ─────────────────────────────────────────
  // Fire `onDisconnect` exactly once when an external/account-changed reason
  // is detected. We track the previously-seen reason to avoid double-firing.
  const prevReasonRef = useRef<DisconnectReason>(null);

  useEffect(() => {
    const prev = prevReasonRef.current;
    prevReasonRef.current = disconnectReason;

    // Only fire when the reason transitions to an externally-triggered value.
    if (
      disconnectReason !== prev &&
      (disconnectReason === 'external' || disconnectReason === 'account_changed')
    ) {
      onDisconnect?.(disconnectReason);
    }
  }, [disconnectReason, onDisconnect]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleConnect = async () => {
    if (!isFreighterInstalled) {
      window.open(FREIGHTER_INSTALL_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    await connect('freighter');
  };

  return {
    status,
    publicKey,
    displayKey: publicKey ? truncateKey(publicKey) : null,
    network,
    isFreighterInstalled,
    error,
    disconnectReason,
    connect: handleConnect,
    disconnect,
  };
}
