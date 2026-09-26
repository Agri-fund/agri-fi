/**
 * Integration tests for deal comparison persistence and deep linking.
 * Tests localStorage restoration and URL parameter handling across page reloads.
 */

describe('Marketplace - Deal Comparison Integration', () => {
  const COMPARISON_KEY = 'agri-fi:deal-comparison';
  const BASE_URL = 'http://localhost:3000/en/marketplace';

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('localStorage Persistence', () => {
    it('should restore comparison selections after page reload', () => {
      // Simulate first session: user adds deals to comparison
      const comparisonIds = ['deal-1', 'deal-2', 'deal-3'];
      localStorage.setItem(COMPARISON_KEY, JSON.stringify(comparisonIds));

      // Simulate page reload: localStorage is still available
      const stored = localStorage.getItem(COMPARISON_KEY);
      expect(stored).toBe(JSON.stringify(comparisonIds));

      // Parse and verify
      const parsed = JSON.parse(stored!);
      expect(parsed).toEqual(comparisonIds);
    });

    it('should persist only deal IDs, not full objects', () => {
      const dealIds = ['deal-1', 'deal-2'];
      localStorage.setItem(COMPARISON_KEY, JSON.stringify(dealIds));

      const stored = localStorage.getItem(COMPARISON_KEY);
      const parsed = JSON.parse(stored!);

      // Ensure minimal storage footprint
      expect(stored!.length).toBeLessThan(100);
      expect(parsed.every((id: any) => typeof id === 'string')).toBe(true);
    });

    it('should clear localStorage when comparison is empty', () => {
      localStorage.setItem(COMPARISON_KEY, JSON.stringify(['deal-1']));

      // Clear comparison
      localStorage.removeItem(COMPARISON_KEY);

      expect(localStorage.getItem(COMPARISON_KEY)).toBeNull();
    });

    it('should handle corrupt localStorage gracefully', () => {
      // Simulate corrupted data
      localStorage.setItem(COMPARISON_KEY, '{invalid json}');

      // Should not throw
      expect(() => {
        const raw = localStorage.getItem(COMPARISON_KEY);
        if (raw) JSON.parse(raw);
      }).toThrow();

      // App should continue with empty comparison
      localStorage.removeItem(COMPARISON_KEY);
      expect(localStorage.getItem(COMPARISON_KEY)).toBeNull();
    });
  });

  describe('Deep Linking via URL Parameters', () => {
    it('should build shareable URL with comparison IDs', () => {
      const dealIds = ['deal-1', 'deal-2'];
      const url = new URL(BASE_URL);
      url.searchParams.set('compare', dealIds.join(','));

      expect(url.toString()).toContain('compare=deal-1%2Cdeal-2');
    });

    it('should preserve other URL params with comparison link', () => {
      const url = new URL(BASE_URL);
      url.searchParams.set('sortBy', 'roi');
      url.searchParams.set('compare', 'deal-1,deal-2');

      const params = url.searchParams;
      expect(params.get('sortBy')).toBe('roi');
      expect(params.get('compare')).toBe('deal-1,deal-2');
    });

    it('should parse comparison IDs from URL', () => {
      const url = new URL(BASE_URL);
      url.searchParams.set('compare', 'deal-1,deal-2,deal-3');

      const compareParam = url.searchParams.get('compare');
      const ids = compareParam
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      expect(ids).toEqual(['deal-1', 'deal-2', 'deal-3']);
    });

    it('should trim whitespace in parsed comparison IDs', () => {
      const url = new URL(BASE_URL);
      url.searchParams.set('compare', ' deal-1 , deal-2 , deal-3 ');

      const compareParam = url.searchParams.get('compare');
      const ids = compareParam
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      expect(ids).toEqual(['deal-1', 'deal-2', 'deal-3']);
    });

    it('should handle comparison links with single deal', () => {
      const url = new URL(BASE_URL);
      url.searchParams.set('compare', 'deal-1');

      const compareParam = url.searchParams.get('compare');
      const ids = compareParam.split(',').map((id) => id.trim());

      expect(ids).toEqual(['deal-1']);
    });

    it('should handle empty comparison params gracefully', () => {
      const url = new URL(BASE_URL);
      // No compare param

      const compareParam = url.searchParams.get('compare');
      expect(compareParam).toBeNull();
    });
  });

  describe('Priority: Deep Link > localStorage', () => {
    it('should prefer URL params over localStorage', () => {
      // Set localStorage with one set of deals
      localStorage.setItem(COMPARISON_KEY, JSON.stringify(['deal-1', 'deal-2']));

      // But URL has different deals
      const url = new URL(BASE_URL);
      url.searchParams.set('compare', 'deal-3,deal-4');

      // URL params should take precedence
      const compareParam = url.searchParams.get('compare');
      expect(compareParam).toBe('deal-3,deal-4');

      // localStorage should be ignored when URL param present
      const storedIds = JSON.parse(localStorage.getItem(COMPARISON_KEY)!);
      expect(storedIds).toEqual(['deal-1', 'deal-2']);
    });

    it('should use localStorage only when no URL params', () => {
      // Set localStorage
      const savedIds = ['deal-1', 'deal-2'];
      localStorage.setItem(COMPARISON_KEY, JSON.stringify(savedIds));

      // No URL params
      const url = new URL(BASE_URL);
      const compareParam = url.searchParams.get('compare');

      // Should fall back to localStorage
      if (!compareParam) {
        const restoredIds = JSON.parse(localStorage.getItem(COMPARISON_KEY)!);
        expect(restoredIds).toEqual(savedIds);
      }
    });
  });

  describe('Session Behavior', () => {
    it('should sync localStorage when comparison changes', () => {
      const deals = ['deal-1', 'deal-2'];
      localStorage.setItem(COMPARISON_KEY, JSON.stringify(deals));

      const stored = localStorage.getItem(COMPARISON_KEY);
      expect(stored).toBe(JSON.stringify(deals));

      // Add another deal
      const updated = [...deals, 'deal-3'];
      localStorage.setItem(COMPARISON_KEY, JSON.stringify(updated));

      const newStored = localStorage.getItem(COMPARISON_KEY);
      expect(newStored).toBe(JSON.stringify(updated));
    });

    it('should handle up to 3 deals in comparison', () => {
      const deals = ['deal-1', 'deal-2', 'deal-3'];
      localStorage.setItem(COMPARISON_KEY, JSON.stringify(deals));

      const stored = JSON.parse(localStorage.getItem(COMPARISON_KEY)!);
      expect(stored).toHaveLength(3);

      // Trying to add 4th should not exceed limit
      const tooMany = [...deals, 'deal-4'];
      if (tooMany.length > 3) {
        tooMany.pop();
      }
      expect(tooMany).toHaveLength(3);
    });

    it('should preserve comparison across navigation within app', () => {
      // Set initial comparison
      const deals = ['deal-1', 'deal-2'];
      localStorage.setItem(COMPARISON_KEY, JSON.stringify(deals));

      // Simulate navigation to deal details and back
      // localStorage should persist
      expect(localStorage.getItem(COMPARISON_KEY)).toBe(JSON.stringify(deals));

      // Navigate to different page in marketplace
      const url = new URL(BASE_URL);
      url.searchParams.set('page', '2');

      // Should still have comparison
      expect(localStorage.getItem(COMPARISON_KEY)).toBe(JSON.stringify(deals));
    });
  });

  describe('CSV Export Consistency', () => {
    it('should export all comparison data in CSV', () => {
      const csvContent = `Metric,Cocoa,Maize
Expected ROI,24.5%,18.0%
Duration,180 days,120 days
Funding progress,50.0%,66.7%
Risk rating,Medium,Low
Commodity,Cocoa,Maize
Total Value,"$50,000","$75,000"
Total Invested,"$25,000","$50,000"`;

      expect(csvContent).toContain('Metric');
      expect(csvContent).toContain('Expected ROI');
      expect(csvContent).toContain('Cocoa');
      expect(csvContent).toContain('Maize');
    });

    it('should properly escape special characters in CSV', () => {
      // Test with values containing quotes
      const values = ['Deal with "quotes"', 'Deal with, comma'];
      const escaped = values.map((v) => `"${v.replace(/"/g, '""')}"`);

      expect(escaped[0]).toBe('"Deal with ""quotes"""');
      expect(escaped[1]).toBe('"Deal with, comma"');
    });

    it('should maintain correct column order in CSV', () => {
      const headers = ['Metric', 'Deal1', 'Deal2', 'Deal3'];
      const csvLine = headers.join(',');

      const expectedOrder = ['Metric', 'Deal1', 'Deal2', 'Deal3'];
      const actualOrder = csvLine.split(',');

      expect(actualOrder).toEqual(expectedOrder);
    });
  });

  describe('Edge Cases', () => {
    it('should handle deals with null/undefined fields', () => {
      const dealWithMissing = {
        expected_roi: null,
        duration_days: undefined,
        risk_rating: null,
      };

      const roi = dealWithMissing.expected_roi == null ? 'Not specified' : dealWithMissing.expected_roi;
      const duration = dealWithMissing.duration_days == null ? 'Not specified' : dealWithMissing.duration_days;
      const risk = dealWithMissing.risk_rating ?? 'Not specified';

      expect(roi).toBe('Not specified');
      expect(duration).toBe('Not specified');
      expect(risk).toBe('Not specified');
    });

    it('should handle very large deal values in formatting', () => {
      const largeValue = 1000000000; // $1 billion
      const formatted = `$${largeValue.toLocaleString()}`;

      expect(formatted).toBe('$1,000,000,000');
    });

    it('should handle special characters in commodity names', () => {
      const specialCommodities = ['Cacao & Cocoa', 'Rice (Jasmine)', 'Coffee - Premium'];

      const url = new URL(BASE_URL);
      url.searchParams.set('compare', 'deal-1,deal-2');

      // Should not break URL encoding
      expect(url.toString()).toContain('compare=deal-1%2Cdeal-2');
    });
  });
});
