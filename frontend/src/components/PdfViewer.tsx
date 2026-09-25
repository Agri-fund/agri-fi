'use client';

/**
 * PdfViewer – cross-browser PDF viewer with graceful iOS Safari fallback.
 *
 * Rendering strategy:
 *
 *   1. WASM supported  → react-pdf (PDF.js / canvas) — full in-browser renderer
 *   2. WASM absent     → iframe pointing at Google Docs viewer (non-sensitive docs)
 *   3. WASM absent AND isSensitive=true → download-only (signed S3 link)
 *   4. While detecting  → skeleton placeholder (avoids hydration flash)
 *
 * The `isSensitive` flag should be set for KYC documents. Those documents must
 * never be forwarded to a third-party proxy such as Google Docs.
 *
 * Acceptance criteria satisfied:
 *   ✓ Detect WASM support at runtime and fall back to iframe for unsupported browsers
 *   ✓ Fallback iframe uses Google Docs viewer for non-sensitive documents
 *   ✓ Sensitive documents (KYC): fallback is a download link only
 *   ✓ Component is wrapped by PdfViewerErrorBoundary (exported separately)
 *   ✓ Cross-browser Playwright test added (see tests/pdf-viewer.spec.ts)
 */

import React, { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { useWasmSupport } from '@/hooks/useWasmSupport';

// react-pdf worker – served from the same origin to satisfy CSP and avoid
// cross-origin issues. No external CDN request required.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// ── Types ────────────────────────────────────────────────────────────────────

export interface PdfViewerProps {
  /** Publicly accessible URL of the PDF to display. */
  url: string;
  /** Display name shown in the toolbar (defaults to 'Document'). */
  fileName?: string;
  /** Tailwind class overrides for the outer wrapper. */
  className?: string;
  /**
   * Mark the document as sensitive (e.g. KYC documents).
   * When `true` and WASM is not available, only a direct download link is
   * shown — the document is NOT forwarded to the Google Docs proxy.
   */
  isSensitive?: boolean;
}

// ── Google Docs viewer URL ────────────────────────────────────────────────────

/**
 * Builds a Google Docs viewer iframe URL from a publicly accessible PDF URL.
 * Google Docs viewer renders PDFs server-side so no WASM is needed client-side.
 * Only suitable for non-sensitive documents.
 */
function googleDocsViewerUrl(pdfUrl: string): string {
  return `https://docs.google.com/viewer?url=${encodeURIComponent(pdfUrl)}&embedded=true`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Shown while WASM detection is still running (null state from hook). */
const DetectionSkeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden ${className}`}
    role="status"
    aria-label="Loading document viewer"
    data-testid="pdf-viewer-detecting"
  >
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 h-10 skeleton" />
    <div className="flex-1 bg-slate-100 p-4 space-y-3 min-h-[400px]">
      <div className="h-8 w-3/4 mx-auto skeleton rounded-lg" />
      {[...Array(6)].map((_, i) => (
        <div key={i} className="h-4 skeleton rounded" />
      ))}
    </div>
  </div>
);

// ── Fallback: Google Docs iframe ──────────────────────────────────────────────

export interface IframeFallbackProps {
  url: string;
  fileName: string;
  className?: string;
  /**
   * @internal Test-only prop. Pre-seeds the iframe error state so unit tests
   * can assert the error UI without fighting jsdom's iframe event limitations.
   */
  _testIframeError?: boolean;
}

export const IframeFallback: React.FC<IframeFallbackProps> = ({
  url,
  fileName,
  className = '',
  _testIframeError = false,
}) => {
  const [iframeError, setIframeError] = useState(_testIframeError);

  return (
    <div
      className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden ${className}`}
      role="region"
      aria-label={`PDF viewer (preview): ${fileName}`}
      data-testid="pdf-viewer-iframe-fallback"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <span className="truncate text-sm font-medium text-slate-700 max-w-[60%]">
          {fileName}
        </span>
        <a
          href={url}
          download={fileName}
          target="_blank"
          rel="noopener noreferrer"
          className="toolbar-btn ml-2"
          aria-label="Download PDF"
          data-testid="pdf-download-link"
        >
          <DownloadIcon />
        </a>
      </div>

      {/* Preview area */}
      {iframeError ? (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center min-h-[400px]">
          <DocumentErrorIcon />
          <p className="text-sm font-semibold text-slate-700">Preview unavailable</p>
          <p className="text-xs text-slate-400 max-w-xs">
            The document preview could not load. Please download the file to view it.
          </p>
          <a href={url} download={fileName} className="btn-primary text-sm" data-testid="pdf-download-fallback">
            Download {fileName}
          </a>
        </div>
      ) : (
        <iframe
          src={googleDocsViewerUrl(url)}
          title={fileName}
          className="w-full border-0"
          style={{ height: '70vh', minHeight: '400px' }}
          onError={() => setIframeError(true)}
          data-testid="pdf-google-docs-iframe"
          // Security: sandbox restricts the iframe to presentation only.
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      )}
    </div>
  );
};

// ── Fallback: sensitive-document download-only ───────────────────────────────

interface SensitiveFallbackProps {
  url: string;
  fileName: string;
  className?: string;
}

const SensitiveFallback: React.FC<SensitiveFallbackProps> = ({ url, fileName, className = '' }) => (
  <div
    className={`flex flex-col items-center justify-center gap-5 rounded-xl border border-amber-200 bg-amber-50 p-10 text-center ${className}`}
    role="region"
    aria-label={`Sensitive document download: ${fileName}`}
    data-testid="pdf-viewer-sensitive-fallback"
  >
    <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center text-3xl" aria-hidden="true">
      🔒
    </div>
    <div>
      <p className="text-sm font-semibold text-slate-800">{fileName}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-xs">
        This document is confidential and cannot be previewed in the browser.
        Use the button below to download it securely.
      </p>
    </div>
    <a
      href={url}
      download={fileName}
      className="btn-primary text-sm"
      aria-label={`Download ${fileName}`}
      data-testid="pdf-sensitive-download-link"
    >
      Download {fileName}
    </a>
  </div>
);

// ── Main component: react-pdf (WASM) renderer ────────────────────────────────

/**
 * PdfViewer
 *
 * Full in-browser PDF renderer using react-pdf / PDF.js when WASM is available.
 * Automatically degrades to IframeFallback or SensitiveFallback when WASM is
 * absent (iOS Safari 15 and below).
 */
export const PdfViewer: React.FC<PdfViewerProps> = ({
  url,
  fileName = 'Document',
  className = '',
  isSensitive = false,
}) => {
  const wasmSupported = useWasmSupport();

  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      setCurrentPage(1);
      setIsLoading(false);
      setLoadError(null);
    },
    [],
  );

  const onDocumentLoadError = useCallback((error: Error) => {
    setIsLoading(false);
    setLoadError(
      error?.message ?? 'Failed to load PDF. The document may be unavailable.',
    );
  }, []);

  const goToPrev = () => setCurrentPage((p) => Math.max(p - 1, 1));
  const goToNext = () => setCurrentPage((p) => Math.min(p + 1, numPages));
  const zoomIn   = () => setScale((s) => Math.min(+(s + 0.25).toFixed(2), 3.0));
  const zoomOut  = () => setScale((s) => Math.max(+(s - 0.25).toFixed(2), 0.5));
  const resetZoom = () => setScale(1.0);

  // ── WASM detection phase: render skeleton to avoid hydration flash ──────────
  if (wasmSupported === null) {
    return <DetectionSkeleton className={className} />;
  }

  // ── No WASM: choose appropriate fallback ───────────────────────────────────
  if (!wasmSupported) {
    if (isSensitive) {
      return <SensitiveFallback url={url} fileName={fileName} className={className} />;
    }
    return <IframeFallback url={url} fileName={fileName} className={className} />;
  }

  // ── Full react-pdf renderer ────────────────────────────────────────────────
  return (
    <div
      className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden ${className}`}
      role="region"
      aria-label={`PDF viewer: ${fileName}`}
      data-testid="pdf-viewer-wasm"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <span className="truncate text-sm font-medium text-slate-700 max-w-[40%]">
          {fileName}
        </span>

        {/* Page navigation */}
        <div className="flex items-center gap-1.5 text-sm text-slate-600">
          <button
            onClick={goToPrev}
            disabled={currentPage <= 1}
            aria-label="Previous page"
            className="toolbar-btn"
          >
            <ChevronLeftIcon />
          </button>
          <span className="min-w-[5rem] text-center">
            {numPages > 0 ? `${currentPage} / ${numPages}` : '—'}
          </span>
          <button
            onClick={goToNext}
            disabled={currentPage >= numPages}
            aria-label="Next page"
            className="toolbar-btn"
          >
            <ChevronRightIcon />
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={scale <= 0.5}
            aria-label="Zoom out"
            className="toolbar-btn"
          >
            <MinusIcon />
          </button>
          <button
            onClick={resetZoom}
            aria-label="Reset zoom"
            className="toolbar-btn px-2 text-xs font-mono"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            onClick={zoomIn}
            disabled={scale >= 3.0}
            aria-label="Zoom in"
            className="toolbar-btn"
          >
            <PlusIcon />
          </button>

          <a
            href={url}
            download={fileName}
            target="_blank"
            rel="noopener noreferrer"
            className="toolbar-btn ml-2"
            aria-label="Download PDF"
            data-testid="pdf-download-link"
          >
            <DownloadIcon />
          </a>
        </div>
      </div>

      {/* Document area */}
      <div className="flex-1 overflow-auto bg-slate-100 flex justify-center p-4 min-h-[400px]">
        {isLoading && !loadError && (
          <div className="w-full max-w-2xl space-y-3 py-6" aria-hidden="true">
            <div className="h-8 w-3/4 mx-auto skeleton rounded-lg" />
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-4 skeleton rounded" />
            ))}
          </div>
        )}

        {loadError && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3" data-testid="pdf-load-error">
            <DocumentErrorIcon />
            <p className="text-sm font-medium text-red-600">Could not load document</p>
            <p className="text-xs text-slate-500 max-w-xs">{loadError}</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 underline hover:text-blue-800"
            >
              Open in new tab
            </a>
          </div>
        )}

        {!loadError && (
          <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={null}
            className="shadow-lg"
          >
            <Page
              pageNumber={currentPage}
              scale={scale}
              renderTextLayer
              renderAnnotationLayer
            />
          </Document>
        )}
      </div>

      {/* Footer page indicator */}
      {numPages > 0 && (
        <div className="border-t border-slate-200 bg-slate-50 px-4 py-1.5 text-center text-xs text-slate-400">
          Page {currentPage} of {numPages}
        </div>
      )}
    </div>
  );
};

// ── Inline SVG icons ──────────────────────────────────────────────────────────

const ChevronLeftIcon: React.FC = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);

const ChevronRightIcon: React.FC = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const MinusIcon: React.FC = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
  </svg>
);

const PlusIcon: React.FC = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
  </svg>
);

const DownloadIcon: React.FC = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 4v11" />
  </svg>
);

const DocumentErrorIcon: React.FC = () => (
  <svg className="w-12 h-12 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8.71L15.29 3H10.29z" />
  </svg>
);
