'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Currently-open modals. Only the top-most one reacts to Escape / Tab so a
 * nested dialog (e.g. the wallet picker opened from inside the investment
 * modal) doesn't close or steal focus from its parent.
 *
 * "Top-most" is the deepest in the React tree (tracked via context, because
 * child effects run before parent effects when both mount together), with
 * the most recently opened winning ties.
 */
interface OpenModal {
  ref: RefObject<HTMLDivElement>;
  depth: number;
}
const modalStack: OpenModal[] = [];
const ModalDepthContext = createContext(0);

function topModal(): OpenModal | undefined {
  let top: OpenModal | undefined;
  for (const entry of modalStack) {
    if (!top || entry.depth >= top.depth) top = entry;
  }
  return top;
}

function isTopModal(ref: RefObject<HTMLDivElement>) {
  return topModal()?.ref === ref;
}

function getFocusable(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/** Focus the element marked `data-autofocus`, else the first focusable, else the panel. */
function focusInitial(panel: HTMLElement | null) {
  if (!panel) return;
  const preferred = panel.querySelector<HTMLElement>('[data-autofocus]:not([disabled])');
  const [firstFocusable] = getFocusable(panel);
  (preferred ?? firstFocusable ?? panel).focus();
}

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
  /** Accessible name when there is no visible title to reference. */
  ariaLabel?: string;
  /** id of the element that describes the dialog, wired to aria-describedby. */
  describedBy?: string;
  /** Extra classes applied to the dialog panel (the backdrop is fixed). */
  className?: string;
  /** Drop the default panel styling (background, radius, shadow, scroll). */
  unstyled?: boolean;
  /** Stacking class for the backdrop. Nested modals should sit higher. */
  zIndexClassName?: string;
  /** Optional test ids for the backdrop and panel. */
  backdropTestId?: string;
  panelTestId?: string;
}

/**
 * Standard modal behavior wrapper: Escape-to-close, backdrop-click-to-close,
 * and a focus trap that keeps Tab navigation inside the dialog and restores
 * focus to the previously-focused element on close.
 *
 * Initial focus goes to an element marked `data-autofocus` if present,
 * otherwise the first focusable element. Modals render into a portal on
 * document.body and may be nested; only the top-most one handles keys.
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
  ariaLabel,
  describedBy,
  className = '',
  unstyled = false,
  zIndexClassName = 'z-[100]',
  backdropTestId,
  panelTestId,
}: ModalWrapperProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const depth = useContext(ModalDepthContext) + 1;

  // Escape to close (skipped while dirty or when a nested modal is on top).
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || isDirty || !isTopModal(panelRef)) return;
      event.preventDefault();
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
    const entry: OpenModal = { ref: panelRef, depth };
    modalStack.push(entry);
    // A nested modal that mounted in the same commit already owns focus.
    if (isTopModal(panelRef)) focusInitial(panelRef.current);

    function handleTabKey(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !isTopModal(panelRef)) return;

      const focusable = getFocusable(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Focus escaped the panel (e.g. the focused control unmounted) — pull it back.
      if (!panelRef.current?.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleTabKey);
    return () => {
      document.removeEventListener('keydown', handleTabKey);
      const index = modalStack.indexOf(entry);
      if (index !== -1) modalStack.splice(index, 1);

      // Restore focus to the trigger. If a modal is still open underneath and
      // the trigger isn't inside it (e.g. a "Connect wallet" button that was
      // replaced by the form once connected), focus that modal instead so
      // focus isn't dropped onto <body> or behind the backdrop.
      const previous = previouslyFocused.current;
      const parent = topModal()?.ref.current;
      if (parent && !(previous?.isConnected && parent.contains(previous))) {
        focusInitial(parent);
      } else if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, [isOpen, depth]);

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || isDirty) return;
    onClose();
  }

  if (!isOpen) return null;

  const panelClasses = unstyled
    ? `outline-none ${className}`
    : `bg-white rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto outline-none ${className}`;

  const modal = (
    <div
      className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4`}
      onClick={handleBackdropClick}
      data-testid={backdropTestId}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={panelClasses}
        data-testid={panelTestId}
      >
        <ModalDepthContext.Provider value={depth}>{children}</ModalDepthContext.Provider>
      </div>
    </div>
  );

  // Portal to <body> so nested modals aren't clipped by a parent panel's
  // overflow/transform and stack predictably.
  return typeof document === 'undefined' ? modal : createPortal(modal, document.body);
}
