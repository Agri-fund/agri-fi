import React from 'react';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of stacked text lines. Values below 1 render a single line. */
  lines?: number;
  circle?: boolean;
}

export function Skeleton({ lines = 1, circle = false, className = '', ...props }: SkeletonProps) {
  const count = Math.max(1, Math.floor(lines));
  return (
    <div aria-hidden="true" className="space-y-2" {...props}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`skeleton ${circle ? 'w-10 h-10 rounded-full' : 'h-4 rounded'} ${
            !circle && count > 1 && i === count - 1 ? 'w-2/3' : ''
          } ${className}`}
        />
      ))}
    </div>
  );
}

export default Skeleton;
