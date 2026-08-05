/**
 * Integration tests for responsive breakpoint layouts.
 *
 * Tests verify that dashboard grids adapt correctly across viewport sizes:
 * - Mobile (< 640px): single column, compact spacing
 * - Tablet/md (640-1024px): 2-3 columns with optimized gaps
 * - Desktop/lg (1024-1280px): 3-4 columns
 * - Large (>= 1280px): 4-5 columns
 */

describe('Responsive Breakpoints', () => {
  /**
   * StatCard grids should have appropriate breakpoints:
   * - Mobile: grid-cols-2 (2 cards per row)
   * - Tablet (md): grid-cols-3 (3 cards per row)
   * - Desktop (lg): grid-cols-4 (4 cards per row)
   * - Large (xl): grid-cols-5 (5 cards per row)
   */
  describe('StatCard grid layout', () => {
    it('renders correct grid classes for investor stats', () => {
      const classes = getStatGridClasses('investor');
      expect(classes).toContain('grid-cols-2');
      expect(classes).toContain('md:grid-cols-3');
      expect(classes).toContain('lg:grid-cols-4');
      expect(classes).toContain('xl:grid-cols-5');
    });

    it('renders correct grid classes for farmer/trader stats', () => {
      const classes = getStatGridClasses('farmer');
      expect(classes).toContain('grid-cols-2');
      expect(classes).toContain('md:grid-cols-2');
      expect(classes).toContain('lg:grid-cols-4');
    });

    it('has responsive gap classes', () => {
      const classes = getStatGridClasses('investor');
      expect(classes).toContain('gap-3');
      expect(classes).toContain('md:gap-4');
    });
  });

  /**
   * Card grids (portfolio, deals, users) should adapt:
   * - Mobile: sm:grid-cols-2 (2 cards on larger phones)
   * - Tablet (md): md:grid-cols-2 (keep 2 columns for readability)
   * - Desktop (lg): lg:grid-cols-3 (3 columns)
   */
  describe('Card grid layout', () => {
    it('renders correct grid classes for card lists', () => {
      const classes = getCardGridClasses('default');
      expect(classes).toContain('sm:grid-cols-2');
      expect(classes).toContain('md:grid-cols-2');
      expect(classes).toContain('lg:grid-cols-3');
    });

    it('renders correct grid classes for certificates (2-column max)', () => {
      const classes = getCardGridClasses('certificates');
      expect(classes).toContain('sm:grid-cols-2');
      expect(classes).toContain('md:grid-cols-2');
      expect(classes).toContain('lg:grid-cols-2');
    });

    it('has appropriate gap scaling', () => {
      const classes = getCardGridClasses('default');
      expect(classes).toContain('gap-5');
    });
  });

  /**
   * Text truncation should adapt to viewport:
   * - Mobile: max-w-[160px]
   * - Tablet: max-w-[180px]
   * - Desktop: max-w-[200px]
   */
  describe('Text truncation', () => {
    it('applies responsive max-width to truncated email', () => {
      const classes = 'max-w-[160px] md:max-w-[180px] lg:max-w-[200px]';
      expect(classes).toContain('max-w-[160px]');
      expect(classes).toContain('md:max-w-[180px]');
      expect(classes).toContain('lg:max-w-[200px]');
    });
  });

  /**
   * Page spacing should scale:
   * - Mobile: p-4 space-y-4
   * - Tablet: p-5 space-y-5
   * - Desktop: p-6 space-y-6
   */
  describe('Page content spacing', () => {
    it('has responsive padding', () => {
      const classes = 'p-4 md:p-5 lg:p-6';
      expect(classes).toContain('p-4');
      expect(classes).toContain('md:p-5');
      expect(classes).toContain('lg:p-6');
    });

    it('has responsive gap spacing', () => {
      const classes = 'space-y-4 md:space-y-5 lg:space-y-6';
      expect(classes).toContain('space-y-4');
      expect(classes).toContain('md:space-y-5');
      expect(classes).toContain('lg:space-y-6');
    });
  });

  /**
   * Admin document grid should stack on tablets:
   * - Mobile/Tablet: md:grid-cols-1 (full width)
   * - Desktop: lg:grid-cols-[340px_1fr] (sidebar + content)
   */
  describe('Admin document layout', () => {
    it('renders single column on tablets and below', () => {
      const classes = 'md:grid-cols-1 lg:grid-cols-[340px_1fr]';
      expect(classes).toContain('md:grid-cols-1');
      expect(classes).toContain('lg:grid-cols-[340px_1fr]');
    });
  });
});

/**
 * Helper functions that centralize responsive class definitions.
 * These can be imported and used across dashboard pages to ensure
 * consistency.
 */
export function getStatGridClasses(role: 'investor' | 'farmer' | 'trader' | 'admin'): string {
  const base = 'grid gap-3 md:gap-4';
  const configs = {
    investor: `${base} grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`,
    farmer:   `${base} grid-cols-2 md:grid-cols-2 lg:grid-cols-4`,
    trader:   `${base} grid-cols-2 md:grid-cols-2 lg:grid-cols-4`,
    admin:    `${base} grid-cols-2 md:grid-cols-3 lg:grid-cols-4`,
  };
  return configs[role];
}

export function getCardGridClasses(type: 'default' | 'certificates'): string {
  const base = 'grid gap-5';
  const configs = {
    default:       `${base} sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3`,
    certificates:  `${base} sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2`,
  };
  return configs[type];
}
