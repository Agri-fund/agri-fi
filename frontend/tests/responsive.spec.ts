import { render, screen } from '@testing-library/react';

describe('Layout responsiveness on mobile viewport targets', () => {
  const setViewportSize = (width: number, height: number) => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: height,
    });
    window.dispatchEvent(new Event('resize'));
  };

  const createMockNavComponent = () => {
    return `
      <header className="sticky top-0 z-50">
        <!-- Desktop Navigation -->
        <nav data-testid="desktop-nav" className="hidden md:flex">
          <a href="/dashboard">Dashboard</a>
          <a href="/marketplace">Marketplace</a>
          <a href="/documents">Documents</a>
          <a href="/settings">Settings</a>
        </nav>

        <!-- Hamburger Menu Button (Mobile) -->
        <button
          data-testid="hamburger-menu"
          className="md:hidden"
          aria-label="Toggle navigation menu"
        >
          Menu
        </button>
      </header>
    `;
  };

  describe('Mobile viewport (375px)', () => {
    beforeEach(() => {
      setViewportSize(375, 667);
    });

    it('should show hamburger menu on mobile viewports', () => {
      const container = document.createElement('div');
      container.innerHTML = createMockNavComponent();
      document.body.appendChild(container);

      const hamburger = container.querySelector('[data-testid="hamburger-menu"]');
      const computedStyle = window.getComputedStyle(hamburger as HTMLElement);

      expect(hamburger).toBeTruthy();
      expect(computedStyle.display).not.toBe('none');

      document.body.removeChild(container);
    });

    it('should hide desktop navigation elements on mobile viewports', () => {
      const container = document.createElement('div');
      container.innerHTML = createMockNavComponent();
      document.body.appendChild(container);

      const desktopNav = container.querySelector('[data-testid="desktop-nav"]');
      const computedStyle = window.getComputedStyle(desktopNav as HTMLElement);

      expect(desktopNav).toBeTruthy();
      expect(computedStyle.display).toBe('none');

      document.body.removeChild(container);
    });
  });

  describe('Tablet viewport (768px)', () => {
    beforeEach(() => {
      setViewportSize(768, 1024);
    });

    it('should show desktop navigation on tablet and above', () => {
      const container = document.createElement('div');
      container.innerHTML = createMockNavComponent();
      document.body.appendChild(container);

      const desktopNav = container.querySelector('[data-testid="desktop-nav"]');
      const hamburger = container.querySelector('[data-testid="hamburger-menu"]');

      const desktopStyle = window.getComputedStyle(desktopNav as HTMLElement);
      const hamburgerStyle = window.getComputedStyle(hamburger as HTMLElement);

      expect(desktopStyle.display).not.toBe('none');
      expect(hamburgerStyle.display).toBe('none');

      document.body.removeChild(container);
    });
  });

  describe('Desktop viewport (1920px)', () => {
    beforeEach(() => {
      setViewportSize(1920, 1080);
    });

    it('should show desktop navigation and hide hamburger menu', () => {
      const container = document.createElement('div');
      container.innerHTML = createMockNavComponent();
      document.body.appendChild(container);

      const desktopNav = container.querySelector('[data-testid="desktop-nav"]');
      const hamburger = container.querySelector('[data-testid="hamburger-menu"]');

      const desktopStyle = window.getComputedStyle(desktopNav as HTMLElement);
      const hamburgerStyle = window.getComputedStyle(hamburger as HTMLElement);

      expect(desktopStyle.display).not.toBe('none');
      expect(hamburgerStyle.display).toBe('none');

      document.body.removeChild(container);
    });
  });

  describe('Viewport transitions', () => {
    it('should handle transitions between mobile and desktop viewports', () => {
      const container = document.createElement('div');
      container.innerHTML = createMockNavComponent();
      document.body.appendChild(container);

      const desktopNav = container.querySelector('[data-testid="desktop-nav"]');
      const hamburger = container.querySelector('[data-testid="hamburger-menu"]');

      setViewportSize(375, 667);
      let desktopStyle = window.getComputedStyle(desktopNav as HTMLElement);
      let hamburgerStyle = window.getComputedStyle(hamburger as HTMLElement);
      expect(desktopStyle.display).toBe('none');
      expect(hamburgerStyle.display).not.toBe('none');

      setViewportSize(768, 1024);
      desktopStyle = window.getComputedStyle(desktopNav as HTMLElement);
      hamburgerStyle = window.getComputedStyle(hamburger as HTMLElement);
      expect(desktopStyle.display).not.toBe('none');
      expect(hamburgerStyle.display).toBe('none');

      document.body.removeChild(container);
    });
  });
});
