import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { DashboardTour, isTourCompletedStatic, resetTour } from '../DashboardTour';

const showHandlers: Array<() => void> = [];
const mockTour = {
  steps: [] as unknown[],
  start: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
  next: vi.fn(),
  back: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
  addStep: vi.fn((step: { when?: { show?: () => void } }) => {
    if (step.when?.show) showHandlers.push(step.when.show);
  }),
};

vi.mock('shepherd.js', () => {
  const Tour = vi.fn(function () {
    return mockTour;
  });
  return {
    __esModule: true,
    default: { Tour },
  };
});

vi.mock('shepherd.js/dist/css/shepherd.css', () => ({}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('DashboardTour (#1020 accessibility)', () => {
  beforeEach(() => {
    localStorage.clear();
    showHandlers.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a polite ARIA live region for progress announcements', () => {
    render(<DashboardTour locale="en" userRole="investor" />);
    const live = screen.getByTestId('tour-live-region');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('aria-atomic', 'true');
  });

  it('does not start tour if already completed', () => {
    localStorage.setItem(
      'agri-fi-dashboard-tour-completed',
      JSON.stringify({ completed: true, version: '1.1.0' }),
    );

    render(<DashboardTour locale="en" userRole="investor" />);
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(mockTour.start).not.toHaveBeenCalled();
  });

  it('starts tour and announces the first step', async () => {
    render(
      <DashboardTour locale="en" userRole="investor" forceRestart />,
    );

    expect(mockTour.start).toHaveBeenCalled();
    expect(mockTour.addStep).toHaveBeenCalled();

    // Simulate Shepherd showing the welcome step
    act(() => {
      showHandlers[0]?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('tour-live-region').textContent).toMatch(
        /Onboarding step 1 of 6/,
      );
    });
  });

  it('supports keyboard-driven start via forceRestart', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <div>
        <button type="button">Restart tour</button>
        <DashboardTour locale="en" userRole="investor" forceRestart />
      </div>,
    );

    const button = screen.getByRole('button', { name: /restart tour/i });
    await user.tab();
    expect(button).toHaveFocus();
    expect(mockTour.start).toHaveBeenCalled();
  });
});

describe('isTourCompletedStatic', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns false when no storage entry exists', () => {
    expect(isTourCompletedStatic()).toBe(false);
  });

  it('returns true when tour is completed with current version', () => {
    localStorage.setItem(
      'agri-fi-dashboard-tour-completed',
      JSON.stringify({ completed: true, version: '1.1.0' }),
    );
    expect(isTourCompletedStatic()).toBe(true);
  });

  it('returns false when tour is completed with old version', () => {
    localStorage.setItem(
      'agri-fi-dashboard-tour-completed',
      JSON.stringify({ completed: true, version: '1.0.0' }),
    );
    expect(isTourCompletedStatic()).toBe(false);
  });

  it('handles invalid JSON gracefully', () => {
    localStorage.setItem('agri-fi-dashboard-tour-completed', 'invalid-json');
    expect(isTourCompletedStatic()).toBe(false);
  });
});

describe('resetTour', () => {
  it('removes the tour completion flag from localStorage', () => {
    localStorage.setItem(
      'agri-fi-dashboard-tour-completed',
      JSON.stringify({ completed: true, version: '1.1.0' }),
    );

    resetTour();

    expect(localStorage.getItem('agri-fi-dashboard-tour-completed')).toBeNull();
  });
});
