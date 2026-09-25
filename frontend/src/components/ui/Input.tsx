'use client';

import React, { useId } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  wrapperClassName?: string;
}

/**
 * Accessible text input — Issue #267.
 *
 * Always renders a real <label> tied to the input via htmlFor/id (or visually
 * hides it with sr-only when `hideLabel` is set, so screen readers still get
 * a name). Hint and error text are wired up via aria-describedby so assistive
 * tech announces them, and aria-invalid/role="alert" surface validation state.
 * Focus-visible ring styles come from the shared `.input` class in globals.css.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
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
    const inputId = id ?? generatedId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [ariaDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;

    return (
      <div className={wrapperClassName}>
        <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'label'}>
          {label}
          {required && <span className="text-red-500" aria-hidden="true"> *</span>}
        </label>
        <input
          {...props}
          ref={ref}
          id={inputId}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[error ? 'input-error' : 'input', className].filter(Boolean).join(' ')}
        />
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

Input.displayName = 'Input';

export default Input;
