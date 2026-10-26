'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Sparkles, X } from 'lucide-react';
import type { SearchSuggestion, SuggestionKind } from '@/lib/advanced-search/types';

const GROUP_ORDER: SuggestionKind[] = ['commodity', 'region', 'template', 'field', 'recent', 'value'];

const GROUP_LABELS: Record<SuggestionKind, string> = {
  commodity: 'Commodities',
  region: 'Regions & countries',
  template: 'Natural-language examples',
  field: 'Filters',
  recent: 'Recent',
  value: 'Values',
};

export interface AdvancedSearchBarProps {
  query: string;
  onChange: (value: string) => void;
  suggestions: SearchSuggestion[];
  interpretedAs: string[];
  onSubmit?: () => void;
}

interface Grouped {
  kind: SuggestionKind;
  items: SearchSuggestion[];
  startIndex: number;
}

export default function AdvancedSearchBar({
  query,
  onChange,
  suggestions,
  interpretedAs,
  onSubmit,
}: AdvancedSearchBarProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Flatten by group so keyboard navigation follows the visible order.
  const groups: Grouped[] = [];
  let running = 0;
  for (const kind of GROUP_ORDER) {
    const items = suggestions.filter((s) => s.kind === kind);
    if (items.length === 0) continue;
    groups.push({ kind, items, startIndex: running });
    running += items.length;
  }
  const flat = groups.flatMap((g) => g.items);

  const commit = useCallback(
    (value: string) => {
      onChange(value);
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.focus();
    },
    [onChange],
  );

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && flat[activeIndex]) {
        e.preventDefault();
        commit(flat[activeIndex].text);
      } else {
        setOpen(false);
        onSubmit?.();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const expanded = open && flat.length > 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-label="Advanced natural-language search"
          aria-expanded={expanded}
          aria-controls="advanced-search-suggestions"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `advanced-suggestion-${activeIndex}` : undefined}
          placeholder="Ask in plain language, e.g. cocoa deals in Africa with ROI above 15%"
          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-16 text-sm text-slate-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {query && (
            <button
              type="button"
              onClick={() => onChange('')}
              aria-label="Clear search"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <Sparkles className="h-4 w-4 text-emerald-500" aria-hidden="true" />
        </div>
      </div>

      {interpretedAs.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Query interpreted as">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Interpreted as
          </span>
          {interpretedAs.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <ul
          id="advanced-search-suggestions"
          role="listbox"
          aria-label="Search suggestions"
          className="absolute z-50 mt-1 max-h-96 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {groups.map((group) => (
            <li key={group.kind} role="presentation">
              <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {GROUP_LABELS[group.kind]}
              </p>
              {group.items.map((item, i) => {
                const globalIndex = group.startIndex + i;
                return (
                  <button
                    key={`${item.kind}-${item.text}`}
                    type="button"
                    id={`advanced-suggestion-${globalIndex}`}
                    role="option"
                    aria-selected={globalIndex === activeIndex}
                    onMouseEnter={() => setActiveIndex(globalIndex)}
                    onClick={() => commit(item.text)}
                    className={`block w-full px-3 py-2 text-left text-sm ${
                      globalIndex === activeIndex
                        ? 'bg-slate-100 dark:bg-slate-800'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <span className="text-slate-800 dark:text-slate-100">{item.text}</span>
                  </button>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
