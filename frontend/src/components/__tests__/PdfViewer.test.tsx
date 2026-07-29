import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock react-pdf to avoid loading the full PDF.js engine in Jest
jest.mock('react-pdf', () => ({
  Document: ({ onLoadSuccess, children }: any) => {
    // Simulate successful PDF load with 3 pages
    React.useEffect(() => {
      onLoadSuccess?.({ numPages: 3 });
    }, [onLoadSuccess]);
    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: ({ pageNumber }: any) => (
    <div data-testid={`pdf-page-${pageNumber}`}>Page {pageNumber}</div>
  ),
  pdfjs: { GlobalWorkerOptions: {} },
}));

// Stub the CSS imports that react-pdf expects
jest.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}));
jest.mock('react-pdf/dist/Page/TextLayer.css', () => ({}));

import { PdfViewer } from '../PdfViewer';

const TEST_URL = 'https://ipfs.io/ipfs/QmTest123/document.pdf';

describe('PdfViewer', () => {
  it('renders the viewer with the provided file name', () => {
    render(<PdfViewer url={TEST_URL} fileName="trade-agreement.pdf" />);
    expect(screen.getByText('trade-agreement.pdf')).toBeInTheDocument();
  });

  it('shows page count after document loads', async () => {
    render(<PdfViewer url={TEST_URL} />);
    // After the mock triggers onLoadSuccess with numPages=3
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
  });

  it('renders the first page initially', async () => {
    render(<PdfViewer url={TEST_URL} />);
    expect(await screen.findByTestId('pdf-page-1')).toBeInTheDocument();
  });

  it('navigates to the next page when next button is clicked', async () => {
    const user = userEvent.setup();
    render(<PdfViewer url={TEST_URL} />);
    // Wait for load
    await screen.findByText('1 / 3');
    const nextBtn = screen.getByRole('button', { name: /next page/i });
    await user.click(nextBtn);
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('disables the previous button on the first page', async () => {
    render(<PdfViewer url={TEST_URL} />);
    await screen.findByText('1 / 3');
    const prevBtn = screen.getByRole('button', { name: /previous page/i });
    expect(prevBtn).toBeDisabled();
  });

  it('provides a download link', () => {
    render(<PdfViewer url={TEST_URL} fileName="doc.pdf" />);
    const link = screen.getByRole('link', { name: /download pdf/i });
    expect(link).toHaveAttribute('href', TEST_URL);
  });

  it('renders with accessible region role', () => {
    render(<PdfViewer url={TEST_URL} fileName="doc.pdf" />);
    expect(screen.getByRole('region', { name: /PDF viewer: doc.pdf/i })).toBeInTheDocument();
  });

  it('applies custom className to the outer wrapper', () => {
    const { container } = render(<PdfViewer url={TEST_URL} className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
