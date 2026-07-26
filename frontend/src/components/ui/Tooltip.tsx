'use client';

import React, { useId } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TooltipProps {
  /** The text to show in the tooltip bubble */
  content: string;
  /** The element that triggers the tooltip */
  children: React.ReactNode;
  /** Placement of the tooltip relative to the trigger. Defaults to 'top'. */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Extra classes for the outer wrapper span */
  className?: string;
}

// ── Placement helpers ─────────────────────────────────────────────────────────

/**
 * Returns Tailwind classes for positioning the bubble and its CSS arrow
 * depending on which side the tooltip should appear on.
 */
function getPlacementClasses(placement: NonNullable<TooltipProps['placement']>): {
  bubble: string;
  arrow: string;
} {
  switch (placement) {
    case 'bottom':
      return {
        bubble: 'top-full left-1/2 -translate-x-1/2 mt-2',
        arrow:
          'absolute -top-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-slate-800',
      };
    case 'left':
      return {
        bubble: 'right-full top-1/2 -translate-y-1/2 mr-2',
        arrow:
          'absolute -right-1.5 top-1/2 -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-l-4 border-t-transparent border-b-transparent border-l-slate-800',
      };
    case 'right':
      return {
        bubble: 'left-full top-1/2 -translate-y-1/2 ml-2',
        arrow:
          'absolute -left-1.5 top-1/2 -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-r-4 border-t-transparent border-b-transparent border-r-slate-800',
      };
    case 'top':
    default:
      return {
        bubble: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
        arrow:
          'absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-800',
      };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * CSS-based tooltip component — no JS state needed.
 *
 * • Shows on hover (mouse) via Tailwind `group-hover`.
 * • Shows on keyboard focus via `group-focus-within`.
 * • Screen readers receive the tooltip text via `aria-describedby`.
 * • The trigger element itself is keyboard-focusable (tabIndex=0).
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  className = '',
}: TooltipProps) {
  const tooltipId = useId();
  const { bubble, arrow } = getPlacementClasses(placement);

  return (
    <span
      className={`group relative inline-flex items-center ${className}`}
    >
      {/*
       * Trigger wrapper — tabIndex=0 makes plain text nodes keyboard-focusable.
       * aria-describedby links to the tooltip for screen readers.
       */}
      <span
        aria-describedby={tooltipId}
        tabIndex={0}
        className={[
          'cursor-help',
          'underline decoration-dotted decoration-slate-400 underline-offset-2',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded-sm',
        ].join(' ')}
      >
        {children}
      </span>

      {/*
       * Tooltip bubble — hidden by default; shown on hover or focus-within
       * via group-hover: and group-focus-within: variants.
       *
       * pointer-events-none prevents the bubble itself from triggering
       * mouse-leave on the group.
       */}
      <span
        id={tooltipId}
        role="tooltip"
        className={[
          'pointer-events-none absolute z-50 w-max max-w-xs',
          'rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium leading-snug text-white shadow-lg',
          // Invisible + slightly scaled-down by default
          'opacity-0 scale-95',
          // Smooth reveal transition
          'transition-all duration-150 ease-out',
          // Reveal on mouse hover OR keyboard focus anywhere in the group
          'group-hover:opacity-100 group-hover:scale-100',
          'group-focus-within:opacity-100 group-focus-within:scale-100',
          bubble,
        ].join(' ')}
      >
        {/* CSS arrow */}
        <span className={arrow} aria-hidden="true" />
        {content}
      </span>
    </span>
  );
}

// ── Pre-defined shipping-finance acronym glossary ─────────────────────────────

/** Plain-language definitions for common agricultural trade finance acronyms. */
export const TRADE_ACRONYMS: Record<string, string> = {
  FOB:  'Free on Board — seller delivers goods to named port; buyer bears all costs and risks from that point.',
  CIF:  'Cost, Insurance & Freight — seller covers cost, marine insurance, and freight charges to the destination port.',
  BL:   'Bill of Lading — legal document between shipper and carrier detailing the cargo, vessel, and destination.',
  'B/L':'Bill of Lading — legal document between shipper and carrier detailing the cargo, vessel, and destination.',
  LC:   'Letter of Credit — bank guarantee ensuring the seller receives payment once shipping documents are presented.',
  'L/C':'Letter of Credit — bank guarantee ensuring the seller receives payment once shipping documents are presented.',
  EXW:  "Ex Works — buyer bears full cost and risk from the seller's premises; minimum obligation for the seller.",
  CFR:  'Cost and Freight — seller pays cost and freight to the destination port; risk transfers at the origin port.',
  DAP:  'Delivered at Place — seller delivers goods to the named destination; buyer handles import duties.',
  DDP:  'Delivered Duty Paid — seller bears all costs including import duties to the buyer\'s door.',
  MT:   'Metric Ton — standard unit of weight (1,000 kg) used in bulk commodity trading.',
};

// ── TradeAcronym convenience wrapper ─────────────────────────────────────────

interface AcronymProps {
  /** The acronym text, e.g. "FOB" */
  term: string;
  /** Override the glossary definition */
  definition?: string;
  /** Tooltip placement */
  placement?: TooltipProps['placement'];
}

/**
 * Wraps a known trade finance acronym with a Tooltip showing its definition.
 * Falls back to rendering plain text if no definition is found.
 */
export function TradeAcronym({ term, definition, placement = 'top' }: AcronymProps) {
  const text = definition ?? TRADE_ACRONYMS[term];

  if (!text) {
    return <>{term}</>;
  }

  return (
    <Tooltip content={text} placement={placement}>
      {/* <abbr> provides a native browser tooltip as a fallback */}
      <abbr title={text} className="no-underline">
        {term}
      </abbr>
    </Tooltip>
  );
}

export default Tooltip;
