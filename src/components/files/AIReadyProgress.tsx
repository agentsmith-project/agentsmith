'use client';
import * as React from 'react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export interface AIReadyProgressProps {
  progress?: number; // 0-100
  isQueued?: boolean;
  className?: string;
}

export function AIReadyProgress({
  progress,
  isQueued = false,
  className,
}: AIReadyProgressProps) {
  if (isQueued) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <span className="text-xs text-tertiary">Queued</span>
      </div>
    );
  }

  if (progress === undefined) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <span className="text-xs text-tertiary">Processing...</span>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-2 w-full', className)}>
      <Progress value={progress} className="flex-1 h-1.5" />
      <span className="text-xs text-tertiary min-w-[3rem] text-right">{progress}%</span>
    </div>
  );
}
