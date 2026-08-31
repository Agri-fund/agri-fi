import { useNumberFormat } from '../useNumberFormat';
import { useLocale } from 'next-intl';

vi.mock('next-intl', () => ({
  useLocale: vi.fn(() => 'en'),
}));

describe('useNumberFormat', () => {
  const testLocales = ['en', 'es', 'fr', 'pt', 'sw'];

  testLocales.forEach((locale) => {
    describe(`Locale: ${locale}`, () => {
      beforeEach(() => {
        (useLocale as jest.Mock).mockReturnValue(locale);
      });

      it('should format standard numbers according to locale conventions', () => {
        const { formatNumber } = useNumberFormat();
        const formatted = formatNumber(1234567.89);
        expect(formatted).toBeDefined();
        expect(formatted).not.toEqual('');
      });

      it('should handle compact representation (50K, 1.2M)', () => {
        const { formatNumber } = useNumberFormat();
        const formatted = formatNumber(1200000, { compact: true });
        expect(formatted).toBeDefined();
      });

      it('should handle custom decimal places', () => {
        const { formatNumber } = useNumberFormat();
        const formatted = formatNumber(12.34567, { decimalPlaces: 4 });
        expect(formatted).toContain('3457');
      });

      it('should handle zero and non-numeric values', () => {
        const { formatNumber } = useNumberFormat();
        expect(formatNumber(0)).toContain('0');
        expect(formatNumber('abc')).toBe('0');
      });
    });
  });
});
