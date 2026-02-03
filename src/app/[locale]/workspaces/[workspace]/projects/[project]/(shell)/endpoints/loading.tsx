/**
 * Endpoints Page Loading Skeleton
 *
 * Loading placeholder for the endpoints page.
 * Shows skeleton UI for endpoints list.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function EndpointsLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-5 w-64 mt-2" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Endpoints Table */}
      <div className="border border-border rounded-md overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-border bg-surface-high">
          <Skeleton className="h-4 col-span-3" />
          <Skeleton className="h-4 col-span-2" />
          <Skeleton className="h-4 col-span-2" />
          <Skeleton className="h-4 col-span-2" />
          <Skeleton className="h-4 col-span-2" />
          <Skeleton className="h-4 col-span-1" />
        </div>

        {/* Table Rows */}
        <div className="divide-y divide-border">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid grid-cols-12 gap-4 px-4 py-3 items-center">
              <Skeleton className="h-5 col-span-3" />
              <Skeleton className="h-5 col-span-2" />
              <Skeleton className="h-5 col-span-2" />
              <Skeleton className="h-5 col-span-2" />
              <Skeleton className="h-5 col-span-2" />
              <Skeleton className="h-8 col-span-1" />
            </div>
          ))}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-32" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
    </div>
  );
}
