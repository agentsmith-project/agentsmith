'use client';
import * as React from 'react';
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
import { MoreHorizontal } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { SourcesTableSkeleton } from '@/components/sources/SourcesTableSkeleton';
import { formatNumber, formatBytes, formatDuration } from '@/lib/utils/formatters';
import { useTranslations } from 'next-intl';
import type { UsageRecord } from '@/lib/api/types';

const columnHelper = createColumnHelper<UsageRecord>();

function formatTimeBucket(timeBucket: string): string {
  // YYYY-MM-DD or YYYY-MM-DD HH:mm
  return timeBucket;
}

function formatTokens(tokens?: number): string {
  if (!tokens) return '—';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

function truncateId(id: string, length: number = 8): string {
  if (id.length <= length) return id;
  return `${id.substring(0, length)}...`;
}

export interface UsageTableProps {
  data: UsageRecord[];
  loading?: boolean;
  onClearFilters?: () => void;
}

export function UsageTable({ data, loading = false, onClearFilters }: UsageTableProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'time_bucket', desc: true },
  ]);

  const columns = React.useMemo(
    () => [
      columnHelper.accessor('time_bucket', {
        header: t('table.time_bucket'),
        cell: (info) => (
          <span className="text-sm text-foreground">{formatTimeBucket(info.getValue())}</span>
        ),
        size: 180,
      }),
      columnHelper.accessor('resource_type', {
        header: t('table.resource_type'),
        cell: (info) => (
          <Badge variant="outline" className="text-xs">
            {info.getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor('resource_id', {
        header: t('table.resource_id'),
        cell: (info) => {
          const resourceId = info.getValue();
          if (!resourceId) return <span className="text-tertiary">—</span>;
          return (
            <span className="text-sm text-foreground font-mono">{truncateId(resourceId, 8)}</span>
          );
        },
      }),
      columnHelper.accessor('requests', {
        header: t('table.requests'),
        cell: (info) => (
          <div className="text-right text-sm text-foreground">{formatNumber(info.getValue())}</div>
        ),
        size: 120,
      }),
      columnHelper.accessor('duration_p95_ms', {
        header: t('table.duration_p95'),
        cell: (info) => (
          <div className="text-right text-sm text-foreground">{formatDuration(info.getValue())}</div>
        ),
        size: 120,
      }),
      columnHelper.accessor('bytes_in', {
        header: t('table.bytes_in'),
        cell: (info) => (
          <div className="text-right text-sm text-foreground">{formatBytes(info.getValue())}</div>
        ),
        size: 120,
      }),
      columnHelper.accessor('bytes_out', {
        header: t('table.bytes_out'),
        cell: (info) => (
          <div className="text-right text-sm text-foreground">{formatBytes(info.getValue())}</div>
        ),
        size: 120,
      }),
      columnHelper.accessor('tokens', {
        header: t('table.tokens'),
        cell: (info) => (
          <div className="text-right text-sm text-foreground">
            {formatNumber(info.getValue(), { defaultValue: '—' })}
          </div>
        ),
        size: 120,
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: () => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* View Details can be added in v1.5+ */}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        size: 80,
      }),
    ],
    [sorting, t, commonT],
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
    return <SourcesTableSkeleton />;
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title={t('empty.title')}
        description={t('empty.description')}
        onClearFilters={onClearFilters}
      />
    );
  }

  return <DataTable table={table} />;
}
