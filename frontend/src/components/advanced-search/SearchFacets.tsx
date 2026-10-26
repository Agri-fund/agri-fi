'use client';

import React from 'react';
import { Filter, X } from 'lucide-react';
import type { Facet, FacetSelection } from '@/lib/advanced-search/types';

export interface SearchFacetsProps {
  facets: Facet[];
  selected: FacetSelection;
  onToggle: (groupId: string, value: string) => void;
  onClear: () => void;
}

export default function SearchFacets({ facets, selected, onToggle, onClear }: SearchFacetsProps) {
  const activeCount = Object.values(selected).reduce((n, v) => n + v.length, 0);

  if (facets.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No refinements available for this result set.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Refine results</h2>
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear ({activeCount})
          </button>
        )}
      </div>

      {facets.map((facet) => (
        <fieldset
          key={facet.id}
          className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
        >
          <legend className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {facet.label}
          </legend>
          <div className="mt-1 space-y-1">
            {facet.values.map((value) => {
              const checked = (selected[facet.id] ?? []).includes(value.value);
              const inputId = `facet-${facet.id}-${value.value}`;
              return (
                <div key={value.value} className="flex items-center justify-between">
                  <label
                    htmlFor={inputId}
                    className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(facet.id, value.value)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-800"
                    />
                    <span className={checked ? 'font-semibold text-emerald-700 dark:text-emerald-400' : ''}>
                      {value.label}
                    </span>
                  </label>
                  <span className="text-xs tabular-nums text-slate-400">{value.count}</span>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
