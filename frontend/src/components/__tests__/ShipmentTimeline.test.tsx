import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShipmentTimeline } from '../ShipmentTimeline';

const mockMilestones = [
  {
    id: '1',
    milestone: 'farm' as const,
    notes: 'Collected from organic farm',
    stellarTxId: 'stellar-tx-123',
    recordedBy: 'trader-1',
    recordedAt: '2026-04-20T10:00:00Z',
  },
  {
    id: '2',
    milestone: 'warehouse' as const,
    notes: 'Stored in temperature-controlled facility',
    stellarTxId: 'stellar-tx-456',
    recordedBy: 'trader-1',
    recordedAt: '2026-04-21T14:30:00Z',
  },
];

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(() => 'mock-auth-token'),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('ShipmentTimeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  it('renders loading state initially', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => 
      new Promise(() => {}) // Never resolves to keep loading state
    );

    render(<ShipmentTimeline tradeDealId="deal-123" />);
    
    // Check for loading skeleton by class name
    const loadingContainer = document.querySelector('.animate-pulse');
    expect(loadingContainer).toBeTruthy();
  });

  it('renders completed and current milestones correctly', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockMilestones,
    });

    render(<ShipmentTimeline tradeDealId="deal-123" />);

    await waitFor(() => {
      expect(screen.getByText('Farm Collection')).toBeInTheDocument();
    });

    // Check completed milestones
    expect(screen.getByText('Farm Collection')).toBeInTheDocument();
    expect(screen.getByText('Warehouse Storage')).toBeInTheDocument();
    expect(screen.getByText('Collected from organic farm')).toBeInTheDocument();
    expect(screen.getByText('Stored in temperature-controlled facility')).toBeInTheDocument();

    // Check current milestone (next in sequence)
    expect(screen.getByText('Port Shipment')).toBeInTheDocument();
    expect(screen.getByText('Next milestone')).toBeInTheDocument();

    // Check pending milestone
    expect(screen.getByText('Importer Receipt')).toBeInTheDocument();

    // Check Stellar transaction IDs are truncated
    expect(screen.getByText('stellar-tx-123...')).toBeInTheDocument();
    expect(screen.getByText('stellar-tx-456...')).toBeInTheDocument();
  });

  it('renders error state and retry functionality', async () => {
    const user = userEvent.setup();
    
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    render(<ShipmentTimeline tradeDealId="deal-123" />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    const retryButton = screen.getByText('Try again');
    expect(retryButton).toBeInTheDocument();

    // Mock successful retry
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockMilestones,
    });

    await user.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText('Farm Collection')).toBeInTheDocument();
    });
  });

  it('handles authentication error', async () => {
    mockLocalStorage.getItem.mockReturnValueOnce(null);

    render(<ShipmentTimeline tradeDealId="deal-123" />);

    await waitFor(() => {
      expect(screen.getByText(/Authentication required/)).toBeInTheDocument();
    });
  });

  it('renders empty state when no milestones exist', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    render(<ShipmentTimeline tradeDealId="deal-123" />);

    await waitFor(() => {
      expect(screen.getByText('No milestones recorded yet')).toBeInTheDocument();
    });

    expect(screen.getByText('Milestones will appear here as the shipment progresses')).toBeInTheDocument();
  });

  it('formats dates correctly', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockMilestones,
    });

    render(<ShipmentTimeline tradeDealId="deal-123" />);

    await waitFor(() => {
      // Check that dates are formatted (exact format may vary by locale)
      expect(screen.getByText(/Apr 20/)).toBeInTheDocument();
      expect(screen.getByText(/Apr 21/)).toBeInTheDocument();
    });
  });

  it('makes API call with correct parameters', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockMilestones,
    });

    render(<ShipmentTimeline tradeDealId="deal-456" />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/shipments/deal-456', {
        headers: {
          'Authorization': 'Bearer mock-auth-token',
        },
      });
    });
  });
});