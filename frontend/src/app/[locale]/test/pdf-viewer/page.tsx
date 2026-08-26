'use client';

/**
 * /en/test/pdf-viewer – E2E test fixture page for PdfViewer
 *
 * ONLY available outside of production. Returns 404 in production builds.
 *
 * Query params:
 *   url          PDF URL to pass to PdfViewer (default: https://example.com/sample.pdf)
 *   fileName     Display name (default: sample.pdf)
 *   sensitive    'true' | 'false' — sets isSensitive prop (default: false)
 *   forceError   'true' — wraps a component that always throws to test error boundary
 */

import { useSearchParams } from 'next/navigation';
import { PdfViewer } from '@/components/PdfViewer';
import { PdfViewerErrorBoundary } from '@/components/PdfViewerErrorBoundary';

// Guard: in production this page should not exist. The build-time check is
// done via the 404 redirect below; in dev mode it always renders.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** A component that unconditionally throws, used to trigger the error boundary. */
const AlwaysThrows: React.FC = () => {
  throw new Error('Forced error for e2e test');
};

export default function PdfViewerTestPage() {
  if (IS_PRODUCTION) {
    // Render nothing meaningful in production; the middleware/404 handles routing.
    return <div>Not found</div>;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const params      = useSearchParams();
  const url         = params.get('url')       ?? 'https://example.com/sample.pdf';
  const fileName    = params.get('fileName')  ?? 'sample.pdf';
  const isSensitive = params.get('sensitive') === 'true';
  const forceError  = params.get('forceError') === 'true';

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <h1 className="text-lg font-bold mb-6">PdfViewer E2E Fixture</h1>

      <PdfViewerErrorBoundary url={url} fileName={fileName}>
        {forceError ? (
          <AlwaysThrows />
        ) : (
          <PdfViewer
            url={url}
            fileName={fileName}
            isSensitive={isSensitive}
          />
        )}
      </PdfViewerErrorBoundary>
    </main>
  );
}
