'use client';

import { useWallet } from '../hooks/useWallet';
import { useState } from 'react';

interface WalletButtonProps {
  onWalletLinked?: (publicKey: string) => void;
}

export const WalletButton: React.FC<WalletButtonProps> = ({ onWalletLinked }) => {
  const { isConnected, publicKey, isLoading, error, connect, disconnect } = useWallet();
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const handleConnect = async () => {
    try {
      setLinkError(null);
      setIsLinking(true);
      
      const connectedPublicKey = await connect();
      
      // Link wallet to user account
      const token = localStorage.getItem('authToken');
      if (!token) {
        throw new Error('Please log in first');
      }

      const response = await fetch('/api/auth/wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ walletAddress: connectedPublicKey }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to link wallet');
      }

      onWalletLinked?.(connectedPublicKey);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Failed to connect wallet');
    } finally {
      setIsLinking(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setLinkError(null);
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-end">
        <button
          onClick={handleConnect}
          disabled={isLoading || isLinking}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          {isLoading || isLinking ? 'Connecting...' : 'Connect Wallet'}
        </button>
        
        {(error || linkError) && (
          <div className="mt-2 text-sm text-red-600 max-w-xs">
            {error || linkError}
            {error?.includes('Freighter') && (
              <div className="mt-1">
                <a
                  href="https://freighter.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  Install Freighter Wallet
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-3">
      <div className="flex items-center space-x-2">
        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
        <span className="text-sm text-gray-700 font-mono">
          {publicKey ? truncateAddress(publicKey) : 'Connected'}
        </span>
      </div>
      <button
        onClick={handleDisconnect}
        className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        Disconnect
      </button>
    </div>
  );
};