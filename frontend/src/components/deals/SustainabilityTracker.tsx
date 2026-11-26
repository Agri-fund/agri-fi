'use client';

import React from 'react';
import { SustainabilityMetrics } from '@/types/sustainability';

interface SustainabilityTrackerProps {
  metrics: SustainabilityMetrics;
}

export const SustainabilityTracker: React.FC<SustainabilityTrackerProps> = ({
  metrics,
}) => {
  const { carbonFootprint, certifications, sustainabilityScore, esgCompliant } =
    metrics;

  return (
    <div className="sustainability-tracker space-y-4 p-4 border rounded-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Sustainability Metrics</h3>
        {esgCompliant && (
          <span className="px-2 py-1 bg-green-100 text-green-800 text-sm rounded">
            ESG Compliant
          </span>
        )}
      </div>

      <div className="carbon-footprint space-y-2">
        <h4 className="font-medium">Carbon Footprint</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-gray-600">Transportation:</span>
            <span className="ml-2 font-medium">
              {carbonFootprint.transportation} {carbonFootprint.unit}
            </span>
          </div>
          <div>
            <span className="text-gray-600">Storage:</span>
            <span className="ml-2 font-medium">
              {carbonFootprint.storage} {carbonFootprint.unit}
            </span>
          </div>
          <div>
            <span className="text-gray-600">Processing:</span>
            <span className="ml-2 font-medium">
              {carbonFootprint.processing} {carbonFootprint.unit}
            </span>
          </div>
          <div>
            <span className="text-gray-600">Total:</span>
            <span className="ml-2 font-semibold">
              {carbonFootprint.total} {carbonFootprint.unit}
            </span>
          </div>
        </div>
      </div>

      <div className="sustainability-score">
        <h4 className="font-medium mb-2">Sustainability Score</h4>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-200 rounded-full h-4">
            <div
              className="bg-green-500 h-4 rounded-full transition-all"
              style={{ width: `${sustainabilityScore}%` }}
            />
          </div>
          <span className="font-semibold">{sustainabilityScore}/100</span>
        </div>
      </div>

      {certifications.length > 0 && (
        <div className="certifications">
          <h4 className="font-medium mb-2">Eco-Friendly Certifications</h4>
          <div className="space-y-2">
            {certifications.map((cert) => (
              <div
                key={cert.id}
                className="flex items-center justify-between p-2 bg-gray-50 rounded"
              >
                <div>
                  <div className="font-medium text-sm">{cert.name}</div>
                  <div className="text-xs text-gray-600">
                    Issued by {cert.issuer}
                  </div>
                </div>
                {cert.verificationUrl && (
                  <a
                    href={cert.verificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 text-xs hover:underline"
                  >
                    Verify
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
