/**
 * Tests for useNetworkStatus hook and OfflineBanner component.
 *
 * The jest.setup.ts already mocks next-intl so that useTranslations returns
 * the translation key string itself (e.g. 'network.offline.title').
 */

import { act, renderHook } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import OfflineBanner from '@/components/OfflineBanner';

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** Dispatch a synthetic browser network event on the window object. */
function goOffline() {
  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
}

function goOnline() {
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
}

/* ── useNetworkStatus ─────────────────────────────────────────────────────── */

describe('useNetworkStatus', () => {
  beforeEach(() => {
    // Ensure navigator.onLine starts as true before each test
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: true,
    });
  });

  it('initialises as online when navigator.onLine is true', () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
  });

  it('initialises as offline when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });

    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);
  });

  it('updates to offline when the "offline" event fires', () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);

    goOffline();

    expect(result.current.isOnline).toBe(false);
  });

  it('updates back to online when the "online" event fires', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });

    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);

    goOnline();

    expect(result.current.isOnline).toBe(true);
  });

  it('removes event listeners on unmount', () => {
    const addSpy    = jest.spyOn(window, 'addEventListener');
    const removeSpy = jest.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useNetworkStatus());
    unmount();

    expect(addSpy).toHaveBeenCalledWith('online',  expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('offline', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('online',  expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));

    addSpy.restore?.();
    removeSpy.restore?.();
  });

  it('handles rapid online/offline transitions correctly', () => {
    const { result } = renderHook(() => useNetworkStatus());

    goOffline();
    expect(result.current.isOnline).toBe(false);

    goOnline();
    expect(result.current.isOnline).toBe(true);

    goOffline();
    expect(result.current.isOnline).toBe(false);
  });
});

/* ── OfflineBanner ────────────────────────────────────────────────────────── */

describe('OfflineBanner', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: true,
    });
  });

  it('renders nothing when online', () => {
    const { container } = render(<OfflineBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the banner when offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });

    render(<OfflineBanner />);

    const banner = screen.getByRole('alert');
    expect(banner).toBeInTheDocument();
  });

  it('shows the offline title message', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });

    render(<OfflineBanner />);

    // next-intl mock returns the key itself
    expect(screen.getByText('network.offline.title')).toBeInTheDocument();
  });

  it('shows the offline description message', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });

    render(<OfflineBanner />);

    expect(screen.getByText('network.offline.description')).toBeInTheDocument();
  });

  it('has role="alert" for immediate screen-reader announcement', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });

    render(<OfflineBanner />);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveAttribute('aria-live', 'assertive');
    expect(banner).toHaveAttribute('aria-atomic', 'true');
  });

  it('is fixed and sits at the top (z-[200]) when offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });

    render(<OfflineBanner />);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveClass('fixed', 'top-0', 'left-0', 'right-0');
  });

  it('uses amber styling as the visual offline indicator', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });

    render(<OfflineBanner />);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveClass('bg-amber-500');
  });

  it('disappears when coming back online after being offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });

    render(<OfflineBanner />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Simulate coming back online
    goOnline();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('appears when going offline after being online', () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    goOffline();

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
