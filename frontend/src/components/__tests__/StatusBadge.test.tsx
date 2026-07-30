import { render, screen } from '@testing-library/react';
import StatusBadge from '../StatusBadge';

describe('StatusBadge', () => {
  it('renders draft status with correct styling', () => {
    render(<StatusBadge status="draft" />);

    const badge = screen.getByText('draft');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-gray', 'capitalize');
  });

  it('renders open status with correct styling', () => {
    render(<StatusBadge status="open" />);

    const badge = screen.getByText('open');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-green', 'capitalize');
  });

  it('renders funded status with correct styling', () => {
    render(<StatusBadge status="funded" />);

    const badge = screen.getByText('funded');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-blue', 'capitalize');
  });

  it('renders delivered status with correct styling', () => {
    render(<StatusBadge status="delivered" />);

    const badge = screen.getByText('delivered');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-purple', 'capitalize');
  });

  it('renders completed status with correct styling', () => {
    render(<StatusBadge status="completed" />);

    const badge = screen.getByText('completed');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-gray', 'capitalize');
  });

  it('renders failed status with correct styling', () => {
    render(<StatusBadge status="failed" />);

    const badge = screen.getByText('failed');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-red', 'capitalize');
  });

  it('has consistent badge styling classes', () => {
    render(<StatusBadge status="open" />);

    const badge = screen.getByText('open');
    expect(badge).toHaveClass('badge-green', 'capitalize');
  });
});
