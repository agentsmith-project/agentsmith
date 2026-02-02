'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { FileX } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title: string;
  description: string;
  onClearFilters?: () => void;
  className?: string;
}

export function EmptyState({ title, description, onClearFilters, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4', className)}>
      <FileX className="h-12 w-12 text-tertiary mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-tertiary text-center mb-6 max-w-md">{description}</p>
      {onClearFilters && (
        <Button variant="outline" onClick={onClearFilters}>
          Clear Filters
        </Button>
      )}
    </div>
  );
}
