import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardData } from './useDashboardData';
import { apiClient } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiClient: {
    refreshCurrentUser: jest.fn(),
    getInvestorInvestments: jest.fn(),
  },
}));

const mockRefreshUser = apiClient.refreshCurrentUser as jest.Mock;
const mockGetInvestments = apiClient.getInvestorInvestments as jest.Mock;

const CACHE_KEY = 'dashboard_data';

const mockUser = {
  id: 'user-1',
  email: 'investor@example.com',
  role: 'investor' as const,
  name: 'Test Investor',
};

const mockInvestments = [
  {
    id: 'inv-1',
    trade_deal_id: 'deal-1',
    investor_id: 'user-1',
    token_amount: 10,
    amount_usd: 1000,
    amount_invested: 1000,
    token_holdings: 10,
    status: 'confirmed' as const,
    created_at: '2024-01-01T00:00:00Z',
    expected_return_usd: 1150,
    actual_return_usd: null,
    return_percentage: null,
    deal: {
      id: 'deal-1',
      commodity: 'maize',
      quantity: 1000,
      quantity_unit: 'kg',
      total_value: 10000,
      funded_amount: 5000,
      total_invested: 5000,
      token_count: 100,
      tokens_remaining: 50,
      token_symbol: 'MZE',
      issuer_public_key: null,
      status: 'open' as const,
      delivery_date: '2025-06-01',
      created_at: '2024-01-01T00:00:00Z',
    },
  },
];

describe('useDashboardData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (localStorage.getItem as jest.Mock).mockReturnValue(null);
    (localStorage.setItem as jest.Mock).mockImplementation(() => {});
  });

  it('fetches and returns data from API when online', async () => {
    mockRefreshUser.mockResolvedValue(mockUser);
    mockGetInvestments.mockResolvedValue(mockInvestments);

    const { result } = renderHook(() => useDashboardData());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ user: mockUser, investments: mockInvestments });
    expect(result.current.isOffline).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('caches successful API response in localStorage', async () => {
    mockRefreshUser.mockResolvedValue(mockUser);
    mockGetInvestments.mockResolvedValue(mockInvestments);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(localStorage.setItem).toHaveBeenCalledWith(
      CACHE_KEY,
      JSON.stringify({ user: mockUser, investments: mockInvestments }),
    );
  });

  it('loads cached data from localStorage when API fetch fails', async () => {
    const cachedData = { user: mockUser, investments: mockInvestments };
    (localStorage.getItem as jest.Mock).mockImplementation((key: string) =>
      key === CACHE_KEY ? JSON.stringify(cachedData) : null,
    );

    mockRefreshUser.mockRejectedValue(new Error('Network Error'));
    mockGetInvestments.mockRejectedValue(new Error('Network Error'));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(cachedData);
    expect(result.current.isOffline).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('returns error when API fails and no cached data exists', async () => {
    (localStorage.getItem as jest.Mock).mockReturnValue(null);
    mockRefreshUser.mockRejectedValue(new Error('Service Unavailable'));
    mockGetInvestments.mockRejectedValue(new Error('Service Unavailable'));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.isOffline).toBe(false);
    expect(result.current.error).toBe('Service Unavailable');
  });

  it('starts in loading state', () => {
    mockRefreshUser.mockResolvedValue(mockUser);
    mockGetInvestments.mockResolvedValue([]);

    const { result } = renderHook(() => useDashboardData());

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isOffline).toBe(false);
  });
});
