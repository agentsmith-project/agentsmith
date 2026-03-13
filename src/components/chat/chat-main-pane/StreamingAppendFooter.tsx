'use client';

import { Markdown } from '@/components/chat/Markdown';

interface StreamingAppendFooterProps {
  assistant: string;
  content: string;
}

export function StreamingAppendFooter({ assistant, content }: StreamingAppendFooterProps) {
  return (
    <div className="px-4 py-2">
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-md px-4 py-3 border bg-surface-high text-primary border-subtle">
          <div className="text-xs text-tertiary mb-1">{assistant}</div>
          <div className="space-y-2">
            <Markdown content={content || '...'} />
          </div>
        </div>
      </div>
    </div>
  );
}
