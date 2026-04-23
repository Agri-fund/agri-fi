import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvestmentForm } from '../InvestmentForm';
import * as freighterApi from '@stellar/freighter-api';

// Mock the useWallet hook
jest.mock('../../hooks/useWallet', () => ({
  useWallet: jest.fn(),
}));

const mockUseWallet = require('../../hooks/useWallet').useWallet as jest.Mock;

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(() => 'mock-auth-token'),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('InvestmentForm', () => {
  const defaultProps = {
    dealId: 'deal-123',
    maxTokens: 50,
    tokenPrice: 100,
    onSuccess: jest.fn(),
    onError: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
    
    // Default wallet state - connected
    mockUseWallet.mockReturnValue({
      isConnected: true,
      publicKey: 'GTEST123...',
      signTransaction: jest.fn(),
    });
  });

  it('validates token quantity input and shows calculated USD amount', async () => {
    render(<InvestmentForm {...defaultProps} />);

    const tokenInput = screen.getByLabelText('Number of Tokens');
    expect(tokenInput).toBeInTheDocument();
    expect(tokenInput).toHaveValue(1);

    // Check initial calculation
    expect(screen.getByText('Token Price:')).toBeInTheDocument();
    expect(screen.getByText('Quantity:')).toBeInTheDocument();
    expect(screen.getByText('Total Investment:')).toBeInTheDocument();

    // Change quantity using fireEvent to directly set the value
    fireEvent.change(tokenInput, { target: { value: '5' } });

    await waitFor(() => {
      expect(tokenInput).toHaveValue(5);
    });

    // Check submit button text updates
    expect(screen.getByText('Invest $500')).toBeInTheDocument();
  });

  it('enforces minimum and maximum token limits', async () => {
    render(<InvestmentForm {...defaultProps} />);

    const tokenInput = screen.getByLabelText('Number of Tokens');
    const submitButton = screen.getByRole('button', { name: /Invest/ });

    // Test below minimum
    fireEvent.change(tokenInput, { target: { value: '0' } });
    
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });

    // Test above maximum
    fireEvent.change(tokenInput, { target: { value: '100' } });
    
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });

    // Test valid range
    fireEvent.change(tokenInput, { target: { value: '25' } });
    
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

    // Test edge case - exactly at max
    fireEvent.change(tokenInput, { target: { value: '50' } });
    
    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('shows wallet connection prompt when not connected', () => {
    mockUseWallet.mockReturnValue({
      isConnected: false,
      publicKey: null,
      signTransaction: jest.fn(),
    });

    render(<InvestmentForm {...defaultProps} />);

    expect(screen.getByText(/Please connect your Stellar wallet to invest/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Number of Tokens')).not.toBeInTheDocument();
  });

  it('handles successful investment flow', async () => {
    const user = userEvent.setup();
    const mockSignTransaction = jest.fn().mockResolvedValue('signed-xdr-123');
    
    mockUseWallet.mockReturnValue({
      isConnected: true,
      publicKey: 'GTEST123...',
      signTransaction: mockSignTransaction,
    });

    // Mock API responses
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'investment-123',
          unsignedXdr: 'unsigned-xdr-123',
          tokenAmount: 5,
          amountUsd: 500,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          stellarTxId: 'stellar-tx-456',
        }),
      });

    render(<InvestmentForm {...defaultProps} />);

    const tokenInput = screen.getByLabelText('Number of Tokens');
    const submitButton = screen.getByRole('button', { name: /Invest/ });

    // Set token quantity using fireEvent
    fireEvent.change(tokenInput, { target: { value: '5' } });

    // Submit form
    await user.click(submitButton);

    // Wait for success state
    await waitFor(() => {
      expect(screen.getByText('Investment Successful!')).toBeInTheDocument();
    });

    // Check success details
    expect(screen.getByText('Investment Amount:')).toBeInTheDocument();
    expect(screen.getByText(/\$500/)).toBeInTheDocument();
    expect(screen.getByText('Tokens Purchased:')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('stellar-tx-456')).toBeInTheDocument();

    // Verify API calls
    expect(global.fetch).toHaveBeenCalledWith('/api/investments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer mock-auth-token',
      },
      body: JSON.stringify({
        tradeDealId: 'deal-123',
        tokenAmount: 5,
      }),
    });

    expect(mockSignTransaction).toHaveBeenCalledWith('unsigned-xdr-123');
  });

  it('handles investment creation error', async () => {
    const user = userEvent.setup();
    
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'Insufficient tokens available' }),
    });

    render(<InvestmentForm {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /Invest/ });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Insufficient tokens available')).toBeInTheDocument();
    });

    expect(defaultProps.onError).toHaveBeenCalledWith('Insufficient tokens available');
  });

  it('handles Freighter signing error', async () => {
    const user = userEvent.setup();
    const mockSignTransaction = jest.fn().mockRejectedValue(new Error('User rejected transaction'));
    
    mockUseWallet.mockReturnValue({
      isConnected: true,
      publicKey: 'GTEST123...',
      signTransaction: mockSignTransaction,
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'investment-123',
        unsignedXdr: 'unsigned-xdr-123',
        tokenAmount: 1,
        amountUsd: 100,
      }),
    });

    render(<InvestmentForm {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /Invest/ });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('User rejected transaction')).toBeInTheDocument();
    });
  });

  it('handles authentication error', async () => {
    const user = userEvent.setup();
    mockLocalStorage.getItem.mockReturnValueOnce(null);

    render(<InvestmentForm {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /Invest/ });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Please log in first')).toBeInTheDocument();
    });
  });

  it('allows making another investment after success', async () => {
    const user = userEvent.setup();
    const mockSignTransaction = jest.fn().mockResolvedValue('signed-xdr-123');
    
    mockUseWallet.mockReturnValue({
      isConnected: true,
      publicKey: 'GTEST123...',
      signTransaction: mockSignTransaction,
    });

    (global.fetch as jest.Mock)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ stellarTxId: 'stellar-tx-456' }),
      });

    render(<InvestmentForm {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /Invest/ });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Investment Successful!')).toBeInTheDocument();
    });

    const anotherInvestmentButton = screen.getByText('Make Another Investment');
    await user.click(anotherInvestmentButton);

    // Should return to form
    expect(screen.getByLabelText('Number of Tokens')).toBeInTheDocument();
    expect(screen.queryByText('Investment Successful!')).not.toBeInTheDocument();
  });
});