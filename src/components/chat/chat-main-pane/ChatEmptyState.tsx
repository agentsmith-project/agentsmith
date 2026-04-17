'use client';

import { MessageSquare } from 'lucide-react';

interface ChatEmptyStateProps {
  labels: {
    noActiveThreadTitle: string;
    noActiveThreadDescription: string;
    noActiveThreadHint: string;
    selectThreadHint: string;
  };
}

export function ChatEmptyState({ labels }: ChatEmptyStateProps) {
  return (
    <div
      className="h-full flex items-center justify-center px-4"
      data-testid="chat__main-empty-state"
    >
      <div className="mx-auto w-full max-w-[560px] text-center px-6">
        <MessageSquare className="w-12 h-12 mx-auto mb-4 text-tertiary" />
        <div className="text-foreground font-medium mb-1">{labels.noActiveThreadTitle}</div>
        <div className="text-tertiary text-sm">{labels.noActiveThreadDescription}</div>
        <div className="mt-3 text-xs text-tertiary">
          <span>{labels.noActiveThreadHint}</span>
          <span className="mx-1">·</span>
          <span>{labels.selectThreadHint}</span>
        </div>
      </div>
    </div>
  );
}
