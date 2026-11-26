'use client';

import React, { useState } from 'react';
import { CarbonFootprint } from '@/types/sustainability';

interface CarbonFootprintCalculatorProps {
  onCalculate: (footprint: CarbonFootprint) => void;
}

export const CarbonFootprintCalculator: React.FC<
  CarbonFootprintCalculatorProps
> = ({ onCalculate }) => {
  const [transportation, setTransportation] = useState(0);
  const [storage, setStorage] = useState(0);
  const [processing, setProcessing] = useState(0);
  const [unit, setUnit] = useState<'kg' | 'tons'>('kg');

  const handleCalculate = () => {
    const total = transportation + storage + processing;
    const footprint: CarbonFootprint = {
      transportation,
      storage,
      processing,
      total,
      unit,
    };
    onCalculate(footprint);
  };

  return (
    <div className="carbon-calculator space-y-4 p-4 border rounded-lg">
      <h3 className="text-lg font-semibold">Carbon Footprint Calculator</h3>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">
            Transportation Emissions
          </label>
          <input
            type="number"
            value={transportation}
            onChange={(e) => setTransportation(Number(e.target.value))}
            className="w-full px-3 py-2 border rounded"
            min="0"
            step="0.01"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Storage Emissions
          </label>
          <input
            type="number"
            value={storage}
            onChange={(e) => setStorage(Number(e.target.value))}
            className="w-full px-3 py-2 border rounded"
            min="0"
            step="0.01"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Processing Emissions
          </label>
          <input
            type="number"
            value={processing}
            onChange={(e) => setProcessing(Number(e.target.value))}
            className="w-full px-3 py-2 border rounded"
            min="0"
            step="0.01"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Unit</label>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as 'kg' | 'tons')}
            className="w-full px-3 py-2 border rounded"
          >
            <option value="kg">Kilograms (kg)</option>
            <option value="tons">Tons</option>
          </select>
        </div>

        <div className="pt-2">
          <div className="text-sm text-gray-600 mb-2">
            Total: {(transportation + storage + processing).toFixed(2)} {unit}
          </div>
          <button
            onClick={handleCalculate}
            className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Calculate & Save
          </button>
        </div>
      </div>
    </div>
  );
};
