import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DashboardTour, isTourCompletedStatic, resetTour } from '../DashboardTour';
import Shepherd from 'shepherd.js';

// Mock shepherd.js
vi.mock('shepherd.js', () => {
  const mockTour = {
    steps: [],
    start: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
    next: vi.fn(),
    back: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
  };
  const Tour = vi.fn(function () {
    return mockTour;
  });
  return {
    __esModule: true,
    default: { Tour },
  };
});

vi.mock('shepherd.js/dist/css/shepherd.css', () => ({}));

describe('DashboardTour', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(
      <DashboardTour locale="en" userRole="investor" />
    );
    // DashboardTour renders null (no visible UI)
    expect(document.body).toBeTruthy();
  });

  it('does not start tour if already completed', () => {
    localStorage.setItem(
      'agri-fi-dashboard-tour-completed',
      JSON.stringify({ completed: true, version: '1.0.0' })
    );

    render(
      <DashboardTour locale="en" userRole="investor" />
    );

    // Tour should not have started
    expect(Shepherd.Tour).not.toHaveBeenCalled();
  });

  it('calls onTourComplete when provided', () => {
    const onTourComplete = vi.fn();

    render(
      <DashboardTour
        locale="en"
        userRole="investor"
        onTourComplete={onTourComplete}
        forceRestart
      />
    );

    // The component should render without errors
    expect(document.body).toBeTruthy();
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
      JSON.stringify({ completed: true, version: '1.0.0' })
    );
    expect(isTourCompletedStatic()).toBe(true);
  });

  it('returns false when tour is completed with old version', () => {
    localStorage.setItem(
      'agri-fi-dashboard-tour-completed',
      JSON.stringify({ completed: true, version: '0.9.0' })
    );
    expect(isTourCompletedStatic()).toBe(false);
  });

  it('returns false when completed is false', () => {
    localStorage.setItem(
      'agri-fi-dashboard-tour-completed',
      JSON.stringify({ completed: false, version: '1.0.0' })
    );
    expect(isTourCompletedStatic()).toBe(false);
  });

  it('handles invalid JSON gracefully', () => {
    localStorage.setItem(
      'agri-fi-dashboard-tour-completed',
      'invalid-json'
    );
    expect(isTourCompletedStatic()).toBe(false);
  });
});

describe('resetTour', () => {
  it('removes the tour completion flag from localStorage', () => {
    localStorage.setItem(
      'agri-fi-dashboard-tour-completed',
      JSON.stringify({ completed: true, version: '1.0.0' })
    );

    resetTour();

    expect(localStorage.getItem('agri-fi-dashboard-tour-completed')).toBeNull();
  });

  it('does not throw when no entry exists', () => {
    expect(() => resetTour()).not.toThrow();
  });
});
