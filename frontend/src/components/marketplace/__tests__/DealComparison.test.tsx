import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter, useSearchParams } from 'next/navigation';
import DealComparison, {
  COMPARISON_STORAGE_KEY,
  generateComparisonCSV,
  parseComparisonParams,
  generateShareLink,
} from '../DealComparison';
import { Deal } from '@/lib/api';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn(),
  },
});

// Mock blob and file operations
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

const mockDeal1: Deal = {
  id: 'deal-1',
  commodity: 'Cocoa',
  total_value: 50000,
  total_invested: 25000,
  expected_roi: 24.5,
  duration_days: 180,
  risk_rating: 'Medium',
  title: 'Premium Cocoa — Ghana 2026',
  description: 'Test deal',
  quantity: 1000,
  quantity_unit: 'kg',
  token_count: 5000,
  token_symbol: 'COCOA-001',
  farmer_id: 'farmer-1',
  trader_id: 'trader-1',
  status: 'open',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockDeal2: Deal = {
  ...mockDeal1,
  id: 'deal-2',
  commodity: 'Maize',
  total_value: 75000,
  total_invested: 50000,
  expected_roi: 18.0,
  duration_days: 120,
  risk_rating: 'Low',
  title: 'Premium Maize — Kenya 2026',
};

const mockDeal3: Deal = {
  ...mockDeal1,
  id: 'deal-3',
  commodity: 'Coffee',
  total_value: 100000,
  total_invested: 80000,
  expected_roi: 22.0,
  duration_days: 150,
  risk_rating: 'High',
  title: 'Premium Coffee — Ethiopia 2026',
};

describe('DealComparison Component', () => {
  let mockRouter: any;
  let mockSearchParams: any;

  beforeEach(() => {
    mockRouter = { push: jest.fn() };
    mockSearchParams = new URLSearchParams();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);

    localStorage.clear();
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should not render when deals list is empty', () => {
      const { container } = render(
        <DealComparison
          deals={[]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should render comparison table with all deals', () => {
      render(
        <DealComparison
          deals={[mockDeal1, mockDeal2]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      expect(screen.getByText('Compare deals (2/3)')).toBeInTheDocument();
      expect(screen.getByText('Cocoa')).toBeInTheDocument();
      expect(screen.getByText('Maize')).toBeInTheDocument();
    });

    it('should display all comparison metrics', () => {
      render(
        <DealComparison
          deals={[mockDeal1, mockDeal2]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      expect(screen.getByText('Expected ROI')).toBeInTheDocument();
      expect(screen.getByText('Duration')).toBeInTheDocument();
      expect(screen.getByText('Funding progress')).toBeInTheDocument();
      expect(screen.getByText('Risk rating')).toBeInTheDocument();
      expect(screen.getByText('Commodity')).toBeInTheDocument();
      expect(screen.getByText('Total Value')).toBeInTheDocument();
      expect(screen.getByText('Total Invested')).toBeInTheDocument();
    });
  });

  describe('CSV Export', () => {
    it('should generate correct CSV content', () => {
      const csv = generateComparisonCSV([mockDeal1, mockDeal2]);

      expect(csv).toContain('Metric,Cocoa,Maize');
      expect(csv).toContain('Expected ROI,24.5%,18.0%');
      expect(csv).toContain('Duration,180 days,120 days');
      expect(csv).toContain('Funding progress,50.0%,66.7%');
      expect(csv).toContain('Risk rating,Medium,Low');
      expect(csv).toContain('Commodity,Cocoa,Maize');
      expect(csv).toContain('Total Value,"$50,000","$75,000"');
      expect(csv).toContain('Total Invested,"$25,000","$50,000"');
    });

    it('should handle CSV values with special characters', () => {
      const dealWithComma = { ...mockDeal1, title: 'Deal with, comma' };
      const csv = generateComparisonCSV([dealWithComma]);

      // Should properly escape quotes
      expect(csv).toContain('Cocoa');
    });

    it('should download CSV file on export button click', async () => {
      const user = userEvent.setup();
      const createElementSpy = jest.spyOn(document, 'createElement');
      const clickSpy = jest.fn();

      render(
        <DealComparison
          deals={[mockDeal1, mockDeal2]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      const exportButton = screen.getByText('📥 Export CSV');
      
      // Mock anchor click
      createElementSpy.mockImplementation((tag) => {
        if (tag === 'a') {
          return { click: clickSpy, setAttribute: jest.fn() } as any;
        }
        return document.createElement(tag);
      });

      await user.click(exportButton);

      expect(clickSpy).toHaveBeenCalled();
      createElementSpy.mockRestore();
    });

    it('should include current date in CSV filename', async () => {
      const user = userEvent.setup();
      const setAttributeSpy = jest.fn();
      const createElementSpy = jest.spyOn(document, 'createElement');

      createElementSpy.mockImplementation((tag) => {
        if (tag === 'a') {
          return {
            click: jest.fn(),
            setAttribute: setAttributeSpy,
          } as any;
        }
        return document.createElement(tag);
      });

      render(
        <DealComparison
          deals={[mockDeal1]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      const exportButton = screen.getByText('📥 Export CSV');
      await user.click(exportButton);

      const calls = setAttributeSpy.mock.calls;
      const downloadCall = calls.find((c: any[]) => c[0] === 'download');
      expect(downloadCall).toBeDefined();
      expect(downloadCall[1]).toMatch(/deal-comparison-\d{4}-\d{2}-\d{2}\.csv/);

      createElementSpy.mockRestore();
    });
  });

  describe('Share Link', () => {
    it('should generate correct share URL', () => {
      const baseUrl = 'http://localhost:3000/marketplace';
      const link = generateShareLink(['deal-1', 'deal-2'], baseUrl);

      expect(link).toContain('compare=deal-1%2Cdeal-2');
    });

    it('should copy share link to clipboard', async () => {
      const user = userEvent.setup();
      const writeTextMock = jest.spyOn(navigator.clipboard, 'writeText');

      render(
        <DealComparison
          deals={[mockDeal1, mockDeal2]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      const shareButton = screen.getByText('🔗 Share');
      await user.click(shareButton);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalled();
      });

      writeTextMock.mockRestore();
    });

    it('should show "Copied" feedback after copy', async () => {
      const user = userEvent.setup();
      jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      render(
        <DealComparison
          deals={[mockDeal1, mockDeal2]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      const shareButton = screen.getByText('🔗 Share');
      await user.click(shareButton);

      await waitFor(() => {
        expect(screen.getByText('✓ Copied')).toBeInTheDocument();
      });

      // Should revert to "Share" after 2 seconds
      await waitFor(
        () => {
          expect(screen.getByText('🔗 Share')).toBeInTheDocument();
        },
        { timeout: 2500 }
      );
    });
  });

  describe('localStorage Persistence', () => {
    it('should persist comparison to localStorage on change', async () => {
      const { rerender } = render(
        <DealComparison
          deals={[mockDeal1, mockDeal2]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      await waitFor(() => {
        const stored = localStorage.getItem(COMPARISON_STORAGE_KEY);
        expect(stored).toBe(JSON.stringify(['deal-1', 'deal-2']));
      });
    });

    it('should clear localStorage when comparison is empty', async () => {
      localStorage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(['deal-1']));

      render(
        <DealComparison
          deals={[]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      await waitFor(() => {
        const stored = localStorage.getItem(COMPARISON_STORAGE_KEY);
        expect(stored).toBeNull();
      });
    });

    it('should only store deal IDs, not full objects', async () => {
      render(
        <DealComparison
          deals={[mockDeal1, mockDeal2, mockDeal3]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      await waitFor(() => {
        const stored = localStorage.getItem(COMPARISON_STORAGE_KEY);
        const parsed = JSON.parse(stored!);
        expect(parsed).toEqual(['deal-1', 'deal-2', 'deal-3']);
        // Ensure we're not storing full objects
        expect(typeof parsed[0]).toBe('string');
      });
    });
  });

  describe('Remove and Clear', () => {
    it('should call onRemove when remove button clicked', async () => {
      const user = userEvent.setup();
      const onRemove = jest.fn();

      render(
        <DealComparison
          deals={[mockDeal1, mockDeal2]}
          onRemove={onRemove}
          onClear={jest.fn()}
        />
      );

      const removeButtons = screen.getAllByText('×');
      await user.click(removeButtons[0]);

      expect(onRemove).toHaveBeenCalledWith('deal-1');
    });

    it('should call onClear when clear all button clicked', async () => {
      const user = userEvent.setup();
      const onClear = jest.fn();

      render(
        <DealComparison
          deals={[mockDeal1, mockDeal2]}
          onRemove={jest.fn()}
          onClear={onClear}
        />
      );

      const clearButton = screen.getByText('Clear all');
      await user.click(clearButton);

      expect(onClear).toHaveBeenCalled();
    });
  });

  describe('Deep Linking', () => {
    it('should parse comparison IDs from URL params', () => {
      const ids = parseComparisonParams('deal-1,deal-2,deal-3');
      expect(ids).toEqual(['deal-1', 'deal-2', 'deal-3']);
    });

    it('should parse single comparison ID', () => {
      const ids = parseComparisonParams('deal-1');
      expect(ids).toEqual(['deal-1']);
    });

    it('should handle empty or null comparison params', () => {
      expect(parseComparisonParams('')).toEqual([]);
      expect(parseComparisonParams(null)).toEqual([]);
    });

    it('should trim whitespace in comparison IDs', () => {
      const ids = parseComparisonParams('deal-1 , deal-2 , deal-3');
      expect(ids).toEqual(['deal-1', 'deal-2', 'deal-3']);
    });

    it('should filter out empty IDs', () => {
      const ids = parseComparisonParams('deal-1,,deal-2');
      expect(ids).toEqual(['deal-1', 'deal-2']);
    });
  });

  describe('Value Formatting', () => {
    it('should format ROI correctly', () => {
      render(
        <DealComparison
          deals={[mockDeal1]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      expect(screen.getByText('24.5%')).toBeInTheDocument();
    });

    it('should format duration correctly', () => {
      render(
        <DealComparison
          deals={[mockDeal1]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      expect(screen.getByText('180 days')).toBeInTheDocument();
    });

    it('should format funding progress correctly', () => {
      render(
        <DealComparison
          deals={[mockDeal1]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      // 25000 / 50000 = 50%
      expect(screen.getByText('50.0%')).toBeInTheDocument();
    });

    it('should format currency correctly', () => {
      render(
        <DealComparison
          deals={[mockDeal1]}
          onRemove={jest.fn()}
          onClear={jest.fn()}
        />
      );

      expect(screen.getByText('$50,000')).toBeInTheDocument();
      expect(screen.getByText('$25,000')).toBeInTheDocument();
    });
  });
});
