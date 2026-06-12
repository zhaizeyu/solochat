import React from 'react';
import { cn } from '../../lib/utils.js';

const variants = {
  default: 'border border-transparent bg-[var(--brand-gradient)] text-[var(--primary-foreground)] shadow-[0_10px_24px_rgba(18,184,134,0.18)] hover:brightness-105',
  secondary: 'border border-transparent bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--secondary-hover)]',
  outline: 'border border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] shadow-sm hover:border-[var(--accent)] hover:bg-[var(--background)] hover:text-[var(--foreground)]',
  ghost: 'border border-transparent bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--accent-muted)] hover:text-[var(--foreground)]',
  destructive: 'border border-[var(--destructive-border)] bg-[var(--destructive-muted)] text-[var(--destructive)] shadow-sm hover:bg-[var(--background)]'
};

const sizes = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 px-3',
  lg: 'h-11 px-8',
  icon: 'h-10 w-10'
};

export const Button = React.forwardRef(function Button(
  { className = '', variant = 'default', size = 'default', type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-50',
        variants[variant] || variants.default,
        sizes[size] || sizes.default,
        className
      )}
      {...props}
    />
  );
});
