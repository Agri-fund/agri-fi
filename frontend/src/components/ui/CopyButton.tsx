'use client';

import { useState, useCallback } from 'react';

interface CopyButtonProps {
  /** The text value to copy to the clipboard. */
  text: string;
  /** Optional extra class names applied to the button wrapper. */
  className?: string;
  /** Accessible label prefix — screen readers will announce "<label>: copied" on success. */
  label?: string;
  /** Duration in milliseconds to show the success state. Defaults to 1500. */
  successDuration?: number;
}

/**
 * A small icon button that copies `text` to the clipboard.
 *
 * - Uses the standard `navigator.clipboard.writeText` API.
 * - Toggles from a copy icon to a checkmark for `successDuration` ms on success.
 * - Announces the copied state to screen readers via an `aria-live` region.
 */
export function CopyButton({
  text,
  className = '',
  label = 'Value',
  successDuration = 1500,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (copied) return; // prevent double-trigger during success window

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), successDuration);
    } catch {
      // Clipboard API may be unavailable in non-secure contexts or older browsers.
      // Silently fail — the user can still manually select the text.
    }
  }, [text, copied, successDuration]);

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? `${label}: copied` : `Copy ${label}`}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
        className={[
          'inline-flex items-center justify-center rounded-md p-1.5 transition-colors',
          'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
          'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          copied ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {copied ? (
          /* Checkmark icon */
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          /* Copy icon */
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>

      {/* Visually-hidden live region for screen-reader announcement */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {copied ? `${label} copied to clipboard` : ''}
      </span>
    </>
  );
}

export default CopyButton;
