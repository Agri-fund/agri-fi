'use client';

import React, { useId } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';

export interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  touched?: boolean;
  success?: boolean;
  hideLabel?: boolean;
  wrapperClassName?: string;
  children?: React.ReactElement;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  (
    {
      label,
      hint,
      error,
      touched = false,
      success = false,
      hideLabel = false,
      id,
      className = '',
      wrapperClassName = '',
      children,
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
    const showSuccess = touched && success && !error;
    const customControl = children
      ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          ...props,
          id: inputId,
          required,
          'aria-required': required || undefined,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          ...(children.type === 'textarea'
            ? {
                className: [error ? 'input-error' : 'input', error || showSuccess ? 'pr-10' : '', className].filter(Boolean).join(' '),
              }
            : {}),
        })
      : null;

    return (
      <div className={wrapperClassName}>
        <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'label'}>
          {label}
          {required && <span className="text-red-500" aria-hidden="true"> *</span>}
        </label>
        <div className="relative">
          {customControl ?? (
            <input
              {...props}
              ref={ref}
              id={inputId}
              required={required}
              aria-required={required || undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className={[error ? 'input-error' : 'input', error || showSuccess ? 'pr-10' : '', className].filter(Boolean).join(' ')}
            />
          )}
          {error && (
            <CircleAlert
              aria-hidden="true"
              data-testid="form-field-error-icon"
              className={`absolute right-3 ${children?.type === 'textarea' ? 'top-9' : 'top-1/2 -translate-y-1/2'} h-4 w-4 text-red-600`}
            />
          )}
          {showSuccess && (
            <CircleCheck
              aria-hidden="true"
              data-testid="form-field-success-icon"
              className={`absolute right-3 ${children?.type === 'textarea' ? 'top-9' : 'top-1/2 -translate-y-1/2'} h-4 w-4 text-emerald-600`}
            />
          )}
        </div>
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

FormField.displayName = 'FormField';

export default FormField;