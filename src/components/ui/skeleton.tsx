/**
 * Skeleton Component
 *
 * Loading placeholder component for content that is being fetched.
 * Displays a pulsing gray placeholder that matches the design system.
 */

import { cn } from '@/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-high', className)}
      {...props}
    />
  );
}
