import { useState, useEffect, useCallback } from 'react';
import { isConnected, getPublicKey, signTransaction } from '@stellar/freighter-api';

export interface WalletState {
  isConnected: boolean;
  publicKey: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface UseWalletReturn extends WalletState {
  connect: () => Promise<string>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

export const useWallet = (): UseWalletReturn => {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    publicKey: null,
    isLoading: false,
    error: null,
  });

  const checkConnection = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      const connected = await isConnected();
      if (connected) {
        const publicKey = await getPublicKey();
        setState(prev => ({
          ...prev,
          isConnected: true,
          publicKey,
          isLoading: false,
        }));
      } else {
        setState(prev => ({
          ...prev,
          isConnected: false,
          publicKey: null,
          isLoading: false,
        }));
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isConnected: false,
        publicKey: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to check wallet connection',
      }));
    }
  }, []);

  // Check wallet connection status on mount
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const connect = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      const publicKey = await getPublicKey();
      setState(prev => ({
        ...prev,
        isConnected: true,
        publicKey,
        isLoading: false,
      }));
      
      return publicKey;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isConnected: false,
        publicKey: null,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to connect wallet',
      }));
      throw error;
    }
  }, []);

  const disconnect = useCallback(() => {
    setState({
      isConnected: false,
      publicKey: null,
      isLoading: false,
      error: null,
    });
  }, []);

  const signTransactionXdr = useCallback(async (xdr: string): Promise<string> => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      const signedXdr = await signTransaction(xdr, {
        networkPassphrase: 'Test SDF Network ; September 2015', // Testnet
      });
      
      setState(prev => ({ ...prev, isLoading: false }));
      return signedXdr;
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to sign transaction',
      }));
      throw error;
    }
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    signTransaction: signTransactionXdr,
  };
};