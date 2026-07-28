'use client';

import React, { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// react-pdf requires a PDF.js worker. Point to the bundled worker so there is
// no need for a separate CDN request and the viewer works entirely in-origin,
// satisfying the "Document viewing remains secure" acceptance criterion.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface PdfViewerProps {
  /**
   * URL of the PDF to display.
   * Can be a fully-qualified URL (https://…), an IPFS gateway URL, or a
   * relative path served by the Next.js API proxy.
   */
  url: string;
  /** Optional display name shown in the viewer toolbar. */
  fileName?: string;
  /** Optional Tailwind class overrides for the outer wrapper. */
  className?: string;
}

/**
 * PdfViewer
 *
 * Renders a PDF document inline inside the user interface, satisfying the
 * Issue #721 acceptance criteria:
 *   ✓ PDFs render inside the user interface frame.
 *   ✓ Document viewing remains secure (worker is served from the same origin).
 *
 * Uses `react-pdf` (which wraps PDF.js) to parse and render each page as a
 * <canvas> element. Navigation controls let the user step through all pages.
 *
 * @example
 * <PdfViewer url="https://ipfs.io/ipfs/Qm…" fileName="trade-agreement.pdf" />
 */
export const PdfViewer: React.FC<PdfViewerProps> = ({
  url,
  fileName,
  className = '',
}) => {
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
  const zoomIn = () => setScale((s) => Math.min(+(s + 0.25).toFixed(2), 3.0));
  const zoomOut = () => setScale((s) => Math.max(+(s - 0.25).toFixed(2), 0.5));
  const resetZoom = () => setScale(1.0);

  return (
    <div
      className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden ${className}`}
      role="region"
      aria-label={fileName ? `PDF viewer: ${fileName}` : 'PDF viewer'}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
        {/* File name */}
        <span className="truncate text-sm font-medium text-slate-700 max-w-[40%]">
          {fileName ?? 'Document'}
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

          {/* Download link */}
          <a
            href={url}
            download={fileName}
            target="_blank"
            rel="noopener noreferrer"
            className="toolbar-btn ml-2"
            aria-label="Download PDF"
          >
            <DownloadIcon />
          </a>
        </div>
      </div>

      {/* Document area */}
      <div className="flex-1 overflow-auto bg-slate-100 flex justify-center p-4 min-h-[400px]">
        {/* Loading skeleton */}
        {isLoading && !loadError && (
          <div className="w-full max-w-2xl space-y-3 py-6">
            <div className="h-8 w-3/4 mx-auto skeleton rounded-lg" />
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-4 skeleton rounded" />
            ))}
          </div>
        )}

        {/* Error state */}
        {loadError && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <DocumentErrorIcon />
            <p className="text-sm font-medium text-red-600">
              Could not load document
            </p>
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

        {/* react-pdf Document / Page */}
        {!loadError && (
          <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={null /* we handle loading state above */}
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
