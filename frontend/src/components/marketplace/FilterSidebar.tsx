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
  
  // Sustainability & ESG Filters (#1185)
  const [minEsgScore, setMinEsgScore] = useState(searchParams.get('minEsgScore') || '');
  const [esgRating, setEsgRating] = useState(searchParams.get('esgRating') || 'all');
  const [certification, setCertification] = useState(searchParams.get('certification') || 'all');
  const [carbonNeutralOnly, setCarbonNeutralOnly] = useState(searchParams.get('carbonNeutral') === 'true');

  // Keep local state in sync if URL changes
  useEffect(() => {
    setCommodity(searchParams.get('commodity') || '');
    setStatus(searchParams.get('status') || 'all');
    setMinRoi(searchParams.get('minRoi') || '');
    setMaxRoi(searchParams.get('maxRoi') || '');
    setMinEsgScore(searchParams.get('minEsgScore') || '');
    setEsgRating(searchParams.get('esgRating') || 'all');
    setCertification(searchParams.get('certification') || 'all');
    setCarbonNeutralOnly(searchParams.get('carbonNeutral') === 'true');
  }, [searchParams]);

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

    // ESG & Sustainability filter parameters
    if (minEsgScore) params.set('minEsgScore', minEsgScore);
    else params.delete('minEsgScore');

    if (esgRating && esgRating !== 'all') params.set('esgRating', esgRating);
    else params.delete('esgRating');

    if (certification && certification !== 'all') params.set('certification', certification);
    else params.delete('certification');

    if (carbonNeutralOnly) params.set('carbonNeutral', 'true');
    else params.delete('carbonNeutral');

    router.push(`${pathname}?${params.toString()}`);
  };

  const clearFilters = () => {
    router.push(pathname);
  };

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-green-100 flex flex-col gap-5">
      <div>
        <h3 className="font-semibold text-gray-800 mb-2 text-sm">Search</h3>
        <input
          type="text"
          placeholder="e.g. Cocoa, Wheat..."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
          value={commodity}
          onChange={(e) => setCommodity(e.target.value)}
        />
      </div>

      <div>
        <h3 className="font-semibold text-gray-800 mb-2 text-sm">Status</h3>
        <select
          className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="funded">Funded</option>
        </select>
      </div>

      <div>
        <h3 className="font-semibold text-gray-800 mb-2 text-sm">Expected ROI (%)</h3>
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

      {/* ── Sustainability & ESG Filters Section (#1185) ──────────────────── */}
      <div className="pt-4 border-t border-slate-100 space-y-4">
        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 uppercase tracking-wider">
          <span>🌱</span>
          <span>Sustainability & ESG</span>
        </div>

        {/* Minimum ESG Score */}
        <div>
          <label className="block font-semibold text-gray-800 text-xs mb-1.5">
            Min ESG Score
          </label>
          <select
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
            value={minEsgScore}
            onChange={(e) => setMinEsgScore(e.target.value)}
          >
            <option value="">Any Score</option>
            <option value="60">60+ (Moderate)</option>
            <option value="70">70+ (Sustainable)</option>
            <option value="80">80+ (Highly Sustainable)</option>
            <option value="90">90+ (Pioneer / AAA)</option>
          </select>
        </div>

        {/* ESG Rating Tier */}
        <div>
          <label className="block font-semibold text-gray-800 text-xs mb-1.5">
            ESG Rating
          </label>
          <select
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
            value={esgRating}
            onChange={(e) => setEsgRating(e.target.value)}
          >
            <option value="all">All Ratings</option>
            <option value="AAA">AAA (Pioneer)</option>
            <option value="AA">AA (High ESG)</option>
            <option value="A">A (Sustainable)</option>
            <option value="BBB">BBB (Moderate)</option>
          </select>
        </div>

        {/* Eco Certifications */}
        <div>
          <label className="block font-semibold text-gray-800 text-xs mb-1.5">
            Eco-Certifications
          </label>
          <select
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
            value={certification}
            onChange={(e) => setCertification(e.target.value)}
          >
            <option value="all">All Certifications</option>
            <option value="organic">🌱 Organic Certified</option>
            <option value="fair_trade">🤝 Fairtrade Certified</option>
            <option value="carbon_neutral">🌍 Carbon Neutral</option>
            <option value="rainforest_alliance">🐸 Rainforest Alliance</option>
          </select>
        </div>

        {/* Carbon Neutral Checkbox */}
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={carbonNeutralOnly}
            onChange={(e) => setCarbonNeutralOnly(e.target.checked)}
            className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
          />
          <span>100% Carbon Neutral Only</span>
        </label>
      </div>

      <div className="flex flex-col gap-2 mt-2">
        <button
          onClick={applyFilters}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 rounded-lg transition-colors text-sm"
        >
          Apply Filters
        </button>
        <button
          onClick={clearFilters}
          className="w-full bg-white hover:bg-gray-50 text-gray-600 border border-gray-200 font-medium py-2 rounded-lg transition-colors text-sm"
        >
          Clear All
        </button>
      </div>
    </div>
  );
}
