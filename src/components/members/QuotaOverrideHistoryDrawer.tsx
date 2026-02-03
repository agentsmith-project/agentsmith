'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { QuotaOverrideHistoryItem } from '@/lib/api/types';

export interface QuotaOverrideHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberName: string;
  items: QuotaOverrideHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  isLoading?: boolean;
  onPageChange?: (page: number) => void;
}

function countOverridePaths(obj: unknown): number {
  if (obj === null || typeof obj !== 'object') return 1;
  if (Array.isArray(obj)) return 0;
  return Object.values(obj).reduce((sum, v) => sum + countOverridePaths(v), 0);
}

function formatOverridesSummary(overrides: Record<string, unknown>): string {
  const count = countOverridePaths(overrides);
  if (count === 0) return 'No overrides (inherit all from project)';
  if (count === 1) return '1 override';
  return `${count} overrides`;
}

export function QuotaOverrideHistoryDrawer({
  open,
  onOpenChange,
  memberName,
  items,
  total,
  page,
  pageSize,
  isLoading,
  onPageChange,
}: QuotaOverrideHistoryDrawerProps) {
  const t = useTranslations('members.quota_history');
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set());

  const toggleExpanded = React.useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const totalPages = Math.ceil(total / pageSize);
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('title')} - {memberName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading ? (
            <div className="text-center py-8 text-tertiary">
              <p className="text-sm">{t('loading')}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-tertiary">
              <p className="text-sm">{t('empty')}</p>
            </div>
          ) : (
            <>
              {items.map((item) => {
                const isExpanded = expandedItems.has(item.id);
                const summary = formatOverridesSummary(
                  (item.overrides_json || {}) as Record<string, unknown>
                );
                return (
                  <div
                    key={item.id}
                    className="border border-border rounded-md bg-surface p-4"
                  >
                    <button
                      onClick={() => toggleExpanded(item.id)}
                      className="w-full flex items-center justify-between text-left"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-tertiary shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-tertiary shrink-0" />
                        )}
                        <span className="text-sm text-tertiary">
                          {t('by')} {item.created_by_user_id}
                        </span>
                        <span className="text-xs text-tertiary">
                          {formatRelativeTime(item.created_at)}
                        </span>
                        <Badge variant="outline" className="text-xs max-w-[200px] truncate">
                          {summary}
                        </Badge>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="mt-4 pl-7">
                        <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto max-h-48 overflow-y-auto font-mono">
                          {JSON.stringify(item.overrides_json || {}, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}

              {totalPages > 1 && onPageChange && (
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <span className="text-sm text-tertiary">
                    {t('page_info', { page, totalPages, total })}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onPageChange(page - 1)}
                      disabled={!hasPrev}
                      className="text-sm text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('prev')}
                    </button>
                    <button
                      onClick={() => onPageChange(page + 1)}
                      disabled={!hasNext}
                      className="text-sm text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('next')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
