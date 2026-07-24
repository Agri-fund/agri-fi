'use client';

import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ModalWrapperProps {
  /** Whether the modal is currently shown. When false, nothing is rendered. */
  isOpen: boolean;
  /** Called when the user dismisses the modal via Escape or a backdrop click. */
  onClose: () => void;
  children: ReactNode;
  /**
   * Set this when a form inside the modal has unsaved edits. While true,
   * Escape and backdrop clicks are ignored so in-progress work can't be
   * dismissed by accident — the user must use an explicit control inside
   * the modal (e.g. a Cancel or Save button) to exit.
   */
  isDirty?: boolean;
  /** id of the element that labels the dialog, wired to aria-labelledby. */
  labelledBy?: string;
  /** id of the element that describes the dialog, wired to aria-describedby. */
  describedBy?: string;
  /** Extra classes applied to the dialog panel (the backdrop is fixed). */
  className?: string;
}

/**
 * Standard modal behavior wrapper: Escape-to-close, backdrop-click-to-close,
 * and a focus trap that keeps Tab navigation inside the dialog and restores
 * focus to the previously-focused element on close.
 *
 * This component only owns behavior/accessibility — it renders the backdrop
 * and a dialog container around `children`, but leaves all visual layout
 * (header, close button, footer, etc.) to the caller.
 */
export function ModalWrapper({
  isOpen,
  onClose,
  children,
  isDirty = false,
  labelledBy,
  describedBy,
  className = '',
}: ModalWrapperProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Escape to close (skipped while dirty).
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || isDirty) return;
      onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDirty, onClose]);

  // Focus trap: move focus into the dialog on open, cycle Tab within it,
  // and restore focus to whatever was focused before the modal opened.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    function getFocusable(): HTMLElement[] {
      const panel = panelRef.current;
      if (!panel) return [];
      return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    }

    const [firstFocusable] = getFocusable();
    (firstFocusable ?? panelRef.current)?.focus();

    function handleTabKey(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleTabKey);
    return () => {
      document.removeEventListener('keydown', handleTabKey);
      previouslyFocused.current?.focus();
    };
  }, [isOpen]);

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || isDirty) return;
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
