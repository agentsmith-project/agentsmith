/**
 * Files Page Loading Skeleton
 *
 * Loading placeholder for the files page.
 * Shows skeleton UI for file list and upload area.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function SourcesLoading() {
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

      {/* Search and Filters */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 flex-1 max-w-md" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>

      {/* Files Table */}
      <div className="border border-border rounded-md overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-border bg-surface-high">
          <Skeleton className="h-4 col-span-4" />
          <Skeleton className="h-4 col-span-2" />
          <Skeleton className="h-4 col-span-2" />
          <Skeleton className="h-4 col-span-2" />
          <Skeleton className="h-4 col-span-2" />
        </div>

        {/* Table Rows */}
        <div className="divide-y divide-border">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid grid-cols-12 gap-4 px-4 py-3 items-center">
              <Skeleton className="h-5 col-span-4" />
              <Skeleton className="h-5 col-span-2" />
              <Skeleton className="h-5 col-span-2" />
              <Skeleton className="h-5 col-span-2" />
              <Skeleton className="h-8 col-span-2" />
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
