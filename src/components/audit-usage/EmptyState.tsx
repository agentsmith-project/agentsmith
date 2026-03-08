'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { FileX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

export interface EmptyStateProps {
  title: string;
  description: string;
  onClearFilters?: () => void;
  onRefresh?: () => void;
  className?: string;
}

export function EmptyState({ title, description, onClearFilters, onRefresh, className }: EmptyStateProps) {
  const commonT = useTranslations('common');
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4', className)} data-testid="audit-usage__empty-state">
      <FileX className="h-12 w-12 text-tertiary mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-tertiary text-center mb-6 max-w-md">{description}</p>
      <div className="flex items-center gap-2">
        {onClearFilters && (
          <Button variant="outline" onClick={onClearFilters} data-testid="audit-usage__empty-clear-filters">
            {commonT('clear_filters')}
          </Button>
        )}
        {onRefresh && (
          <Button variant="outline" onClick={onRefresh} data-testid="audit-usage__empty-refresh">
            {commonT('refresh')}
          </Button>
        )}
      </div>
    </div>
  );
}
