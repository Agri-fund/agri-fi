'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredToken } from '@/lib/api';

interface SearchResultItem {
  id: string;
  type: 'deals' | 'farmers' | 'documents';
  title: string;
  snippet: string;
  score: number;
  metadata?: Record<string, unknown>;
}

interface SearchResponse {
  deals: SearchResultItem[];
  farmers: SearchResultItem[];
  documents: SearchResultItem[];
}

const TYPE_LABELS: Record<string, string> = {
  deals: 'Deals',
  farmers: 'Farmers',
  documents: 'Documents',
};

const TYPE_ROUTES: Record<string, (id: string) => string> = {
  deals: (id) => `/deals/${id}`,
  farmers: (id) => `/dashboard/farmer?id=${id}`,
  documents: (id) => `/dashboard/documents?doc=${id}`,
};

export default function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const flatResults = results
    ? [...results.deals, ...results.farmers, ...results.documents]
    : [];

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&limit=10`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setOpen(true);
        setActiveIndex(-1);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navigateTo = (item: SearchResultItem) => {
    setOpen(false);
    setQuery('');
    router.push(TYPE_ROUTES[item.type]?.(item.id) ?? '/');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || flatResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      navigateTo(flatResults[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const renderSection = (type: keyof SearchResponse, items: SearchResultItem[]) => {
    if (items.length === 0) return null;
    let offset = 0;
    if (type === 'farmers') offset = results!.deals.length;
    if (type === 'documents') offset = results!.deals.length + results!.farmers.length;

    return (
      <div key={type}>
        <p className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          {TYPE_LABELS[type]}
        </p>
        {items.map((item, i) => {
          const globalIndex = offset + i;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={activeIndex === globalIndex}
              onClick={() => navigateTo(item)}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                activeIndex === globalIndex ? 'bg-slate-100' : ''
              }`}
            >
              <p className="font-medium text-slate-900 truncate">{item.title}</p>
              <p
                className="text-xs text-slate-500 truncate"
                dangerouslySetInnerHTML={{ __html: item.snippet }}
              />
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search deals, farmers, documents…"
          aria-label="Search"
          aria-expanded={open}
          aria-controls="search-results"
          role="combobox"
          className="w-full pl-9 pr-3 py-2 text-sm bg-slate-100 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            …
          </span>
        )}
      </div>

      {open && results && (
        <div
          id="search-results"
          role="listbox"
          className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-80 overflow-y-auto"
        >
          {flatResults.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500 text-center">No results found</p>
          ) : (
            <>
              {renderSection('deals', results.deals)}
              {renderSection('farmers', results.farmers)}
              {renderSection('documents', results.documents)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}
