'use client';
import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { AIReadyStatus } from '@/lib/api/types';

export interface SourcesFiltersProps {
  status: AIReadyStatus | 'all';
  onStatusChange: (status: AIReadyStatus | 'all') => void;
  aiReadyOnly: boolean;
  onAIReadyOnlyChange: (value: boolean) => void;
  sortBy: 'updated_at' | 'file_size' | 'status';
  onSortByChange: (sortBy: 'updated_at' | 'file_size' | 'status') => void;
  sortOrder: 'asc' | 'desc';
  onSortOrderChange: (sortOrder: 'asc' | 'desc') => void;
  className?: string;
}

export function SourcesFilters({
  status,
  onStatusChange,
  aiReadyOnly,
  onAIReadyOnlyChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  className,
}: SourcesFiltersProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="idle">Not Ready</SelectItem>
          <SelectItem value="preparing">Preparing</SelectItem>
          <SelectItem value="ready">Ready</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={aiReadyOnly ? 'only' : 'all'}
        onValueChange={(value) => onAIReadyOnlyChange(value === 'only')}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="AIReady" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Files</SelectItem>
          <SelectItem value="only">AIReady Only</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sortBy} onValueChange={onSortByChange}>
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="updated_at">Updated</SelectItem>
          <SelectItem value="file_size">Size</SelectItem>
          <SelectItem value="status">Status</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sortOrder} onValueChange={onSortOrderChange}>
        <SelectTrigger className="w-[96px]">
          <SelectValue placeholder="Order" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc">Desc</SelectItem>
          <SelectItem value="asc">Asc</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
