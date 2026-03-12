'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MoreHorizontal, Eye } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { FilesTableSkeleton } from '@/components/files/FilesTableSkeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { AuditEvent } from '@/lib/api/types';
import {
  getAuditActionLabel,
  getAuditActorLabel,
  getAuditErrorMessageLabel,
  getAuditEventCategory,
  getAuditResourceLabel,
  getAuditResourceIdLabel,
  getAuditResourceTypeLabel,
  getAuditSummary,
  type AuditEventCategory,
} from './audit-event-presenter';

const columnHelper = createColumnHelper<AuditEvent>();

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2 $4:$5:$6');
}

export interface AuditTableProps {
  data: AuditEvent[];
  loading?: boolean;
  onViewDetails?: (event: AuditEvent) => void;
  onClearFilters?: () => void;
  onRefresh?: () => void;
}

export function AuditTable({
  data,
  loading = false,
  onViewDetails,
  onClearFilters,
  onRefresh,
}: AuditTableProps) {
  const t = useTranslations('audit');
  const commonT = useTranslations('common');
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'timestamp', desc: true },
  ]);

  const categorySummary = React.useMemo(() => {
    const summary: Record<AuditEventCategory, number> = {
      change: 0,
      event: 0,
      anomaly: 0,
    };

    for (const event of data) {
      summary[getAuditEventCategory(event)] += 1;
    }

    return summary;
  }, [data]);

  const columns = React.useMemo(
    () => [
      columnHelper.accessor('timestamp', {
        header: t('table.timestamp'),
        cell: (info) => {
          const timestamp = info.getValue();
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-foreground cursor-help">
                    {formatTimestamp(timestamp)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{timestamp}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
        size: 180,
      }),
      columnHelper.accessor('action', {
        header: t('table.action'),
        cell: (info) => {
          const event = info.row.original;
          const category = getAuditEventCategory(event);
          const categoryVariant =
            category === 'anomaly' ? 'destructive' : category === 'change' ? 'secondary' : 'outline';

          return (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={categoryVariant} className="text-xs" data-testid={`audit__category-badge--${category}`}>
                {t(`category.${category}`)}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {getAuditActionLabel(String(info.getValue()))}
              </Badge>
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'summary',
        header: t('table.summary'),
        cell: (info) => {
          const event = info.row.original;
          return (
            <div className="min-w-[280px]">
              <p className="text-sm text-foreground">{getAuditSummary(event, t)}</p>
              {event.error_message ? (
                <p className="mt-1 line-clamp-1 text-xs text-tertiary">{getAuditErrorMessageLabel(event.error_message)}</p>
              ) : null}
            </div>
          );
        },
        size: 320,
      }),
      columnHelper.accessor('actor_type', {
        id: 'actor',
        header: t('table.actor'),
        cell: (info) => {
          const event = info.row.original;
          const actorType = event.actor_type;
          const variant =
            actorType === 'user' ? 'default' : actorType === 'agent' ? 'secondary' : 'outline';
          return (
            <div className="flex items-center gap-2">
              <Badge variant={variant} className="text-xs">
                {getAuditActorLabel(actorType, t)}
              </Badge>
            </div>
          );
        },
      }),
      columnHelper.accessor('resource_type', {
        id: 'resource',
        header: t('table.resource'),
        cell: (info) => {
          const event = info.row.original;
          const resourceType = event.resource_type;
          const resourceLabel = getAuditResourceLabel(event);
          const resourceId = getAuditResourceIdLabel(event);
          if (!resourceType && !resourceId) return <span className="text-tertiary">—</span>;
          return (
            <div className="flex items-center gap-2">
              {resourceType && (
                <Badge variant="outline" className="text-xs">
                  {getAuditResourceTypeLabel(resourceType)}
                </Badge>
              )}
              {resourceLabel && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-sm text-foreground cursor-help">
                        {resourceLabel}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{resourceLabel}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('result', {
        header: t('table.result'),
        cell: (info) => {
          const result = info.getValue();
          const variant = result === 'ok' ? 'default' : 'destructive';
          return (
            <Badge variant={variant} className="text-xs">
              {result === 'ok' ? commonT('success') : commonT('error')}
            </Badge>
          );
        },
        size: 100,
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const event = info.row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onViewDetails && (
                  <DropdownMenuItem
                    onClick={() => onViewDetails(event)}
                    className="flex items-center gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    {commonT('view_details')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        size: 80,
      }),
    ],
    [onViewDetails, t, commonT],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
    },
  });

  if (loading) {
    return <FilesTableSkeleton />;
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title={t('empty.title')}
        description={t('empty.description')}
        onClearFilters={onClearFilters}
        onRefresh={onRefresh}
      />
    );
  }

  const anchorColumns = [
    { id: 'request_id', label: t('table.request_id') },
    { id: 'decision_id', label: t('table.decision_id') },
    { id: 'trace_ref', label: t('table.trace_ref') },
  ];

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3" data-testid="audit__category-summary">
        <div className="rounded-lg border border-subtle bg-surface px-3 py-2" data-testid="audit__category-summary--change">
          <p className="text-xs text-tertiary">{t('category.change')}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{categorySummary.change}</p>
        </div>
        <div className="rounded-lg border border-subtle bg-surface px-3 py-2" data-testid="audit__category-summary--event">
          <p className="text-xs text-tertiary">{t('category.event')}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{categorySummary.event}</p>
        </div>
        <div className="rounded-lg border border-subtle bg-surface px-3 py-2" data-testid="audit__category-summary--anomaly">
          <p className="text-xs text-tertiary">{t('category.anomaly')}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{categorySummary.anomaly}</p>
        </div>
      </div>
      <DataTable table={table} testId="audit__table" />
    </div>
  );
}
