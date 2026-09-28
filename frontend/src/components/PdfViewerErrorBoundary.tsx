'use client';

// =============================================================================
// Issue #978 — perf(frontend): lazy-load PDF viewer + bundle budget
// https://github.com/Agri-fund/agri-fi/issues/978
//
// ─── ROLE OF THIS FILE ───────────────────────────────────────────────────────
//
// PdfViewerErrorBoundary wraps <PdfViewer> and catches any uncaught runtime
// exceptions thrown by react-pdf / pdf.js during rendering (WASM init errors,
// corrupted PDF streams, memory allocation failures, etc.).
//
// ─── REQUIRED CHANGE FOR #978 ────────────────────────────────────────────────
//
// Because PdfViewer will be loaded via next/dynamic (ssr: false), this boundary
// will only ever execute in the browser.  However, to be explicit and safe
// against any future SSR regression, add a server-side null-guard at the top
// of the render() method:
//
//   public render() {
//     // Guard: this component should never run server-side after the
//     // next/dynamic migration (ssr: false), but be explicit for safety.
//     if (typeof window === 'undefined') return null;
//
//     const { caught, error } = this.state;
//     // ... rest of render
//   }
//
// This ensures that if the component is ever accidentally server-rendered
// (e.g. via generateMetadata or a route that bypasses the dynamic flag),
// the boundary returns null instead of trying to access browser-only APIs.
//
// ─── USAGE PATTERN (post #978 fix) ───────────────────────────────────────────
//
//   import dynamic from 'next/dynamic';
//   import { PdfViewerErrorBoundary } from '@/components/PdfViewerErrorBoundary';
//
//   // Only the inner viewer is lazy-loaded; the boundary can stay static
//   // because it renders nothing until the viewer throws.
//   const PdfViewer = dynamic(
//     () => import('@/components/PdfViewer').then(m => ({ default: m.PdfViewer })),
//     { ssr: false }
//   );
//
//   // In JSX:
//   <PdfViewerErrorBoundary url={url} fileName={fileName} onError={captureException}>
//     <PdfViewer url={url} fileName={fileName} isSensitive={isSensitive} />
//   </PdfViewerErrorBoundary>
//
// The boundary itself is lightweight (no pdf.js dependency) so it can remain
// a static import without contributing meaningfully to bundle size.
//
// =============================================================================

/**
 * PdfViewerErrorBoundary
 *
 * A React error boundary specifically designed to wrap <PdfViewer>. If the
 * PDF.js / react-pdf engine throws during rendering (e.g. a WASM initialisation
 * error that slips past the useWasmSupport pre-check, a corrupted PDF stream,
 * or any other unexpected runtime exception), this boundary catches the error
 * and renders an inline fallback with a download link so the user is never
 * left with a blank, broken screen.
 *
 * Usage:
 *   <PdfViewerErrorBoundary url="…" fileName="…">
 *     <PdfViewer url="…" fileName="…" />
 *   </PdfViewerErrorBoundary>
 *
 * The `url` and `fileName` props on the boundary are used to construct the
 * download link inside the fallback UI, so they should match those passed to
 * the inner <PdfViewer>.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** PDF URL — used to construct the fallback download link. */
  url: string;
  /** Display name — shown in the fallback UI. */
  fileName?: string;
  /**
   * Optional callback invoked when the boundary catches an error.
   * Useful for wiring in error tracking (e.g. Sentry).
   */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  caught: boolean;
  error?: Error;
}

export class PdfViewerErrorBoundary extends Component<Props, State> {
  public state: State = { caught: false };

  public static getDerivedStateFromError(error: Error): State {
    return { caught: true, error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo) {
    // Allow callers to plug in external error monitoring (e.g. Sentry)
    this.props.onError?.(error, info);
    console.error('[PdfViewerErrorBoundary] Caught render error:', error, info);
  }

  /** Allow the user to retry rendering the PDF from scratch. */
  private handleRetry = () => {
    this.setState({ caught: false, error: undefined });
  };

  public render() {
    const { caught, error } = this.state;
    const { children, url, fileName = 'document.pdf' } = this.props;

    if (!caught) {
      return children;
    }

    return (
      <div
        className="flex flex-col items-center justify-center gap-5 rounded-xl border border-red-200 bg-red-50 p-10 text-center"
        role="alert"
        aria-live="assertive"
        data-testid="pdf-viewer-error-boundary"
      >
        {/* Icon */}
        <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center" aria-hidden="true">
          <svg
            className="w-8 h-8 text-red-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v4m0 4h.01M10.29 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8.71L15.29 3H10.29z"
            />
          </svg>
        </div>

        {/* Message */}
        <div>
          <p className="text-sm font-semibold text-slate-800">
            The PDF viewer encountered an error
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-xs">
            {error?.message
              ? `Error: ${error.message}`
              : 'An unexpected error occurred while rendering the document.'}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={this.handleRetry}
            className="btn-secondary text-sm"
            aria-label="Retry loading PDF"
            data-testid="pdf-error-retry-btn"
          >
            Try again
          </button>
          <a
            href={url}
            download={fileName}
            className="btn-primary text-sm"
            aria-label={`Download ${fileName}`}
            data-testid="pdf-error-download-link"
          >
            Download {fileName}
          </a>
        </div>
      </div>
    );
  }
}
