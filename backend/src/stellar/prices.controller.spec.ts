import { PricesController } from './prices.controller';

describe('PricesController', () => {
  let controller: PricesController;

  beforeEach(() => {
    controller = new PricesController();
  });

  it('returns commodity prices with 24h change calculations', async () => {
    const prices = await controller.getCommoditiesPrices();
    expect(prices).toBeInstanceOf(Array);
    expect(prices.length).toBeGreaterThanOrEqual(4);

    const maize = prices.find((p) => p.symbol === 'MAIZE');
    expect(maize).toBeDefined();
    expect(maize?.priceUsdc).toBeGreaterThan(0);
    expect(typeof maize?.change24h).toBe('number');
  });
});
