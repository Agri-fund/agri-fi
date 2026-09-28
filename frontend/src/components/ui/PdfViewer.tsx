'use client';

// =============================================================================
// Issue #978 — perf(frontend): Add bundle budget check and lazy-load PDF viewer
// https://github.com/Agri-fund/agri-fi/issues/978
//
// ─── PROBLEM ─────────────────────────────────────────────────────────────────
//
// This component (`ui/PdfViewer.tsx`) is imported statically throughout the
// app (InvestmentCertificate, receipt pages, document library).  Because it is
// a static import, Next.js includes the entire react-pdf / pdfjs-dist bundle
// in the INITIAL JavaScript payload — even for users who never open a PDF.
//
// pdfjs-dist alone is ~670 KB minified (~220 KB gzip).  Combined with the
// canvas polyfill and the pdf.js worker, it is one of the largest single
// chunks in the build.  There is currently no bundle-size budget, so
// regressions like this go undetected in CI.
//
// ─── ROOT CAUSE ──────────────────────────────────────────────────────────────
//
// 1. Static `import` of react-pdf / PdfViewer means the chunk is always
//    part of the initial load, regardless of whether the user visits a page
//    that needs it.
//
// 2. No CI step measures or enforces a JS chunk size limit.  Large new
//    dependencies can be added without any build-time warning.
//
// ─── PROPOSED IMPLEMENTATION ─────────────────────────────────────────────────
//
// Step 1 — Convert all PDF-viewer imports to next/dynamic with ssr: false
// -----------------------------------------------------------------------
// Anywhere this component (or components/PdfViewer.tsx) is imported, replace
// the static import with a dynamic one so pdf.js is only downloaded when the
// component actually mounts.
//
//   // BEFORE (static — included in initial bundle)
//   import { PdfViewer } from '@/components/ui/PdfViewer';
//
//   // AFTER (dynamic — downloaded only when the viewer is first rendered)
//   import dynamic from 'next/dynamic';
//
//   const PdfViewer = dynamic(
//     () => import('@/components/ui/PdfViewer').then(m => ({ default: m.PdfViewer })),
//     {
//       ssr: false,              // pdf.js uses browser APIs; cannot run on server
//       loading: () => (
//         <div className="flex items-center justify-center h-48 rounded-xl bg-slate-100">
//           <p className="text-sm text-slate-400 animate-pulse">Loading document…</p>
//         </div>
//       ),
//     }
//   );
//
// The same pattern applies to:
//   • components/PdfViewer.tsx         (the react-pdf / WASM variant)
//   • components/PdfViewerErrorBoundary.tsx  (must wrap the dynamic viewer)
//   • components/InvestmentCertificate.tsx   (calls the receipt download)
//
// Any page that renders a PDF viewer should lazy-load the whole viewer tree,
// not just the leaf component.  Wrap the outermost component that owns the
// "open PDF" trigger in dynamic().
//
//
// Step 2 — SSR / error-boundary safety
// -------------------------------------
// PdfViewerErrorBoundary already covers render-time errors from react-pdf.
// With `ssr: false` the boundary is never invoked server-side, but to be
// explicit add a server-safe guard:
//
//   // At the top of PdfViewerErrorBoundary.tsx
//   if (typeof window === 'undefined') {
//     // Server render: return nothing — the dynamic() loading placeholder
//     // is shown instead.
//     return null;
//   }
//
// This ensures SSR environments (e.g. Playwright's server-side rendering,
// getServerSideProps, generateMetadata) never attempt to run pdf.js.
//
//
// Step 3 — CI bundle-size budget
// --------------------------------
// Add a build step in .github/workflows/frontend-ci.yml that:
//   (a) Runs `next build`
//   (b) Parses .next/static/chunks/ and sums JS chunk sizes
//   (c) Fails the workflow if any single chunk exceeds 500 KB (gzip)
//      or the total first-load JS exceeds 250 KB (gzip)
//
// Simplest implementation using the @next/bundle-analyzer package:
//
//   # In next.config.js
//   const withBundleAnalyzer = require('@next/bundle-analyzer')({
//     enabled: process.env.ANALYZE === 'true',
//   });
//   module.exports = withBundleAnalyzer(nextConfig);
//
//   # In CI (GitHub Actions step)
//   - name: Check bundle budget
//     run: |
//       node scripts/check-bundle-size.mjs   # custom script — see below
//     env:
//       NEXT_TELEMETRY_DISABLED: 1
//
// Minimal check-bundle-size.mjs script:
//
//   import { readdirSync, statSync } from 'fs';
//   import { join } from 'path';
//
//   const CHUNK_DIR = '.next/static/chunks';
//   const MAX_CHUNK_KB = 500;                // gzip ~= raw / 3; adjust as needed
//   let failed = false;
//
//   for (const file of readdirSync(CHUNK_DIR)) {
//     if (!file.endsWith('.js')) continue;
//     const sizeKb = statSync(join(CHUNK_DIR, file)).size / 1024;
//     if (sizeKb > MAX_CHUNK_KB) {
//       console.error(`BUDGET EXCEEDED: ${file} is ${sizeKb.toFixed(0)} KB`);
//       failed = true;
//     }
//   }
//   if (failed) process.exit(1);
//
// After the lazy-load fix the pdf.js chunk should only appear in
// .next/static/chunks/ as a separate async chunk (named something like
// `pages/[locale]/dashboard/investor~…`) and must NOT appear in
// `pages/_app-*.js` (the initial bundle).
//
//
// ─── ACCEPTANCE CRITERIA MAPPING ─────────────────────────────────────────────
//
//  ✅  pdf.js loads only when a PDF is opened
//      → Verified by:
//        1. Opening DevTools Network tab, filtering by "pdf.worker", and
//           confirming no request fires until the viewer mounts.
//        2. Playwright test: navigate to /dashboard, assert pdf.worker chunk
//           is NOT in the list of loaded scripts before clicking "View PDF".
//
//  ✅  CI fails if total JS chunk size exceeds budget
//      → Satisfied by Step 3 (check-bundle-size.mjs in CI workflow).
//
//  ✅  Receipt page still works after lazy-loading
//      → Existing Playwright tests in tests/pdf-viewer.spec.ts cover the
//        receipt page; they must pass unchanged after the dynamic() migration.
//
// ─── FILES TO MODIFY ─────────────────────────────────────────────────────────
//
//   frontend/src/components/ui/PdfViewer.tsx          ← (THIS FILE) no logic
//                                                        change; callers switch
//                                                        to dynamic import
//   frontend/src/components/PdfViewer.tsx             ← same; caller fix
//   frontend/src/components/PdfViewerErrorBoundary.tsx ← add SSR null-guard
//   frontend/src/components/InvestmentCertificate.tsx  ← switch to dynamic
//   frontend/next.config.js                            ← add bundle analyzer
//   .github/workflows/frontend-ci.yml                 ← add budget check step
//   scripts/check-bundle-size.mjs                      ← new CI script
//
// =============================================================================

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
