import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from '../ui/FormField';

describe('FormField', () => {
  it('renders pristine fields without validation status', () => {
    render(<FormField label="Email" type="email" />);

    const input = screen.getByLabelText('Email');
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByTestId('form-field-error-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('form-field-success-icon')).not.toBeInTheDocument();
  });

  it('renders an accessible inline error', () => {
    render(<FormField label="Email" type="email" error="Email is required" />);

    const input = screen.getByLabelText('Email');
    const message = screen.getByRole('alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', message.id);
    expect(message).toHaveTextContent('Email is required');
    expect(screen.getByTestId('form-field-error-icon')).toBeInTheDocument();
  });

  it('shows a success icon only for a touched valid field', () => {
    const { rerender } = render(<FormField label="Email" type="email" success />);
    expect(screen.queryByTestId('form-field-success-icon')).not.toBeInTheDocument();

    rerender(<FormField label="Email" type="email" touched success />);
    expect(screen.getByTestId('form-field-success-icon')).toBeInTheDocument();
  });
});