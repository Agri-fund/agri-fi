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
    const onReload = jest.fn();

    render(
      <ErrorBoundary onReload={onReload}>
        <ProblemChild />
      </ErrorBoundary>
    );

    fireEvent.click(screen.getByText('Reload page'));
    expect(onReload).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
