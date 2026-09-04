'use client';

import React from 'react';

export interface FormFieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  error?: string;
  touched?: boolean;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
  hint?: string;
  successMessage?: string;
}

/**
 * Accessible form field component — Issue #900.
 *
 * Encapsulates label + input/textarea + error + hint + success display.
 * - Shows error (with ⚠ icon, role="alert", border-red-500, aria-invalid) when
 *   `error` is set and `touched` is true.
 * - Shows a ✓ success indicator (border-green-500) when touched, no error, and
 *   value is non-empty.
 * - aria-describedby points to the error span when error+touched, or to the
 *   hint span otherwise.
 * - Label uses htmlFor={id} and renders an asterisk for required fields.
 * - Renders a <textarea> when type="textarea", otherwise a standard <input>.
 */
export function FormField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  error,
  touched = false,
  required,
  disabled,
  placeholder,
  autoComplete,
  className = '',
  hint,
  successMessage,
}: FormFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const hasError = Boolean(error && touched);
  const isValid = touched && !error && value !== '';

  // Build aria-describedby: error takes priority over hint
  let describedBy: string | undefined;
  if (hasError) {
    describedBy = errorId;
  } else if (hint) {
    describedBy = hintId;
  }

  // Build border / ring classes
  const borderClass = hasError
    ? 'border-red-500 focus:ring-red-200 focus:border-red-500'
    : isValid
      ? 'border-green-500 focus:ring-green-200 focus:border-green-500'
      : '';

  const sharedProps = {
    id,
    value,
    onChange,
    onBlur,
    required,
    disabled,
    placeholder,
    'aria-invalid': hasError ? (true as const) : undefined,
    'aria-describedby': describedBy,
    'aria-required': required ? (true as const) : undefined,
    className: ['input', borderClass, className].filter(Boolean).join(' '),
  };

  return (
    <div className="space-y-1">
      {/* Label */}
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span className="text-red-500 ml-0.5" aria-hidden="true">
            {' '}*
          </span>
        )}
      </label>

      {/* Input wrapper — relative for the success tick */}
      <div className="relative">
        {type === 'textarea' ? (
          <textarea
            {...(sharedProps as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
            rows={4}
          />
        ) : (
          <input
            {...(sharedProps as React.InputHTMLAttributes<HTMLInputElement>)}
            type={type}
            autoComplete={autoComplete}
          />
        )}

        {/* Success tick */}
        {isValid && !hasError && (
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500 pointer-events-none"
            aria-hidden="true"
          >
            ✓
          </span>
        )}
      </div>

      {/* Error message */}
      {hasError && (
        <p id={errorId} role="alert" className="text-xs text-red-600 flex items-center gap-1 mt-0.5">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}

      {/* Hint (only shown when no error) */}
      {hint && !hasError && (
        <p id={hintId} className="label-hint">
          {hint}
        </p>
      )}

      {/* Optional success message */}
      {isValid && successMessage && (
        <p className="text-xs text-green-600 mt-0.5">{successMessage}</p>
      )}
    </div>
  );
}

export default FormField;
