import React from 'react';
import { cn } from '../../lib/utils.js';

export function TabsList({ className = '', columns, ...props }) {
  return (
    <div
      className={cn('inline-grid items-center justify-center rounded-md bg-[var(--muted)] p-1 text-[var(--muted-foreground)]', className)}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      role="tablist"
      {...props}
    />
  );
}

export function TabsTrigger({ className = '', active = false, ...props }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        'inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50',
        active && 'bg-[var(--background)] text-[var(--foreground)] shadow-sm',
        className
      )}
      {...props}
    />
  );
}
