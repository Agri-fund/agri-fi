"use client";

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState, useEffect } from 'react';

export default function FilterSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [commodity, setCommodity] = useState(searchParams.get('commodity') || '');
  const [status, setStatus] = useState(searchParams.get('status') || 'all');
  const [minRoi, setMinRoi] = useState(searchParams.get('minRoi') || '');
  const [maxRoi, setMaxRoi] = useState(searchParams.get('maxRoi') || '');

  // Keep local state in sync if URL changes
  useEffect(() => {
    setCommodity(searchParams.get('commodity') || '');
    setStatus(searchParams.get('status') || 'all');
    setMinRoi(searchParams.get('minRoi') || '');
    setMaxRoi(searchParams.get('maxRoi') || '');
  }, [searchParams]);

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      return params.toString();
    },
    [searchParams]
  );

  const applyFilters = () => {
    let params = new URLSearchParams(searchParams.toString());
    
    if (commodity) params.set('commodity', commodity);
    else params.delete('commodity');

    if (status && status !== 'all') params.set('status', status);
    else params.delete('status');

    if (minRoi) params.set('minRoi', minRoi);
    else params.delete('minRoi');

    if (maxRoi) params.set('maxRoi', maxRoi);
    else params.delete('maxRoi');

    router.push(`${pathname}?${params.toString()}`);
  };

  const clearFilters = () => {
    router.push(pathname);
  };

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-green-100 flex flex-col gap-6">
      <div>
        <h3 className="font-semibold text-gray-800 mb-3">Search</h3>
        <input
          type="text"
          placeholder="e.g. Cocoa, Wheat..."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
          value={commodity}
          onChange={(e) => setCommodity(e.target.value)}
        />
      </div>

      <div>
        <h3 className="font-semibold text-gray-800 mb-3">Status</h3>
        <select
          className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="funded">Funded</option>
        </select>
      </div>

      <div>
        <h3 className="font-semibold text-gray-800 mb-3">Expected ROI (%)</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="Min"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
            value={minRoi}
            onChange={(e) => setMinRoi(e.target.value)}
            min="0"
          />
          <span className="text-gray-400">-</span>
          <input
            type="number"
            placeholder="Max"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
            value={maxRoi}
            onChange={(e) => setMaxRoi(e.target.value)}
            min="0"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-2">
        <button
          onClick={applyFilters}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 rounded-lg transition-colors"
        >
          Apply Filters
        </button>
        <button
          onClick={clearFilters}
          className="w-full bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 font-medium py-2 rounded-lg transition-colors"
        >
          Clear All
        </button>
      </div>
    </div>
  );
}
