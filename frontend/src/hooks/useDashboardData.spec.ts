import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardData } from './useDashboardData';
import { apiClient } from '../lib/api';

jest.mock('../lib/api', () => ({
  apiClient: {
    getCurrentUser: jest.fn(),
    refreshCurrentUser: jest.fn(),
    getInvestorInvestments: jest.fn(),
  },
}));

const mockGetCurrentUser = apiClient.getCurrentUser as jest.Mock;
const mockRefreshUser = apiClient.refreshCurrentUser as jest.Mock;
const mockGetInvestments = apiClient.getInvestorInvestments as jest.Mock;

const USER_ID = 'user-1';
const CACHE_KEY = `dashboard_data_${USER_ID}`;

const mockUser = {
  id: USER_ID,
  email: 'investor@example.com',
  role: 'investor' as const,
  name: 'Test Investor',
};

const mockInvestments = [
  {
    id: 'inv-1',
    trade_deal_id: 'deal-1',
    investor_id: USER_ID,
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
    mockGetCurrentUser.mockReturnValue(mockUser);
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

  it('caches a successful API response in localStorage keyed by user ID', async () => {
    mockRefreshUser.mockResolvedValue(mockUser);
    mockGetInvestments.mockResolvedValue(mockInvestments);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(localStorage.setItem).toHaveBeenCalledWith(
      CACHE_KEY,
      JSON.stringify({ user: mockUser, investments: mockInvestments }),
    );
  });

  it('loads cached data immediately on mount, before the API resolves', async () => {
    const cachedData = { user: mockUser, investments: mockInvestments };
    (localStorage.getItem as jest.Mock).mockImplementation((key: string) =>
      key === CACHE_KEY ? JSON.stringify(cachedData) : null,
    );

    let resolveUser: (value: typeof mockUser) => void;
    mockRefreshUser.mockReturnValue(new Promise((resolve) => { resolveUser = resolve; }));
    mockGetInvestments.mockResolvedValue(mockInvestments);

    const { result } = renderHook(() => useDashboardData());

    // Cache is served synchronously on mount, without waiting for the
    // (still-pending) API call to resolve.
    await waitFor(() => expect(result.current.data).toEqual(cachedData));
    expect(result.current.loading).toBe(false);
    expect(result.current.isOffline).toBe(false);

    // Let the background revalidation finish so no state update leaks past
    // this test's lifetime.
    resolveUser!(mockUser);
    await waitFor(() => expect(result.current.data).toEqual({ user: mockUser, investments: mockInvestments }));
  });

  it('revalidates in the background and replaces cached data with the fresh API response', async () => {
    const staleData = {
      user: mockUser,
      investments: [{ ...mockInvestments[0], amount_invested: 1 }],
    };
    (localStorage.getItem as jest.Mock).mockImplementation((key: string) =>
      key === CACHE_KEY ? JSON.stringify(staleData) : null,
    );

    mockRefreshUser.mockResolvedValue(mockUser);
    mockGetInvestments.mockResolvedValue(mockInvestments);

    const { result } = renderHook(() => useDashboardData());

    // Stale cache shown first.
    await waitFor(() => expect(result.current.data).toEqual(staleData));

    // Fresh data replaces it once the background revalidation resolves.
    await waitFor(() =>
      expect(result.current.data).toEqual({ user: mockUser, investments: mockInvestments }),
    );
    expect(result.current.isOffline).toBe(false);
  });

  it('keeps showing cached data and flags it as offline when revalidation fails', async () => {
    const cachedData = { user: mockUser, investments: mockInvestments };
    (localStorage.getItem as jest.Mock).mockImplementation((key: string) =>
      key === CACHE_KEY ? JSON.stringify(cachedData) : null,
    );

    mockRefreshUser.mockRejectedValue(new Error('Network Error'));
    mockGetInvestments.mockRejectedValue(new Error('Network Error'));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.isOffline).toBe(true));

    expect(result.current.data).toEqual(cachedData);
    expect(result.current.error).toBeNull();
  });

  it('returns an error when the API fails and no cached data exists', async () => {
    mockRefreshUser.mockRejectedValue(new Error('Service Unavailable'));
    mockGetInvestments.mockRejectedValue(new Error('Service Unavailable'));

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.isOffline).toBe(false);
    expect(result.current.error).toBe('Service Unavailable');
  });

  it('starts in loading state when there is no cached data', () => {
    mockRefreshUser.mockResolvedValue(mockUser);
    mockGetInvestments.mockResolvedValue([]);

    const { result } = renderHook(() => useDashboardData());

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isOffline).toBe(false);
  });

  it('skips the cache lookup when no user is logged in yet', async () => {
    mockGetCurrentUser.mockReturnValue(null);
    mockRefreshUser.mockResolvedValue(mockUser);
    mockGetInvestments.mockResolvedValue(mockInvestments);

    const { result } = renderHook(() => useDashboardData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(result.current.data).toEqual({ user: mockUser, investments: mockInvestments });
  });
});
