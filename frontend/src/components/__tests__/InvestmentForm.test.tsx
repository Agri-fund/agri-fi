import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvestmentForm } from '../InvestmentForm';
import { ToastProvider } from '../ui/ToastProvider';

const renderWithToast = (ui: React.ReactElement) =>
  render(<ToastProvider>{ui}</ToastProvider>);

jest.mock('../../hooks/useWallet', () => ({
  useWallet: jest.fn(),
}));

jest.mock('../../lib/api', () => ({
  ...jest.requireActual('../../lib/api'),
  getStoredToken: jest.fn(() => 'mock-auth-token'),
}));

const mockUseWallet = require('../../hooks/useWallet').useWallet as jest.Mock;
const mockGetStoredToken = require('../../lib/api').getStoredToken as jest.Mock;

const createInvestmentResponse = (tokenAmount = 1, amountUsd = 100) => ({
  investment: {
    id: 'investment-123',
    tokenAmount,
    amountUsd,
  },
  unsignedXdr: 'unsigned-xdr-123',
});

const fundResponse = (stellarTxId = 'stellar-tx-456') => ({
  stellarTxId,
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
    mockGetStoredToken.mockReturnValue('mock-auth-token');

    mockUseWallet.mockReturnValue({
      isConnected: true,
      publicKey: 'GTEST123...',
      signTransaction: jest.fn(),
    });
  });

  it('validates token quantity input and shows calculated USD amount', async () => {
    renderWithToast(<InvestmentForm {...defaultProps} />);

    const tokenInput = screen.getByLabelText('Number of Tokens');
    expect(tokenInput).toBeInTheDocument();
    expect(tokenInput).toHaveValue(1);

    expect(screen.getByText('Token Price:')).toBeInTheDocument();
    expect(screen.getByText('Quantity:')).toBeInTheDocument();
    expect(screen.getByText('Total Investment:')).toBeInTheDocument();

    fireEvent.change(tokenInput, { target: { value: '5' } });

    await waitFor(() => {
      expect(tokenInput).toHaveValue(5);
    });

    expect(screen.getByText('Invest $500')).toBeInTheDocument();
  });

  it('enforces minimum and maximum token limits', async () => {
    renderWithToast(<InvestmentForm {...defaultProps} />);

    const tokenInput = screen.getByLabelText('Number of Tokens');
    const submitButton = screen.getByRole('button', { name: /Invest/ });

    fireEvent.change(tokenInput, { target: { value: '0' } });

    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });

    fireEvent.change(tokenInput, { target: { value: '100' } });

    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });

    fireEvent.change(tokenInput, { target: { value: '25' } });

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });

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

    renderWithToast(<InvestmentForm {...defaultProps} />);

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

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => createInvestmentResponse(5, 500),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => fundResponse('stellar-tx-456'),
      });

    renderWithToast(<InvestmentForm {...defaultProps} />);

    const tokenInput = screen.getByLabelText('Number of Tokens');
    const submitButton = screen.getByRole('button', { name: /Invest/ });

    fireEvent.change(tokenInput, { target: { value: '5' } });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Investment Successful!')).toBeInTheDocument();
    });

    expect(screen.getByText('Investment Amount:')).toBeInTheDocument();
    expect(screen.getByText(/\$500/)).toBeInTheDocument();
    expect(screen.getByText('Tokens Purchased:')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getAllByText('stellar-tx-456').length).toBeGreaterThan(0);

    expect(global.fetch).toHaveBeenCalledWith('/api/investments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock-auth-token',
      },
      body: JSON.stringify({
        tradeDealId: 'deal-123',
        tokenAmount: 5,
        amountUsd: 500,
      }),
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/investments/investment-123/fund', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mock-auth-token',
      },
      body: JSON.stringify({
        investorWalletAddress: 'GTEST123...',
        signedXdr: 'signed-xdr-123',
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

    renderWithToast(<InvestmentForm {...defaultProps} />);

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
      json: async () => createInvestmentResponse(),
    });

    renderWithToast(<InvestmentForm {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /Invest/ });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('User rejected transaction')).toBeInTheDocument();
    });
  });

  it('handles authentication error', async () => {
    const user = userEvent.setup();
    mockGetStoredToken.mockReturnValueOnce(null);

    renderWithToast(<InvestmentForm {...defaultProps} />);

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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => createInvestmentResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => fundResponse(),
      });

    renderWithToast(<InvestmentForm {...defaultProps} />);

    const submitButton = screen.getByRole('button', { name: /Invest/ });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Investment Successful!')).toBeInTheDocument();
    });

    const anotherInvestmentButton = screen.getByText('Make Another Investment');
    await user.click(anotherInvestmentButton);

    expect(screen.getByLabelText('Number of Tokens')).toBeInTheDocument();
    expect(screen.queryByText('Investment Successful!')).not.toBeInTheDocument();
  });
});
