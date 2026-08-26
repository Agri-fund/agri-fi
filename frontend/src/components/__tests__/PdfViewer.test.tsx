/**
 * PdfViewer unit tests
 *
 * Covers:
 *  - WASM-supported path (react-pdf renderer)
 *  - WASM-absent path for non-sensitive docs (Google Docs iframe fallback)
 *  - WASM-absent path for sensitive docs (download-only fallback)
 *  - Detection-phase skeleton (null WASM state)
 *  - PdfViewerErrorBoundary (catch + retry)
 *  - useWasmSupport hook / detectWasm utility
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── react-pdf mock ────────────────────────────────────────────────────────────
// Prevents loading the full PDF.js WASM engine inside Jest.

jest.mock('react-pdf', () => ({
  Document: ({ onLoadSuccess, onLoadError, children }: any) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    React.useEffect(() => {
      onLoadSuccess?.({ numPages: 3 });
    // onLoadSuccess changes identity on every render; intentionally using []
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: ({ pageNumber }: any) => (
    <div data-testid={`pdf-page-${pageNumber}`}>Page {pageNumber}</div>
  ),
  pdfjs: { GlobalWorkerOptions: {} },
}));

jest.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}));
jest.mock('react-pdf/dist/Page/TextLayer.css', () => ({}));

// ── useWasmSupport mock factory ───────────────────────────────────────────────
// Default: WASM is supported. Override per-test with mockReturnValue.

const mockUseWasmSupport = jest.fn<boolean | null, []>(() => true);
jest.mock('@/hooks/useWasmSupport', () => ({
  ...jest.requireActual('@/hooks/useWasmSupport'),
  useWasmSupport: () => mockUseWasmSupport(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { PdfViewer, IframeFallback } from '../PdfViewer';
import { PdfViewerErrorBoundary } from '../PdfViewerErrorBoundary';
import { detectWasm } from '@/hooks/useWasmSupport';

const TEST_URL  = 'https://ipfs.io/ipfs/QmTest123/document.pdf';
const TEST_NAME = 'trade-agreement.pdf';

// ─────────────────────────────────────────────────────────────────────────────
// 1. detectWasm() utility
// ─────────────────────────────────────────────────────────────────────────────

describe('detectWasm()', () => {
  it('returns true when WebAssembly is fully available', () => {
    // jsdom exposes a real WebAssembly object
    expect(detectWasm()).toBe(true);
  });

  it('returns false when WebAssembly global is absent', () => {
    const orig = (global as any).WebAssembly;
    delete (global as any).WebAssembly;
    expect(detectWasm()).toBe(false);
    (global as any).WebAssembly = orig;
  });

  it('returns false when WebAssembly.validate throws', () => {
    const orig = (global as any).WebAssembly;
    (global as any).WebAssembly = {
      instantiate: () => {},
      validate: () => { throw new Error('WASM validate error'); },
    };
    expect(detectWasm()).toBe(false);
    (global as any).WebAssembly = orig;
  });

  it('returns false when WebAssembly.validate returns false', () => {
    const orig = (global as any).WebAssembly;
    (global as any).WebAssembly = {
      instantiate: () => {},
      validate: () => false,
    };
    expect(detectWasm()).toBe(false);
    (global as any).WebAssembly = orig;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Detection-phase skeleton (wasmSupported === null)
// ─────────────────────────────────────────────────────────────────────────────

describe('PdfViewer – detection phase (null)', () => {
  beforeEach(() => mockUseWasmSupport.mockReturnValue(null));
  afterEach(() => mockUseWasmSupport.mockReturnValue(true));

  it('renders the detecting skeleton while WASM support is unknown', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    expect(screen.getByTestId('pdf-viewer-detecting')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading document viewer');
  });

  it('does NOT render the WASM viewer during detection', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    expect(screen.queryByTestId('pdf-viewer-wasm')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WASM supported → react-pdf renderer
// ─────────────────────────────────────────────────────────────────────────────

describe('PdfViewer – WASM supported (react-pdf renderer)', () => {
  beforeEach(() => mockUseWasmSupport.mockReturnValue(true));

  it('renders with the provided file name', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    expect(screen.getByText(TEST_NAME)).toBeInTheDocument();
  });

  it('renders the WASM viewer container', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    expect(screen.getByTestId('pdf-viewer-wasm')).toBeInTheDocument();
  });

  it('shows page count after document loads', async () => {
    render(<PdfViewer url={TEST_URL} />);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
  });

  it('renders the first page initially', async () => {
    render(<PdfViewer url={TEST_URL} />);
    expect(await screen.findByTestId('pdf-page-1')).toBeInTheDocument();
  });

  it('navigates to the next page when the next button is clicked', async () => {
    const user = userEvent.setup();
    render(<PdfViewer url={TEST_URL} />);
    await screen.findByText('1 / 3');
    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('disables the previous button on the first page', async () => {
    render(<PdfViewer url={TEST_URL} />);
    await screen.findByText('1 / 3');
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
  });

  it('disables the next button on the last page', async () => {
    const user = userEvent.setup();
    render(<PdfViewer url={TEST_URL} />);
    await screen.findByText('1 / 3');
    await user.click(screen.getByRole('button', { name: /next page/i }));
    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  it('increments and decrements zoom', async () => {
    const user = userEvent.setup();
    render(<PdfViewer url={TEST_URL} />);
    await screen.findByText('1 / 3');

    const resetBtn = screen.getByRole('button', { name: /reset zoom/i });
    expect(resetBtn).toHaveTextContent('100%');

    await user.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(resetBtn).toHaveTextContent('125%');

    await user.click(screen.getByRole('button', { name: /zoom out/i }));
    expect(resetBtn).toHaveTextContent('100%');
  });

  it('has an accessible region label', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    expect(
      screen.getByRole('region', { name: `PDF viewer: ${TEST_NAME}` }),
    ).toBeInTheDocument();
  });

  it('provides a download link pointing to the PDF URL', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    expect(screen.getByRole('link', { name: /download pdf/i })).toHaveAttribute('href', TEST_URL);
  });

  it('applies a custom className to the outer wrapper', () => {
    const { container } = render(<PdfViewer url={TEST_URL} className="my-custom-class" />);
    expect(container.firstChild).toHaveClass('my-custom-class');
  });

  it('does NOT render the iframe fallback when WASM is available', () => {
    render(<PdfViewer url={TEST_URL} />);
    expect(screen.queryByTestId('pdf-viewer-iframe-fallback')).not.toBeInTheDocument();
  });

  it('does NOT render the sensitive fallback when WASM is available', () => {
    render(<PdfViewer url={TEST_URL} isSensitive />);
    expect(screen.queryByTestId('pdf-viewer-sensitive-fallback')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. WASM absent, non-sensitive doc → Google Docs iframe fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('PdfViewer – WASM absent, non-sensitive (iframe fallback)', () => {
  beforeEach(() => mockUseWasmSupport.mockReturnValue(false));
  afterEach(() => mockUseWasmSupport.mockReturnValue(true));

  it('renders the iframe fallback container', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    expect(screen.getByTestId('pdf-viewer-iframe-fallback')).toBeInTheDocument();
  });

  it('does NOT render the WASM viewer', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    expect(screen.queryByTestId('pdf-viewer-wasm')).not.toBeInTheDocument();
  });

  it('embeds a Google Docs viewer iframe with the encoded PDF URL', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    const iframe = screen.getByTestId('pdf-google-docs-iframe') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toContain('docs.google.com/viewer');
    expect(iframe.src).toContain(encodeURIComponent(TEST_URL));
  });

  it('has a download link in the toolbar', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    expect(screen.getByTestId('pdf-download-link')).toHaveAttribute('href', TEST_URL);
  });

  it('has an accessible region label', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} />);
    expect(
      screen.getByRole('region', { name: `PDF viewer (preview): ${TEST_NAME}` }),
    ).toBeInTheDocument();
  });

  it('shows a download fallback when the iframe is in error state', () => {
    // jsdom cannot fire React synthetic onError on iframes (known limitation).
    // We test the error-state UI directly via the exported IframeFallback
    // component with _testIframeError=true.
    render(
      <IframeFallback
        url={TEST_URL}
        fileName={TEST_NAME}
        _testIframeError
      />,
    );
    expect(screen.getByTestId('pdf-download-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-google-docs-iframe')).not.toBeInTheDocument();
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. WASM absent, sensitive doc → download-only fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('PdfViewer – WASM absent, sensitive document', () => {
  beforeEach(() => mockUseWasmSupport.mockReturnValue(false));
  afterEach(() => mockUseWasmSupport.mockReturnValue(true));

  it('renders the sensitive fallback when isSensitive=true', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} isSensitive />);
    expect(screen.getByTestId('pdf-viewer-sensitive-fallback')).toBeInTheDocument();
  });

  it('does NOT render the iframe fallback for sensitive docs', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} isSensitive />);
    expect(screen.queryByTestId('pdf-viewer-iframe-fallback')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pdf-google-docs-iframe')).not.toBeInTheDocument();
  });

  it('shows a direct download link (no Google Docs proxy)', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} isSensitive />);
    const link = screen.getByTestId('pdf-sensitive-download-link');
    expect(link).toHaveAttribute('href', TEST_URL);
    // Must NOT be a Google Docs URL
    expect(link).not.toHaveAttribute('href', expect.stringContaining('docs.google.com'));
  });

  it('displays the file name in the fallback', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} isSensitive />);
    expect(screen.getByText(TEST_NAME)).toBeInTheDocument();
  });

  it('shows confidentiality messaging', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} isSensitive />);
    expect(screen.getByText(/confidential/i)).toBeInTheDocument();
  });

  it('does NOT render the WASM viewer for sensitive docs', () => {
    render(<PdfViewer url={TEST_URL} fileName={TEST_NAME} isSensitive />);
    expect(screen.queryByTestId('pdf-viewer-wasm')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. PdfViewerErrorBoundary
// ─────────────────────────────────────────────────────────────────────────────

/** A component that always throws during render – used to trigger the boundary */
const BrokenPdfViewer: React.FC<{ message?: string }> = ({ message = 'WASM init failed' }) => {
  throw new Error(message);
};

// React will log the error to console.error; suppress to keep test output clean
const suppressConsoleError = () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  return spy;
};

describe('PdfViewerErrorBoundary', () => {
  it('renders children normally when there is no error', () => {
    render(
      <PdfViewerErrorBoundary url={TEST_URL} fileName={TEST_NAME}>
        <div data-testid="healthy-child">PDF content</div>
      </PdfViewerErrorBoundary>,
    );
    expect(screen.getByTestId('healthy-child')).toBeInTheDocument();
  });

  it('catches a render error and shows the fallback UI', () => {
    const spy = suppressConsoleError();
    render(
      <PdfViewerErrorBoundary url={TEST_URL} fileName={TEST_NAME}>
        <BrokenPdfViewer />
      </PdfViewerErrorBoundary>,
    );
    expect(screen.getByTestId('pdf-viewer-error-boundary')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('displays the error message in the fallback UI', () => {
    const spy = suppressConsoleError();
    render(
      <PdfViewerErrorBoundary url={TEST_URL} fileName={TEST_NAME}>
        <BrokenPdfViewer message="Corrupt PDF stream" />
      </PdfViewerErrorBoundary>,
    );
    expect(screen.getByText(/corrupt pdf stream/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('provides a download link in the fallback UI', () => {
    const spy = suppressConsoleError();
    render(
      <PdfViewerErrorBoundary url={TEST_URL} fileName={TEST_NAME}>
        <BrokenPdfViewer />
      </PdfViewerErrorBoundary>,
    );
    expect(screen.getByTestId('pdf-error-download-link')).toHaveAttribute('href', TEST_URL);
    spy.mockRestore();
  });

  it('resets the error state and re-renders children when retry is clicked', async () => {
    const spy = suppressConsoleError();
    let shouldThrow = true;

    const ConditionallyBroken: React.FC = () => {
      if (shouldThrow) throw new Error('Initial failure');
      return <div data-testid="recovered-child">Recovered</div>;
    };

    const { rerender } = render(
      <PdfViewerErrorBoundary url={TEST_URL} fileName={TEST_NAME}>
        <ConditionallyBroken />
      </PdfViewerErrorBoundary>,
    );

    // Error boundary is visible
    expect(screen.getByTestId('pdf-viewer-error-boundary')).toBeInTheDocument();

    // Fix the throwing condition before retrying
    shouldThrow = false;
    await userEvent.click(screen.getByTestId('pdf-error-retry-btn'));

    // After retry, the recovered child should be visible
    expect(await screen.findByTestId('recovered-child')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-viewer-error-boundary')).not.toBeInTheDocument();

    spy.mockRestore();
  });

  it('invokes the optional onError callback when an error is caught', () => {
    const spy = suppressConsoleError();
    const onError = jest.fn();

    render(
      <PdfViewerErrorBoundary url={TEST_URL} fileName={TEST_NAME} onError={onError}>
        <BrokenPdfViewer message="Test error" />
      </PdfViewerErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    const [error] = onError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Test error');

    spy.mockRestore();
  });

  it('hides children after catching an error', () => {
    const spy = suppressConsoleError();
    render(
      <PdfViewerErrorBoundary url={TEST_URL} fileName={TEST_NAME}>
        <BrokenPdfViewer />
      </PdfViewerErrorBoundary>,
    );
    expect(screen.queryByTestId('pdf-document')).not.toBeInTheDocument();
    spy.mockRestore();
  });
});
