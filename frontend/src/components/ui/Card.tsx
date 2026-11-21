import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  footer?: React.ReactNode;
  /** Adds hover elevation for clickable cards. */
  interactive?: boolean;
}

export function Card({
  title,
  footer,
  interactive = false,
  className = '',
  children,
  ...props
}: CardProps) {
  return (
    <div className={`card ${interactive ? 'card-interactive' : ''} p-5 ${className}`} {...props}>
      {title && <h3 className="text-base font-semibold mb-3">{title}</h3>}
      {children}
      {footer && <div className="mt-4 pt-4 border-t border-border">{footer}</div>}
    </div>
  );
}

export default Card;
