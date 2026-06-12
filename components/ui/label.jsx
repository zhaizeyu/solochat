import React from 'react';
import { cn } from '../../lib/utils.js';

export const Label = React.forwardRef(function Label({ className = '', ...props }, ref) {
  return (
    <label
      ref={ref}
      className={cn('grid gap-2 text-sm font-medium leading-none text-[var(--foreground)]', className)}
      {...props}
    />
  );
});
