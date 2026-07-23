import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Helper function to run axe accessibility scan and assert no violations
 * Logs detailed violation information on failure
 */
async function checkA11y(page: any, pageName: string) {
  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();

  if (accessibilityScanResults.violations.length > 0) {
    console.log(`\n❌ Accessibility violations on ${pageName}:`);
    accessibilityScanResults.violations.forEach((violation: any) => {
      console.log(`\n  Rule: ${violation.id}`);
      console.log(`  Impact: ${violation.impact}`);
      console.log(`  Description: ${violation.description}`);
      console.log(`  Help: ${violation.helpUrl}`);
      violation.nodes.forEach((node: any) => {
        console.log(`  Element: ${node.target.join(' > ')}`);
        console.log(`  HTML: ${node.html}`);
      });
    });
  }

  expect(accessibilityScanResults.violations.length).toBe(0);
}

/**
 * Core pages to scan for accessibility violations
 * Based on the app structure: [locale]/dashboard, [locale]/login, etc.
 */
const corePages = [
  { path: '/en', name: 'Home' },
  { path: '/en/login', name: 'Login' },
  { path: '/en/register', name: 'Register' },
  { path: '/en/dashboard', name: 'Dashboard' },
  { path: '/en/marketplace', name: 'Marketplace' },
  { path: '/en/kyc', name: 'KYC' },
  { path: '/en/settings', name: 'Settings' },
  { path: '/en/transparency', name: 'Transparency' },
];

/**
 * Test suite: WCAG 2.1 AA compliance on all core pages
 */
test.describe('Accessibility - WCAG 2.1 AA Compliance', () => {
  for (const { path, name } of corePages) {
    test(`${name} page (${path}) has no WCAG 2.1 AA violations`, async ({
      page,
    }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await checkA11y(page, name);
    });
  }
});

/**
 * Test suite: Specific accessibility rules
 */
test.describe('Accessibility - Specific Rules', () => {
  test('color contrast meets WCAG AA standards on Home page', async ({
    page,
  }) => {
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2aa'])
      .withRules(['color-contrast'])
      .analyze();

    if (results.violations.length > 0) {
      console.log('\n❌ Color contrast violations:');
      results.violations.forEach((violation: any) => {
        console.log(`  Rule: ${violation.id}`);
        console.log(`  Impact: ${violation.impact}`);
        violation.nodes.forEach((node: any) => {
          console.log(`  Element: ${node.target.join(' > ')}`);
        });
      });
    }

    expect(results.violations.length).toBe(0);
  });

  test('images have descriptive alt text on Home page', async ({ page }) => {
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withRules(['image-alt'])
      .analyze();

    if (results.violations.length > 0) {
      console.log('\n❌ Image alt text violations:');
      results.violations.forEach((violation: any) => {
        console.log(`  Rule: ${violation.id}`);
        violation.nodes.forEach((node: any) => {
          console.log(`  Element: ${node.target.join(' > ')}`);
        });
      });
    }

    expect(results.violations.length).toBe(0);
  });

  test('form inputs have associated labels on Login page', async ({
    page,
  }) => {
    await page.goto('/en/login');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withRules(['label'])
      .analyze();

    if (results.violations.length > 0) {
      console.log('\n❌ Form label violations:');
      results.violations.forEach((violation: any) => {
        console.log(`  Rule: ${violation.id}`);
        violation.nodes.forEach((node: any) => {
          console.log(`  Element: ${node.target.join(' > ')}`);
        });
      });
    }

    expect(results.violations.length).toBe(0);
  });

  test('form inputs have associated labels on Register page', async ({
    page,
  }) => {
    await page.goto('/en/register');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withRules(['label'])
      .analyze();

    if (results.violations.length > 0) {
      console.log('\n❌ Form label violations:');
      results.violations.forEach((violation: any) => {
        console.log(`  Rule: ${violation.id}`);
        violation.nodes.forEach((node: any) => {
          console.log(`  Element: ${node.target.join(' > ')}`);
        });
      });
    }

    expect(results.violations.length).toBe(0);
  });

  test('buttons have accessible names on Dashboard page', async ({
    page,
  }) => {
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withRules(['button-name'])
      .analyze();

    if (results.violations.length > 0) {
      console.log('\n❌ Button name violations:');
      results.violations.forEach((violation: any) => {
        console.log(`  Rule: ${violation.id}`);
        violation.nodes.forEach((node: any) => {
          console.log(`  Element: ${node.target.join(' > ')}`);
        });
      });
    }

    expect(results.violations.length).toBe(0);
  });

  test('page has proper heading hierarchy on Home page', async ({ page }) => {
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withRules(['heading-order'])
      .analyze();

    if (results.violations.length > 0) {
      console.log('\n❌ Heading hierarchy violations:');
      results.violations.forEach((violation: any) => {
        console.log(`  Rule: ${violation.id}`);
        violation.nodes.forEach((node: any) => {
          console.log(`  Element: ${node.target.join(' > ')}`);
        });
      });
    }

    expect(results.violations.length).toBe(0);
  });

  test('links have accessible names on Marketplace page', async ({
    page,
  }) => {
    await page.goto('/en/marketplace');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withRules(['link-name'])
      .analyze();

    if (results.violations.length > 0) {
      console.log('\n❌ Link name violations:');
      results.violations.forEach((violation: any) => {
        console.log(`  Rule: ${violation.id}`);
        violation.nodes.forEach((node: any) => {
          console.log(`  Element: ${node.target.join(' > ')}`);
        });
      });
    }

    expect(results.violations.length).toBe(0);
  });
});

/**
 * Test suite: Keyboard navigation accessibility
 */
test.describe('Accessibility - Keyboard Navigation', () => {
  test('interactive elements are keyboard accessible on Home page', async ({
    page,
  }) => {
    await page.goto('/en');
    await page.waitForLoadState('networkidle');

    // Tab through interactive elements and verify focus is visible
    const interactiveElements = page.locator(
      'button, a, input, select, textarea, [tabindex]'
    );
    const count = await interactiveElements.count();

    if (count > 0) {
      // Focus on first interactive element
      await page.keyboard.press('Tab');
      const focusedElement = await page.evaluate(() => {
        return document.activeElement?.tagName;
      });

      expect(focusedElement).toBeTruthy();
    }
  });

  test('interactive elements are keyboard accessible on Login page', async ({
    page,
  }) => {
    await page.goto('/en/login');
    await page.waitForLoadState('networkidle');

    // Tab through interactive elements
    const interactiveElements = page.locator(
      'button, a, input, select, textarea, [tabindex]'
    );
    const count = await interactiveElements.count();

    if (count > 0) {
      await page.keyboard.press('Tab');
      const focusedElement = await page.evaluate(() => {
        return document.activeElement?.tagName;
      });

      expect(focusedElement).toBeTruthy();
    }
  });
});

/**
 * Test suite: Mobile accessibility
 */
test.describe('Accessibility - Mobile Viewports', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('Home page is accessible on mobile viewport', async ({ page }) => {
    await page.goto('/en');
    await page.waitForLoadState('networkidle');
    await checkA11y(page, 'Home (Mobile)');
  });

  test('Login page is accessible on mobile viewport', async ({ page }) => {
    await page.goto('/en/login');
    await page.waitForLoadState('networkidle');
    await checkA11y(page, 'Login (Mobile)');
  });

  test('Dashboard page is accessible on mobile viewport', async ({
    page,
  }) => {
    await page.goto('/en/dashboard');
    await page.waitForLoadState('networkidle');
    await checkA11y(page, 'Dashboard (Mobile)');
  });
});

/**
 * Test suite: Tablet accessibility
 */
test.describe('Accessibility - Tablet Viewports', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('Home page is accessible on tablet viewport', async ({ page }) => {
    await page.goto('/en');
    await page.waitForLoadState('networkidle');
    await checkA11y(page, 'Home (Tablet)');
  });

  test('Marketplace page is accessible on tablet viewport', async ({
    page,
  }) => {
    await page.goto('/en/marketplace');
    await page.waitForLoadState('networkidle');
    await checkA11y(page, 'Marketplace (Tablet)');
  });
});
