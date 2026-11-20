import { SearchService } from './search.service';

describe('SearchService', () => {
  let service: SearchService;
  let dataSource: { query: jest.Mock };

  beforeEach(() => {
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    service = new SearchService(dataSource as any);
  });

  describe('buildTsQuery', () => {
    it('tokenizes and joins with prefix matching', () => {
      expect(service.buildTsQuery('maize kenya')).toBe('maize:* & kenya:*');
    });

    it('strips special characters', () => {
      expect(service.buildTsQuery('maize! @kenya')).toBe('maize:* & kenya:*');
    });

    it('throws on empty input', () => {
      expect(() => service.buildTsQuery('   ')).toThrow('Invalid search query');
    });
  });

  describe('search', () => {
    it('returns grouped results with snippets and scores', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          {
            id: 'deal-1',
            title: 'Maize Kenya',
            commodity: 'Maize',
            status: 'open',
            score: '0.85',
            snippet: 'Premium <b>Maize</b> from Kenya',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'farmer-1',
            title: 'John Farmer',
            email: 'john@farm.com',
            role: 'farmer',
            score: '0.72',
            snippet: '<b>John</b> Farmer',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'doc-1',
            title: 'Harvest Report',
            doc_type: 'harvest_completion',
            trade_deal_id: 'deal-1',
            score: '0.65',
            snippet: '<b>Harvest</b> completion certificate',
          },
        ]);

      const result = await service.search(
        'maize kenya',
        ['deals', 'farmers', 'documents'],
        10,
      );

      expect(result.deals).toHaveLength(1);
      expect(result.deals[0].score).toBeCloseTo(0.85);
      expect(result.deals[0].snippet).toContain('<b>Maize</b>');
      expect(result.farmers).toHaveLength(1);
      expect(result.documents).toHaveLength(1);
    });

    it('does not select or return farmer email addresses', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          id: 'farmer-1',
          title: 'John Farmer',
          email: 'john@farm.com',
          role: 'farmer',
          score: '0.72',
          snippet: '',
        },
      ]);

      const result = await service.search('john', ['farmers'], 5);

      const sql = dataSource.query.mock.calls[0][0] as string;
      expect(sql).not.toMatch(/u\.email/);

      expect(result.farmers).toHaveLength(1);
      const farmer = result.farmers[0];
      expect(farmer.metadata).toEqual({ role: 'farmer' });
      expect(JSON.stringify(farmer)).not.toContain('john@farm.com');
      expect(farmer.snippet).toBe('John Farmer');
    });

    it('rejects queries shorter than 2 characters', async () => {
      await expect(service.search('a')).rejects.toThrow(
        'Search query must be at least 2 characters',
      );
    });

    it('respects type filter', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          id: 'd1',
          title: 'Deal',
          commodity: 'Maize',
          status: 'open',
          score: '0.5',
          snippet: 'Maize',
        },
      ]);

      const result = await service.search('maize', ['deals'], 5);
      expect(result.deals).toHaveLength(1);
      expect(result.farmers).toHaveLength(0);
      expect(result.documents).toHaveLength(0);
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });
  });
});
