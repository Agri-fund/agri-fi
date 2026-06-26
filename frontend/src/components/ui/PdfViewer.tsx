'use client';

import React, { useState, useRef } from 'react';

interface PdfViewerProps {
  /** URL of the PDF to display */
  url: string;
  /** Display name shown in the toolbar */
  fileName?: string;
  className?: string;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ url, fileName = 'document.pdf', className = '' }) => {
  const [zoom, setZoom]       = useState(100);
  const [rotation, setRotation] = useState(0);
  const [supported, setSupported] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const zoomIn  = () => setZoom(z => Math.min(z + 25, 200));
  const zoomOut = () => setZoom(z => Math.max(z - 25, 50));
  const rotate  = () => setRotation(r => (r + 90) % 360);

  const handlePrint = () => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.focus();
      win.print();
    } else {
      // Fallback: open in new tab and print
      const w = window.open(url);
      w?.print();
    }
  };

  // Build the embed URL — append zoom param for browsers that support it
  const embedUrl = `${url}#zoom=${zoom}`;

  return (
    <div className={`flex flex-col rounded-2xl border border-slate-200 overflow-hidden bg-slate-50 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white border-b border-slate-100 flex-wrap">
        <p className="text-sm font-medium text-slate-700 truncate max-w-[200px]" title={fileName}>
          📄 {fileName}
        </p>

        <div className="flex items-center gap-1.5">
          {/* Zoom out */}
          <button
            onClick={zoomOut}
            disabled={zoom <= 50}
            className="btn-secondary px-2.5 py-1.5 text-xs disabled:opacity-40"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0zM8 11h6" />
            </svg>
          </button>

          <span className="text-xs font-mono text-slate-500 w-12 text-center">{zoom}%</span>

          {/* Zoom in */}
          <button
            onClick={zoomIn}
            disabled={zoom >= 200}
            className="btn-secondary px-2.5 py-1.5 text-xs disabled:opacity-40"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0zM11 8v6M8 11h6" />
            </svg>
          </button>

          {/* Rotate */}
          <button
            onClick={rotate}
            className="btn-secondary px-2.5 py-1.5 text-xs"
            title="Rotate 90°"
            aria-label="Rotate document"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          {/* Print */}
          <button
            onClick={handlePrint}
            className="btn-secondary px-2.5 py-1.5 text-xs"
            title="Print"
            aria-label="Print document"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
          </button>

          {/* Download fallback */}
          <a
            href={url}
            download={fileName}
            className="btn-secondary px-2.5 py-1.5 text-xs"
            title="Download"
            aria-label="Download document"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
        </div>
      </div>

      {/* PDF embed area */}
      {supported ? (
        <div
          className="flex-1 overflow-auto bg-slate-200 flex items-start justify-center p-4"
          style={{ minHeight: '500px' }}
        >
          <div
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: 'center center',
              transition: 'transform 0.3s ease',
              width: `${zoom}%`,
              maxWidth: '100%',
            }}
          >
            <iframe
              ref={iframeRef}
              src={embedUrl}
              title={fileName}
              className="w-full border-0 rounded-lg shadow-card"
              style={{ height: '70vh', minHeight: '400px' }}
              onError={() => setSupported(false)}
            />
          </div>
        </div>
      ) : (
        /* Fallback when browser doesn't support PDF embedding */
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-3xl">
            📄
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">PDF preview not supported</p>
            <p className="text-xs text-slate-400 mt-1">Your browser doesn&apos;t support inline PDF viewing.</p>
          </div>
          <a
            href={url}
            download={fileName}
            className="btn-primary text-sm"
          >
            Download {fileName}
          </a>
        </div>
      )}
    </div>
  );
};
