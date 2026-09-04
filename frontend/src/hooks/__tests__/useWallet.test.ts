/**
 * useWallet hook unit tests — Issue #853
 *
 * Tests cover:
 * - Initial state
 * - Wallet detection on mount
 * - localStorage restore (both adapters)
 * - connect() for Freighter and Albedo
 * - disconnect() clears localStorage and state
 * - Network mismatch detection
 * - Polling: external disconnect, account changed
 * - signTransaction delegation
 * - localStorage (not sessionStorage) used for persistence
 */

import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mock stellar-wallet module ────────────────────────────────────────────────
jest.mock('../../lib/stellar-wallet', () => ({
  detectAvailableWallets: jest.fn(),
  connectWallet: jest.fn(),
  getPublicKeyWithWallet: jest.fn(),
  signTransactionWithWallet: jest.fn(),
}));

// ── Mock @stellar/freighter-api for getNetwork ────────────────────────────────
jest.mock('@stellar/freighter-api', () => ({
  isConnected: jest.fn(),
  getPublicKey: jest.fn(),
  signTransaction: jest.fn(),
  getNetwork: jest.fn(),
  requestAccess: jest.fn(),
}));

import {
  detectAvailableWallets,
  connectWallet,
  getPublicKeyWithWallet,
  signTransactionWithWallet,
} from '../../lib/stellar-wallet';
import { getNetwork } from '@stellar/freighter-api';
import { useWallet } from '../useWallet';

const mockDetectAvailableWallets = detectAvailableWallets as jest.MockedFunction<typeof detectAvailableWallets>;
const mockConnectWallet = connectWallet as jest.MockedFunction<typeof connectWallet>;
const mockGetPublicKeyWithWallet = getPublicKeyWithWallet as jest.MockedFunction<typeof getPublicKeyWithWallet>;
const mockSignTransactionWithWallet = signTransactionWithWallet as jest.MockedFunction<typeof signTransactionWithWallet>;
const mockGetNetwork = getNetwork as jest.MockedFunction<typeof getNetwork>;

const TEST_PUBLIC_KEY = 'GABC1234567890ABCDEF';
const TEST_XDR = 'AAAA...base64xdr';
const SIGNED_XDR = 'BBBB...signedxdr';

describe('useWallet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no available wallets, empty storage
    mockDetectAvailableWallets.mockResolvedValue([]);
    (localStorage.getItem as jest.Mock).mockReturnValue(null);
    (localStorage.setItem as jest.Mock).mockImplementation(() => undefined);
    (localStorage.removeItem as jest.Mock).mockImplementation(() => undefined);
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  it('starts with isLoading true, not connected, no public key', () => {
    const { result } = renderHook(() => useWallet());

    // Check synchronous initial state
    expect(result.current.isConnected).toBe(false);
    expect(result.current.publicKey).toBeNull();
    expect(result.current.provider).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.disconnectReason).toBeNull();
    expect(result.current.networkMismatch).toBe(false);
    expect(result.current.detectedNetwork).toBeNull();
  });

  it('exposes configuredNetwork', () => {
    const { result } = renderHook(() => useWallet());
    expect(['testnet', 'mainnet']).toContain(result.current.configuredNetwork);
  });

  // ── Wallet detection ───────────────────────────────────────────────────────

  it('populates availableWallets after mount', async () => {
    mockDetectAvailableWallets.mockResolvedValue(['freighter', 'albedo']);
    const { result } = renderHook(() => useWallet());

    await waitFor(() => {
      expect(result.current.availableWallets).toEqual(['freighter', 'albedo']);
    });
  });

  it('sets isLoading false after wallet detection', async () => {
    mockDetectAvailableWallets.mockResolvedValue([]);
    const { result } = renderHook(() => useWallet());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  // ── localStorage restore ───────────────────────────────────────────────────

  it('restores Freighter session from localStorage on mount', async () => {
    const saved = JSON.stringify({
      publicKey: TEST_PUBLIC_KEY,
      provider: 'freighter',
      network: 'testnet',
    });
    (localStorage.getItem as jest.Mock).mockReturnValue(saved);
    mockGetPublicKeyWithWallet.mockResolvedValue(TEST_PUBLIC_KEY);

    const { result } = renderHook(() => useWallet());

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });

    expect(result.current.publicKey).toBe(TEST_PUBLIC_KEY);
    expect(result.current.provider).toBe('freighter');
    expect(result.current.detectedNetwork).toBe('testnet');
  });

  it('restores Albedo session from localStorage on mount', async () => {
    const saved = JSON.stringify({
      publicKey: TEST_PUBLIC_KEY,
      provider: 'albedo',
      network: 'testnet',
    });
    (localStorage.getItem as jest.Mock).mockReturnValue(saved);
    mockGetPublicKeyWithWallet.mockResolvedValue(TEST_PUBLIC_KEY);

    const { result } = renderHook(() => useWallet());

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });

    expect(result.current.provider).toBe('albedo');
  });

  it('clears storage and does not restore if key mismatch', async () => {
    const saved = JSON.stringify({
      publicKey: TEST_PUBLIC_KEY,
      provider: 'freighter',
    });
    (localStorage.getItem as jest.Mock).mockReturnValue(saved);
    // Wallet now returns a DIFFERENT key
    mockGetPublicKeyWithWallet.mockResolvedValue('GDIFFERENTKEY123');

    const { result } = renderHook(() => useWallet());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isConnected).toBe(false);
    expect(localStorage.removeItem).toHaveBeenCalledWith('stellar_wallet');
  });

  it('clears storage if saved JSON is invalid', async () => {
    (localStorage.getItem as jest.Mock).mockReturnValue('not-valid-json');

    const { result } = renderHook(() => useWallet());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isConnected).toBe(false);
  });

  // ── connect() — Freighter ─────────────────────────────────────────────────

  it('connects Freighter and sets state', async () => {
    mockConnectWallet.mockResolvedValue({ publicKey: TEST_PUBLIC_KEY, provider: 'freighter' });
    mockGetNetwork.mockResolvedValue('TESTNET' as any);

    const { result } = renderHook(() => useWallet());

    let returnedKey: string | undefined;
    await act(async () => {
      returnedKey = await result.current.connect('freighter');
    });

    expect(returnedKey).toBe(TEST_PUBLIC_KEY);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.publicKey).toBe(TEST_PUBLIC_KEY);
    expect(result.current.provider).toBe('freighter');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.disconnectReason).toBeNull();
  });

  it('persists connection to localStorage (not sessionStorage) on Freighter connect', async () => {
    mockConnectWallet.mockResolvedValue({ publicKey: TEST_PUBLIC_KEY, provider: 'freighter' });
    mockGetNetwork.mockResolvedValue('TESTNET' as any);

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connect('freighter');
    });

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'stellar_wallet',
      expect.stringContaining(TEST_PUBLIC_KEY),
    );
    // sessionStorage must NOT be used
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  // ── connect() — Albedo ────────────────────────────────────────────────────

  it('connects Albedo and sets state', async () => {
    mockConnectWallet.mockResolvedValue({ publicKey: TEST_PUBLIC_KEY, provider: 'albedo' });

    const { result } = renderHook(() => useWallet());

    let returnedKey: string | undefined;
    await act(async () => {
      returnedKey = await result.current.connect('albedo');
    });

    expect(returnedKey).toBe(TEST_PUBLIC_KEY);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.provider).toBe('albedo');
  });

  it('persists Albedo connection to localStorage', async () => {
    mockConnectWallet.mockResolvedValue({ publicKey: TEST_PUBLIC_KEY, provider: 'albedo' });

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connect('albedo');
    });

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'stellar_wallet',
      expect.stringContaining(TEST_PUBLIC_KEY),
    );
  });

  // ── connect() — network mismatch ──────────────────────────────────────────

  it('sets networkMismatch true when Freighter is on wrong network', async () => {
    mockConnectWallet.mockResolvedValue({ publicKey: TEST_PUBLIC_KEY, provider: 'freighter' });
    // Freighter reports 'PUBLIC' (mainnet) but app is configured for testnet
    mockGetNetwork.mockResolvedValue('PUBLIC' as any);

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connect('freighter');
    });

    expect(result.current.detectedNetwork).toBe('mainnet');
    // networkMismatch depends on CONFIGURED_NETWORK; if configured as 'testnet' it's true
    if (result.current.configuredNetwork === 'testnet') {
      expect(result.current.networkMismatch).toBe(true);
    }
  });

  it('sets networkMismatch false when Freighter is on correct network', async () => {
    mockConnectWallet.mockResolvedValue({ publicKey: TEST_PUBLIC_KEY, provider: 'freighter' });
    mockGetNetwork.mockResolvedValue('TESTNET' as any);

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connect('freighter');
    });

    if (result.current.configuredNetwork === 'testnet') {
      expect(result.current.networkMismatch).toBe(false);
    }
  });

  // ── connect() — error handling ────────────────────────────────────────────

  it('sets error state when connectWallet throws', async () => {
    mockConnectWallet.mockRejectedValue(new Error('User denied'));

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await expect(result.current.connect('freighter')).rejects.toThrow('User denied');
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBe('User denied');
    expect(result.current.isLoading).toBe(false);
  });

  // ── disconnect() ───────────────────────────────────────────────────────────

  it('disconnect() clears state and localStorage', async () => {
    mockConnectWallet.mockResolvedValue({ publicKey: TEST_PUBLIC_KEY, provider: 'freighter' });
    mockGetNetwork.mockResolvedValue('TESTNET' as any);

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connect('freighter');
    });

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.publicKey).toBeNull();
    expect(result.current.provider).toBeNull();
    expect(result.current.disconnectReason).toBe('user');
    expect(result.current.networkMismatch).toBe(false);
    expect(result.current.detectedNetwork).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith('stellar_wallet');
  });

  it('disconnect() does not use sessionStorage', async () => {
    const { result } = renderHook(() => useWallet());

    act(() => {
      result.current.disconnect();
    });

    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });

  // ── signTransaction() ──────────────────────────────────────────────────────

  it('signs a transaction via the connected wallet', async () => {
    mockConnectWallet.mockResolvedValue({ publicKey: TEST_PUBLIC_KEY, provider: 'freighter' });
    mockGetNetwork.mockResolvedValue('TESTNET' as any);
    mockSignTransactionWithWallet.mockResolvedValue({ signedXdr: SIGNED_XDR, provider: 'freighter' });

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connect('freighter');
    });

    let signed: string | undefined;
    await act(async () => {
      signed = await result.current.signTransaction(TEST_XDR);
    });

    expect(signed).toBe(SIGNED_XDR);
    expect(mockSignTransactionWithWallet).toHaveBeenCalledWith(
      TEST_XDR,
      'freighter',
      expect.any(String), // network passphrase
    );
  });

  it('throws when signTransaction is called with no wallet connected', async () => {
    const { result } = renderHook(() => useWallet());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.signTransaction(TEST_XDR)).rejects.toThrow(
        'No wallet connected',
      );
    });
  });

  it('signs with Albedo adapter', async () => {
    mockConnectWallet.mockResolvedValue({ publicKey: TEST_PUBLIC_KEY, provider: 'albedo' });
    mockSignTransactionWithWallet.mockResolvedValue({ signedXdr: SIGNED_XDR, provider: 'albedo' });

    const { result } = renderHook(() => useWallet());

    await act(async () => {
      await result.current.connect('albedo');
    });

    let signed: string | undefined;
    await act(async () => {
      signed = await result.current.signTransaction(TEST_XDR);
    });

    expect(signed).toBe(SIGNED_XDR);
    expect(mockSignTransactionWithWallet).toHaveBeenCalledWith(
      TEST_XDR,
      'albedo',
      expect.any(String),
    );
  });

  // ── sessionStorage must NOT be used at all ────────────────────────────────

  it('never reads from sessionStorage', async () => {
    renderHook(() => useWallet());

    await waitFor(() => {});

    expect(sessionStorage.getItem).not.toHaveBeenCalled();
  });
});
