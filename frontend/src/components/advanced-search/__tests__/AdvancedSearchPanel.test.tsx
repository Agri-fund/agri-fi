import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdvancedSearchPanel from '@/components/advanced-search/AdvancedSearchPanel';
import { SAMPLE_DEALS } from '@/lib/advanced-search/sample-deals';

describe('AdvancedSearchPanel (#1183)', () => {
  beforeEach(() => localStorage.clear());

  it('searches, renders ranked results with explanations, then narrows via facets', async () => {
    const user = userEvent.setup();
    render(<AdvancedSearchPanel deals={SAMPLE_DEALS} />);

    // Full result set loads from the injected deal source.
    await waitFor(() => {
      expect(screen.getAllByRole('article').length).toBe(SAMPLE_DEALS.length);
    });

    // Type a natural-language query; the bar reflects the parsed interpretation.
    const input = screen.getByRole('combobox', { name: /advanced natural-language search/i });
    await user.type(input, 'africa');

    let before = 0;
    await waitFor(() => {
      before = screen.getAllByRole('article').length;
      expect(before).toBeLessThan(SAMPLE_DEALS.length);
      expect(before).toBeGreaterThan(3);
    });
    expect(screen.getAllByText(/Region matches 'africa'/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Interpreted as/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Relevance/i).length).toBeGreaterThan(0);

    // Refine tab: toggle a commodity facet, then confirm Results narrowed down.
    await user.click(screen.getByRole('tab', { name: 'Refine' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Cocoa' }));
    await user.click(screen.getByRole('tab', { name: 'Results' }));

    await waitFor(() => {
      const after = screen.getAllByRole('article').length;
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThan(0);
    });
    // Builds the embedding index twice (initial + queried) and drives a debounced
    // combobox, so it exceeds vitest's 5s default when suites run in parallel.
  }, 20_000);

  it('shows a friendly zero-state for an impossible query', async () => {
    const user = userEvent.setup();
    render(<AdvancedSearchPanel deals={SAMPLE_DEALS} />);
    const input = screen.getByRole('combobox', { name: /advanced natural-language search/i });
    await user.type(input, 'cocoa in Brazil');

    await waitFor(() => {
      expect(screen.getByText(/No deals matched/i)).toBeInTheDocument();
    });
  });
});
