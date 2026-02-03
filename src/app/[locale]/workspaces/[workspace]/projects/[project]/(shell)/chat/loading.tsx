/**
 * Chat Page Loading Skeleton
 *
 * Loading placeholder for the chat interface.
 * Shows skeleton UI for threads pane and chat window.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function ChatLoading() {
  return (
    <div className="h-full flex overflow-hidden">
      {/* Threads Pane */}
      <div className="w-72 border-r border-border flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <Skeleton className="h-10 w-full mb-3" />
          <Skeleton className="h-9 w-full" />
        </div>

        {/* Threads List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>

      {/* Chat Window */}
      <section className="flex-1 flex flex-col bg-background overflow-hidden">
        {/* Chat Header */}
        <div className="h-14 border-b border-border flex items-center px-4">
          <Skeleton className="h-6 w-48" />
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <Skeleton className="h-24 w-3/4 ml-auto" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-20 w-2/3 ml-auto" />
          <Skeleton className="h-28 w-full" />
        </div>

        {/* Composer */}
        <div className="p-4 border-t border-border">
          <Skeleton className="h-24 w-full" />
        </div>
      </section>
    </div>
  );
}
