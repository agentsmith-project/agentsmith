/**
 * ScrollArea Component
 *
 * A container with vertical scrolling.
 *
 * @module ui/scroll-area
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * ScrollArea component
 *
 * A container with overflow scrolling.
 *
 * @param props - Component props
 * @returns ScrollArea component
 */
export function ScrollArea({ className, children, ...props }: ScrollAreaProps) {
  return (
    <div
      className={cn('overflow-y-auto', className)}
      {...props}
    >
      {children}
    </div>
  );
}
