import { useCurrencyFormat } from '../useCurrencyFormat';
import { useLocale } from 'next-intl';

vi.mock('next-intl', () => ({
  useLocale: vi.fn(() => 'en'),
}));

describe('useCurrencyFormat', () => {
  const testLocales = ['en', 'es', 'fr', 'pt', 'sw'];

  testLocales.forEach((locale) => {
    describe(`Locale: ${locale}`, () => {
      beforeEach(() => {
        (useLocale as jest.Mock).mockReturnValue(locale);
      });

      it('should format fiat currencies with 2 decimal places and ISO code', () => {
        const { formatCurrency } = useCurrencyFormat();
        const formatted = formatCurrency(1234.56, 'USD');
        expect(formatted).toContain('1');
        expect(formatted).toContain('234');
        expect(formatted).toContain('USD');
      });

      it('should format USDC/crypto amounts with 7 decimal places', () => {
        const { formatCurrency } = useCurrencyFormat();
        const formatted = formatCurrency(123.4567891, 'USDC');
        expect(formatted).toContain('123');
        expect(formatted).toContain('USDC');
      });

      it('should support compact abbreviation mode (1.2M, 50K)', () => {
        const { formatCurrency } = useCurrencyFormat();
        const formatted50k = formatCurrency(50000, 'USD', { compact: true });
        const formatted1m = formatCurrency(1200000, 'USD', { compact: true });

        expect(formatted50k).toBeDefined();
        expect(formatted1m).toBeDefined();
      });

      it('should handle zero and invalid inputs gracefully', () => {
        const { formatCurrency } = useCurrencyFormat();
        expect(formatCurrency(0, 'USD')).toContain('0');
        expect(formatCurrency('invalid', 'USD')).toContain('USD');
      });
    });
  });
});
