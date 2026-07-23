'use client';

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  windowSize?: number;
}

function buildPageWindow(page: number, totalPages: number, windowSize: number) {
  if (totalPages <= windowSize) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, page - half);
  let end = start + windowSize - 1;
  if (end > totalPages) {
    end = totalPages;
    start = end - windowSize + 1;
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export default function Pagination({
  page,
  totalPages,
  onChange,
  windowSize = 5,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const pages = buildPageWindow(page, totalPages, windowSize);
  const atFirst = page <= 1;
  const atLast = page >= totalPages;

  return (
    <nav
      aria-label="Pagination"
      className="flex justify-center items-center gap-2 mt-12"
    >
      <button
        type="button"
        disabled={atFirst}
        onClick={() => onChange(page - 1)}
        className="btn-secondary px-4 py-2 disabled:opacity-40"
        aria-label="Previous page"
      >
        ← Prev
      </button>
      <div className="flex items-center gap-1">
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`w-9 h-9 rounded-xl text-sm font-semibold transition-all ${
              p === page
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={atLast}
        onClick={() => onChange(page + 1)}
        className="btn-secondary px-4 py-2 disabled:opacity-40"
        aria-label="Next page"
      >
        Next →
      </button>
    </nav>
  );
}
