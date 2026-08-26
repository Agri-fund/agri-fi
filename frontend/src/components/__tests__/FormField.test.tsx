import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField } from '../ui/FormField';

// Mock next-intl so the component can be tested without a provider
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: any) => key,
}));

describe('FormField', () => {
  const baseProps = {
    id: 'test-field',
    label: 'Test Label',
    value: '',
    onChange: jest.fn(),
  };

  it('renders label and input with correct id linkage', () => {
    render(<FormField {...baseProps} />);
    const input = screen.getByRole('textbox');
    const label = screen.getByText('Test Label');
    expect(input).toHaveAttribute('id', 'test-field');
    expect(label).toHaveAttribute('for', 'test-field');
  });

  it('shows error message with role="alert" and aria-invalid when error and touched', () => {
    render(
      <FormField
        {...baseProps}
        error="This field is required"
        touched={true}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('This field is required');
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not show error message when not touched', () => {
    render(
      <FormField
        {...baseProps}
        error="This field is required"
        touched={false}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const input = screen.getByRole('textbox');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('shows success tick when touched, no error, and value non-empty', () => {
    const { container } = render(
      <FormField
        {...baseProps}
        value="hello@example.com"
        touched={true}
        error={undefined}
      />,
    );
    // The ✓ tick is in an aria-hidden span
    const tick = container.querySelector('[aria-hidden="true"]');
    expect(tick).toBeInTheDocument();
    expect(tick?.textContent).toBe('✓');
  });

  it('does not show success tick when value is empty even if touched', () => {
    const { container } = render(
      <FormField
        {...baseProps}
        value=""
        touched={true}
        error={undefined}
      />,
    );
    // There should be no ✓ tick
    const spans = Array.from(container.querySelectorAll('[aria-hidden="true"]'));
    const tickSpan = spans.find((s) => s.textContent === '✓');
    expect(tickSpan).toBeUndefined();
  });

  it('sets aria-describedby to error id when error exists and touched', () => {
    render(
      <FormField
        {...baseProps}
        error="Something went wrong"
        touched={true}
      />,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-describedby', 'test-field-error');
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'test-field-error');
  });

  it('sets aria-describedby to hint id when hint given and no error', () => {
    render(
      <FormField
        {...baseProps}
        hint="Enter your email address"
      />,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-describedby', 'test-field-hint');
    const hint = screen.getByText('Enter your email address');
    expect(hint).toHaveAttribute('id', 'test-field-hint');
  });

  it('hint aria-describedby is NOT used when error+touched overrides it', () => {
    render(
      <FormField
        {...baseProps}
        hint="Enter your email address"
        error="This field is required"
        touched={true}
      />,
    );
    const input = screen.getByRole('textbox');
    // Should point to error id, not hint id
    expect(input).toHaveAttribute('aria-describedby', 'test-field-error');
    // Hint should not be rendered when there is an error
    expect(screen.queryByText('Enter your email address')).not.toBeInTheDocument();
  });

  it('shows * in label for required fields', () => {
    const { container } = render(
      <FormField {...baseProps} required />,
    );
    const asterisk = container.querySelector('[aria-hidden="true"]');
    expect(asterisk).toBeInTheDocument();
    expect(asterisk?.textContent?.trim()).toBe('*');
  });

  it('does not show * for non-required fields', () => {
    const { container } = render(
      <FormField {...baseProps} required={false} />,
    );
    // No aria-hidden asterisk in label area when not required
    const label = container.querySelector('label');
    expect(label?.textContent?.trim()).toBe('Test Label');
  });

  it('renders a textarea when type="textarea"', () => {
    render(
      <FormField {...baseProps} type="textarea" />,
    );
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
  });

  it('renders an input by default', () => {
    render(<FormField {...baseProps} />);
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });

  it('passes the type prop through to the input element', () => {
    render(<FormField {...baseProps} type="email" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('type', 'email');
  });

  it('shows border-red-500 class when error and touched', () => {
    render(
      <FormField {...baseProps} error="Required" touched={true} />,
    );
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('border-red-500');
  });

  it('shows border-green-500 class when touched, no error, and value non-empty', () => {
    render(
      <FormField
        {...baseProps}
        value="valid value"
        touched={true}
        error={undefined}
      />,
    );
    const input = screen.getByRole('textbox');
    expect(input.className).toContain('border-green-500');
  });

  it('calls onChange when input value changes', async () => {
    const user = userEvent.setup();
    const handleChange = jest.fn();
    render(<FormField {...baseProps} onChange={handleChange} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'a');
    expect(handleChange).toHaveBeenCalled();
  });

  it('calls onBlur when input loses focus', async () => {
    const user = userEvent.setup();
    const handleBlur = jest.fn();
    render(<FormField {...baseProps} onBlur={handleBlur} />);
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.tab();
    expect(handleBlur).toHaveBeenCalled();
  });

  it('is disabled when disabled prop is set', () => {
    render(<FormField {...baseProps} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
