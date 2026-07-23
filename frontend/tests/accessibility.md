# Accessibility Testing Guide

This document explains how to run, interpret, and maintain automated accessibility tests using axe-core integrated with Playwright.

## Overview

The accessibility test suite (`accessibility.spec.ts`) uses **@axe-core/playwright** to automatically scan all core frontend pages for WCAG 2.1 AA compliance violations. Tests run on multiple browsers and viewports to ensure comprehensive coverage.

### What is WCAG 2.1 AA?

**WCAG 2.1** (Web Content Accessibility Guidelines) is the W3C standard for web accessibility. **AA** is the mid-level conformance level that most organizations aim for. It includes:

- **Perceivable**: Content must be perceivable to users (text alternatives, adaptable content, distinguishable)
- **Operable**: Users must be able to navigate and operate the interface (keyboard accessible, enough time, seizure prevention)
- **Understandable**: Content and interface must be understandable (readable, predictable, input assistance)
- **Robust**: Content must work with assistive technologies (compatible with screen readers, etc.)

## Running Accessibility Tests

### Prerequisites

1. Ensure dependencies are installed:
   ```bash
   npm install
   ```

2. Ensure the frontend dev server can run:
   ```bash
   npm run dev
   ```

### Run All Accessibility Tests

```bash
npm run test:a11y
```

This runs all accessibility tests in headless mode across Chromium, Firefox, and WebKit browsers.

### Run Tests with HTML Report

```bash
npm run test:a11y:report
```

This generates an interactive HTML report in `playwright-report/index.html` that you can open in your browser.

### Run Tests in Headed Mode (See Browser)

```bash
npx playwright test frontend/tests/accessibility.spec.ts --headed
```

### Run Tests for a Specific Page

```bash
npx playwright test -g "Login page"
```

### Run Tests for a Specific Browser

```bash
npx playwright test --project=chromium
```

### Run Tests in Debug Mode

```bash
npx playwright test --debug
```

## Understanding Test Results

### Passing Tests ✅

All tests pass when:
- No WCAG 2.1 AA violations are found
- All interactive elements are keyboard accessible
- All pages render correctly on mobile and tablet viewports

### Failing Tests ❌

Tests fail when violations are detected. The console output shows:

```
❌ Accessibility violations on Login:

  Rule: color-contrast
  Impact: serious
  Description: Ensures the contrast between foreground and background colors meets WCAG AA standards
  Help: https://dequeuniversity.com/rules/axe/4.8/color-contrast
  Element: button.submit-btn
  HTML: <button class="submit-btn">Submit</button>
```

### Key Violation Information

- **Rule**: The specific accessibility rule that failed (e.g., `color-contrast`, `image-alt`, `label`)
- **Impact**: Severity level (`critical`, `serious`, `moderate`, `minor`)
- **Description**: What the rule checks
- **Help URL**: Link to detailed explanation and fix guidance
- **Element**: CSS selector path to the problematic element
- **HTML**: The actual HTML of the element

## Common WCAG 2.1 AA Violations and Fixes

### 1. Color Contrast (`color-contrast`)

**Problem**: Text doesn't have enough contrast against its background.

**WCAG Requirement**: Contrast ratio of at least 4.5:1 for normal text, 3:1 for large text.

**Fix**:
```css
/* ❌ Bad: Low contrast */
.text {
  color: #999;
  background: #f5f5f5;
}

/* ✅ Good: High contrast */
.text {
  color: #333;
  background: #f5f5f5;
}
```

Use tools like [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) to verify.

### 2. Missing Alt Text (`image-alt`)

**Problem**: Images don't have descriptive alt text.

**WCAG Requirement**: All images must have alt text (can be empty for decorative images).

**Fix**:
```jsx
/* ❌ Bad: No alt text */
<img src="farm.jpg" />

/* ✅ Good: Descriptive alt text */
<img src="farm.jpg" alt="Farmer harvesting crops in the field" />

/* ✅ Good: Decorative image with empty alt */
<img src="divider.png" alt="" aria-hidden="true" />
```

### 3. Missing Form Labels (`label`)

**Problem**: Form inputs don't have associated labels.

**WCAG Requirement**: All form inputs must have labels.

**Fix**:
```jsx
/* ❌ Bad: No label */
<input type="email" placeholder="Email" />

/* ✅ Good: Associated label */
<label htmlFor="email">Email</label>
<input id="email" type="email" />

/* ✅ Good: Implicit label */
<label>
  Email
  <input type="email" />
</label>
```

### 4. Missing Button Names (`button-name`)

**Problem**: Buttons don't have accessible names.

**WCAG Requirement**: All buttons must have visible text or aria-label.

**Fix**:
```jsx
/* ❌ Bad: Icon button with no label */
<button>🔍</button>

/* ✅ Good: Icon button with aria-label */
<button aria-label="Search">🔍</button>

/* ✅ Good: Button with text */
<button>Search</button>
```

### 5. Heading Hierarchy (`heading-order`)

**Problem**: Headings don't follow a logical order (e.g., h1 → h3, skipping h2).

**WCAG Requirement**: Headings should follow a logical hierarchy.

**Fix**:
```jsx
/* ❌ Bad: Skipped heading level */
<h1>Main Title</h1>
<h3>Subsection</h3>

/* ✅ Good: Proper hierarchy */
<h1>Main Title</h1>
<h2>Subsection</h2>
<h3>Sub-subsection</h3>
```

### 6. Missing Link Names (`link-name`)

**Problem**: Links don't have descriptive text.

**WCAG Requirement**: All links must have accessible names.

**Fix**:
```jsx
/* ❌ Bad: Generic link text */
<a href="/deals">Click here</a>

/* ✅ Good: Descriptive link text */
<a href="/deals">View available deals</a>

/* ✅ Good: Icon link with aria-label */
<a href="/settings" aria-label="Settings">⚙️</a>
```

## Pages Covered by Tests

The accessibility test suite covers these core pages:

| Page | Path | Purpose |
|------|------|---------|
| Home | `/en` | Landing page |
| Login | `/en/login` | User authentication |
| Register | `/en/register` | User registration |
| Dashboard | `/en/dashboard` | Main user dashboard |
| Marketplace | `/en/marketplace` | Browse and view deals |
| KYC | `/en/kyc` | Know Your Customer verification |
| Settings | `/en/settings` | User settings and preferences |
| Transparency | `/en/transparency` | Transparency information |

## Test Coverage

### Browsers Tested
- Chromium (Chrome/Edge)
- Firefox
- WebKit (Safari)

### Viewports Tested
- Desktop (1920x1080)
- Tablet (768x1024)
- Mobile (375x667)

### Accessibility Rules Tested

**WCAG 2.1 AA Tags**: `wcag2a`, `wcag2aa`, `wcag21aa`

**Specific Rules**:
- `color-contrast`: Text contrast meets WCAG AA standards
- `image-alt`: Images have descriptive alt text
- `label`: Form inputs have associated labels
- `button-name`: Buttons have accessible names
- `heading-order`: Headings follow logical hierarchy
- `link-name`: Links have accessible names

## Adding New Pages to Tests

To add a new page to the accessibility test suite:

1. Open `frontend/tests/accessibility.spec.ts`
2. Add the page to the `corePages` array:

```typescript
const corePages = [
  { path: '/en', name: 'Home' },
  { path: '/en/login', name: 'Login' },
  // Add your new page here:
  { path: '/en/new-page', name: 'New Page' },
];
```

3. Run tests to verify:
```bash
npm run test:a11y
```

## Fixing Accessibility Issues

### Step-by-Step Process

1. **Run tests** to identify violations:
   ```bash
   npm run test:a11y
   ```

2. **Read the violation details** in the console output:
   - Note the rule ID (e.g., `color-contrast`)
   - Identify the affected element
   - Check the help URL for guidance

3. **Locate the component** in the codebase:
   - Use the element selector from the violation
   - Find the corresponding React component

4. **Apply the fix** based on the violation type (see "Common Violations" section above)

5. **Verify the fix**:
   ```bash
   npm run test:a11y
   ```

6. **Test manually** with assistive technologies:
   - Use a screen reader (NVDA, JAWS, VoiceOver)
   - Test keyboard navigation (Tab, Enter, Arrow keys)
   - Verify with browser zoom (200%)

### Example: Fixing a Color Contrast Violation

**Violation Output**:
```
Rule: color-contrast
Element: .submit-btn
Impact: serious
```

**Fix**:
```tsx
// src/components/Button.tsx
export function Button({ children, ...props }) {
  return (
    <button 
      className="submit-btn"
      style={{
        color: '#ffffff',      // Changed from #999999
        backgroundColor: '#0066cc', // Changed from #f5f5f5
      }}
      {...props}
    >
      {children}
    </button>
  );
}
```

**Verify**:
```bash
npm run test:a11y
```

## CI/CD Integration

The accessibility tests are designed to run in CI/CD pipelines. In GitHub Actions:

```yaml
- name: Run accessibility tests
  run: npm run test:a11y
```

Tests will fail the build if any WCAG 2.1 AA violations are found.

## Resources

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [axe DevTools Documentation](https://www.deque.com/axe/devtools/)
- [WebAIM Accessibility Resources](https://webaim.org/)
- [MDN Accessibility Guide](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [Playwright Testing Guide](https://playwright.dev/docs/intro)

## Limitations

- **Automated testing catches ~30-40% of accessibility issues**. Manual testing with assistive technologies is still required.
- **Context-dependent issues** (e.g., proper use of ARIA) may not be caught by automated tools.
- **User experience issues** (e.g., confusing navigation) require manual review.

For comprehensive accessibility validation, combine automated testing with:
- Manual testing with screen readers
- Keyboard navigation testing
- Expert accessibility review
- User testing with people with disabilities

## Troubleshooting

### Tests timeout
- Increase timeout in `playwright.config.ts`
- Ensure dev server is running: `npm run dev`

### Tests fail to connect to localhost:3000
- Start the dev server: `npm run dev`
- Check that port 3000 is not in use

### Violations appear intermittently
- Increase `waitForLoadState('networkidle')` timeout
- Check for dynamic content loading

### HTML report not generated
- Run: `npm run test:a11y:report`
- Open: `playwright-report/index.html`

## Questions?

For questions about accessibility or these tests, refer to:
- WCAG 2.1 Guidelines: https://www.w3.org/WAI/WCAG21/quickref/
- axe Documentation: https://www.deque.com/axe/devtools/
- Team accessibility guidelines (if available)
