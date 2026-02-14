'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Play, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BatchActionBarProps {
  selectedCount: number;
  onStartAIReady: () => void;
  onCancelAIReady: () => void;
  onClearSelection: () => void;
  className?: string;
}

export function BatchActionBar({
  selectedCount,
  onStartAIReady,
  onCancelAIReady,
  onClearSelection,
  className,
}: BatchActionBarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 flex items-center justify-between gap-4 p-4 border-t border-subtle bg-surface-high shadow-lg',
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <span className="text-sm text-foreground font-medium">
          {selectedCount} file(s) selected
        </span>
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          Clear
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onStartAIReady}
          className="flex items-center gap-2"
        >
          <Play className="h-4 w-4" />
          Start AIReady
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancelAIReady}
          className="flex items-center gap-2"
        >
          <XIcon className="h-4 w-4" />
          Cancel AIReady
        </Button>
      </div>
    </div>
  );
}
