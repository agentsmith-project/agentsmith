/**
 * Usage Page Loading Skeleton
 *
 * Loading placeholder for the usage analytics page.
 * Shows skeleton UI for charts and metrics.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function UsageLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-5 w-48 mt-2" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-border rounded-md p-4 space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
        <div className="border border-border rounded-md p-4 space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>

      {/* Details Table */}
      <div className="border border-border rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-surface-high">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="divide-y divide-border">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid grid-cols-6 gap-4 px-4 py-3 items-center">
              <Skeleton className="h-5 col-span-1" />
              <Skeleton className="h-5 col-span-2" />
              <Skeleton className="h-5 col-span-1" />
              <Skeleton className="h-5 col-span-1" />
              <Skeleton className="h-5 col-span-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
