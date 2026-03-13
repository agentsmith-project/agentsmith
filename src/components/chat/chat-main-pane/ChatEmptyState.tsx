'use client';

import { MessageSquare, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ChatEmptyStateProps {
  canUseChat: boolean;
  createPending: boolean;
  labels: {
    noActiveThreadTitle: string;
    noActiveThreadDescription: string;
    noActiveThreadHint: string;
    newThread: string;
    selectThreadHint: string;
  };
  onCreateThread: () => void;
}

export function ChatEmptyState({
  canUseChat,
  createPending,
  labels,
  onCreateThread,
}: ChatEmptyStateProps) {
  return (
    <div className="h-full flex items-center justify-center px-4">
      <div className="mx-auto w-full max-w-[560px] text-center px-6">
        <MessageSquare className="w-12 h-12 mx-auto mb-4 text-tertiary" />
        <div className="text-foreground font-medium mb-1">{labels.noActiveThreadTitle}</div>
        <div className="text-tertiary text-sm">{labels.noActiveThreadDescription}</div>
        <div className="mt-3 text-xs text-tertiary">
          {labels.noActiveThreadHint}
          <span className="mx-1">·</span>
          {labels.selectThreadHint}
        </div>
        <Button
          className="mt-4"
          variant="outline"
          onClick={onCreateThread}
          disabled={!canUseChat || createPending}
          data-testid="chat__empty-create-btn"
        >
          <Plus className="w-4 h-4" />
          {labels.newThread}
        </Button>
      </div>
    </div>
  );
}
