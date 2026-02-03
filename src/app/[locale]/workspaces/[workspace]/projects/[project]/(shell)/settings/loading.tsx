/**
 * Settings Page Loading Skeleton
 *
 * Loading placeholder for the project settings page.
 * Shows skeleton UI for settings sections.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsLoading() {
  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-64 mt-2" />
      </div>

      {/* General Settings Section */}
      <div className="border border-border rounded-md p-6 space-y-4">
        <Skeleton className="h-6 w-32" />
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full max-w-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-48" />
          </div>
        </div>
      </div>

      {/* Danger Zone Section */}
      <div className="border border-error/50 rounded-md p-6 space-y-4">
        <Skeleton className="h-6 w-32" />
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-10 w-40" />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  );
}
