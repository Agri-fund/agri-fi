import React from 'react';

export type BadgeTone = 'green' | 'blue' | 'yellow' | 'red' | 'gray' | 'purple' | 'orange';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Show a leading status dot. */
  dot?: boolean;
}

export function Badge({ tone = 'gray', dot = false, className = '', children, ...props }: BadgeProps) {
  return (
    <span className={`badge-${tone} ${className}`} {...props}>
      {dot && (
        <span
          aria-hidden="true"
          className="w-1.5 h-1.5 rounded-full bg-current opacity-70 inline-block mr-1"
        />
      )}
      {children}
    </span>
  );
}

export default Badge;
