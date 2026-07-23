'use client';

/**
 * useStellarWallet — Issue #243
 * Freighter-focused wallet hook with connecting / connected / disconnected states.
 * Wraps the existing useWallet hook and exposes Freighter-specific detection.
 */

import { useWallet } from './useWallet';

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
  connect: () => Promise<void>;
  disconnect: () => void;
}

const FREIGHTER_INSTALL_URL = 'https://freighter.app/';

function truncateKey(key: string): string {
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export function useStellarWallet(): StellarWalletState {
  const { isConnected, isLoading, publicKey, availableWallets, error, connect, disconnect } =
    useWallet();

  const isFreighterInstalled = availableWallets.includes('freighter');

  const network: 'Testnet' | 'Public' =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'Public' : 'Testnet';

  const status: WalletStatus = isLoading
    ? 'connecting'
    : isConnected
    ? 'connected'
    : 'disconnected';

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
    connect: handleConnect,
    disconnect,
  };
}
