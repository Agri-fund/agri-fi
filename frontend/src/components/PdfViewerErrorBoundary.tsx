'use client';

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
