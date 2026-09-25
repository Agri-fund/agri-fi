'use client';

import React, { useId } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  placeholder?: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  wrapperClassName?: string;
}

/**
 * Accessible select — Issue #267.
 *
 * Uses a native <select> so browsers/screen readers get correct keyboard
 * navigation (arrow keys, type-ahead) and Tab order for free, rather than
 * reimplementing a custom listbox. Label, hint, and error wiring mirror
 * `Input` so both components behave consistently for assistive tech.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      options,
      placeholder,
      hint,
      error,
      hideLabel = false,
      id,
      className = '',
      wrapperClassName = '',
      required,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;
    const hintId = hint ? `${selectId}-hint` : undefined;
    const errorId = error ? `${selectId}-error` : undefined;
    const describedBy = [ariaDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;

    return (
      <div className={wrapperClassName}>
        <label htmlFor={selectId} className={hideLabel ? 'sr-only' : 'label'}>
          {label}
          {required && <span className="text-red-500" aria-hidden="true"> *</span>}
        </label>
        <select
          {...props}
          ref={ref}
          id={selectId}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[error ? 'input-error' : 'select', className].filter(Boolean).join(' ')}
        >
          {placeholder && (
            <option value="" disabled={required}>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        {hint && !error && (
          <p id={hintId} className="label-hint">{hint}</p>
        )}
        {error && (
          <p id={errorId} role="alert" className="label-hint text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Select.displayName = 'Select';

export default Select;
