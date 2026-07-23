import { generateMetadata } from './page';

jest.mock('@/lib/api', () => ({
  getDealById: jest.fn(),
}));

import { getDealById } from '@/lib/api';

const mockDeal = {
  id: 'deal-1',
  commodity: 'wheat',
  total_value: '100000',
  total_invested: '50000',
  status: 'active',
  seller: 'Test Farm Ltd',
  description: 'Premium wheat from the Northern Plains',
};

describe('generateMetadata — marketplace deal page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns title and description for a valid deal', async () => {
    (getDealById as jest.Mock).mockResolvedValue(mockDeal);

    const metadata = await generateMetadata({
      params: { id: 'deal-1', locale: 'en' },
    });

    expect(metadata.title).toBeDefined();
    expect(typeof metadata.title === 'string' ? metadata.title : '').toContain('Wheat');
    expect(metadata.description).toBeDefined();
  });

  it('returns fallback title when deal is not found', async () => {
    (getDealById as jest.Mock).mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: { id: 'nonexistent', locale: 'en' },
    });

    const title =
      typeof metadata.title === 'string'
        ? metadata.title
        : (metadata.title as any)?.default ?? '';
    expect(title).toMatch(/not found/i);
  });

  it('returns fallback title when API throws', async () => {
    (getDealById as jest.Mock).mockRejectedValue(new Error('Network error'));

    const metadata = await generateMetadata({
      params: { id: 'error-id', locale: 'en' },
    });

    expect(metadata.title).toBeDefined();
  });

  it('includes openGraph data when deal exists', async () => {
    (getDealById as jest.Mock).mockResolvedValue(mockDeal);

    const metadata = await generateMetadata({
      params: { id: 'deal-1', locale: 'en' },
    });

    expect(metadata.openGraph).toBeDefined();
    expect(metadata.openGraph?.title).toBeDefined();
  });

  it('capitalises the commodity name in the title', async () => {
    (getDealById as jest.Mock).mockResolvedValue({ ...mockDeal, commodity: 'rice' });

    const metadata = await generateMetadata({
      params: { id: 'deal-2', locale: 'en' },
    });

    const title =
      typeof metadata.title === 'string'
        ? metadata.title
        : (metadata.title as any)?.default ?? '';
    expect(title).toMatch(/Rice/);
  });
});
