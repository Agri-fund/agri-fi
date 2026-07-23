import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

describe('ErrorBoundary', () => {
  const ProblemChild = () => {
    throw new Error('Test error');
  };

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="safe-child">Safe</div>
      </ErrorBoundary>
    );

    expect(screen.getByTestId('safe-child')).toBeInTheDocument();
  });

  it('renders fallback UI when a child throws an error', () => {
    // Suppress console.error for this test to keep output clean
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Reload page')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('reloads the page when Reload button is clicked', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const reloadSpy = jest.spyOn(window.location, 'reload').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByText('Reload page'));
    expect(reloadSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    reloadSpy.mockRestore();
  });
});
