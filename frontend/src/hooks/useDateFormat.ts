import { useLocale } from 'next-intl';

export function useDateFormat() {
  const localeFromHook = useLocale();
  const locale = localeFromHook ?? 'en';

  const formatDate = (
    date: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ): string => {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(locale, options ?? { dateStyle: 'medium' }).format(d);
  };

  return { formatDate };
}
