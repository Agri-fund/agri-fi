import { render, screen } from '@testing-library/react';
import StatusBadge from '../StatusBadge';

describe('StatusBadge', () => {
  it('renders draft status with correct styling', () => {
    render(<StatusBadge status="draft" />);
    
    const badge = screen.getByText('draft');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-gray-100', 'text-gray-600');
  });

  it('renders open status with correct styling', () => {
    render(<StatusBadge status="open" />);
    
    const badge = screen.getByText('open');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-green-100', 'text-green-700');
  });

  it('renders funded status with correct styling', () => {
    render(<StatusBadge status="funded" />);
    
    const badge = screen.getByText('funded');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-blue-100', 'text-blue-700');
  });

  it('renders delivered status with correct styling', () => {
    render(<StatusBadge status="delivered" />);
    
    const badge = screen.getByText('delivered');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-orange-100', 'text-orange-700');
  });

  it('renders completed status with correct styling', () => {
    render(<StatusBadge status="completed" />);
    
    const badge = screen.getByText('completed');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-gray-200', 'text-gray-700');
  });

  it('renders failed status with correct styling', () => {
    render(<StatusBadge status="failed" />);
    
    const badge = screen.getByText('failed');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-red-100', 'text-red-700');
  });

  it('has consistent badge styling classes', () => {
    render(<StatusBadge status="open" />);
    
    const badge = screen.getByText('open');
    expect(badge).toHaveClass(
      'inline-block',
      'px-2',
      'py-0.5',
      'rounded-full',
      'text-xs',
      'font-medium',
      'capitalize'
    );
  });
});