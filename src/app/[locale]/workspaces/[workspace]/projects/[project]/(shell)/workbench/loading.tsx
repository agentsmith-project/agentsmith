/**
 * Workbench Page Loading Skeleton
 *
 * Loading placeholder for the workbench/recipes page.
 * Shows skeleton UI for recipe list and recipe details.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function WorkbenchLoading() {
  return (
    <div className="h-full flex overflow-hidden">
      {/* Recipes List */}
      <div className="w-80 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <Skeleton className="h-10 w-full mb-3" />
          <Skeleton className="h-9 w-full" />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>

      {/* Recipe Details */}
      <section className="flex-1 flex flex-col bg-background overflow-hidden">
        <div className="h-14 border-b border-border flex items-center px-4">
          <Skeleton className="h-6 w-64" />
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />

          <div className="border-t border-border pt-6">
            <Skeleton className="h-6 w-32 mb-4" />
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <Skeleton className="h-6 w-32 mb-4" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </section>
    </div>
  );
}
