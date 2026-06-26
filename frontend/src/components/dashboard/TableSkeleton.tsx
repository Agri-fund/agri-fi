'use client';

import React from 'react';

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
}

export default function TableSkeleton({ rows = 5, cols = 7 }: TableSkeletonProps) {
  return (
    <div className="table-wrapper overflow-x-auto w-full">
      <table className="w-full border-collapse">
        <thead className="table-head">
          <tr>
            <th className="table-th">Commodity</th>
            <th className="table-th">Status</th>
            <th className="table-th">Quantity</th>
            <th className="table-th">Value</th>
            <th className="table-th">Funded Progress</th>
            <th className="table-th">Expected Delivery</th>
            <th className="table-th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rIdx) => (
            <tr key={rIdx} className="table-row">
              {/* Commodity */}
              <td className="table-td">
                <div className="h-4 w-28 skeleton rounded" />
                <div className="h-3 w-16 skeleton rounded mt-1.5" />
              </td>
              {/* Status */}
              <td className="table-td">
                <div className="h-5 w-16 skeleton rounded-full" />
              </td>
              {/* Quantity */}
              <td className="table-td">
                <div className="h-4 w-20 skeleton rounded" />
              </td>
              {/* Value */}
              <td className="table-td">
                <div className="h-4 w-24 skeleton rounded" />
              </td>
              {/* Funded Progress */}
              <td className="table-td min-w-[140px]">
                <div className="flex justify-between items-center mb-1">
                  <div className="h-3 w-8 skeleton rounded" />
                </div>
                <div className="progress-track w-full">
                  <div className="h-full w-1/3 skeleton rounded-full" />
                </div>
              </td>
              {/* Delivery */}
              <td className="table-td">
                <div className="h-4 w-24 skeleton rounded" />
              </td>
              {/* Actions */}
              <td className="table-td text-right">
                <div className="inline-block h-8 w-24 skeleton rounded-xl" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
