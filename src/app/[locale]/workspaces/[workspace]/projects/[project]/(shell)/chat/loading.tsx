/**
 * Chat Page Loading Skeleton
 *
 * Loading placeholder for the chat interface.
 * Shows skeleton UI for threads pane and chat window.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function ChatLoading() {
  return (
    <div className="h-full min-h-0 flex overflow-hidden rounded-md border border-subtle bg-panel/40">
      {/* Threads Pane */}
      <div className="w-[280px] xl:w-[304px] 2xl:w-[320px] border-r border-border flex flex-col">
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
      <section className="flex-1 flex min-w-0 flex-col bg-background overflow-hidden">
        {/* Chat Header */}
        <div className="h-14 border-b border-border">
          <div className="mx-auto flex h-full w-full max-w-[980px] items-center px-4">
            <Skeleton className="h-6 w-48" />
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto w-full max-w-[980px] space-y-4">
            <Skeleton className="h-24 w-3/4 ml-auto" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-20 w-2/3 ml-auto" />
            <Skeleton className="h-28 w-full" />
          </div>
        </div>

        {/* Composer */}
        <div className="px-4 py-4 border-t border-border">
          <div className="mx-auto w-full max-w-[980px]">
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </section>
    </div>
  );
}
