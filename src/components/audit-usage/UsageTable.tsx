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
import { Badge } from '@/components/ui/badge';
import { EmptyState } from './EmptyState';
import { FilesTableSkeleton } from '@/components/files/FilesTableSkeleton';
import { formatNumber, formatBytes, formatDuration } from '@/lib/utils/formatters';
import { useTranslations } from 'next-intl';
import type { UsageRecord } from '@/lib/api/types';

const columnHelper = createColumnHelper<UsageRecord>();

function formatTimeBucket(timeBucket: string): string {
  // Supports YYYY-MM-DD and YYYY-MM-DD HH:mm.
  if (/^\d{4}-\d{2}-\d{2}$/.test(timeBucket)) {
    const date = new Date(`${timeBucket}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
  }

  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(timeBucket)) {
    const date = new Date(`${timeBucket.replace(' ', 'T')}:00Z`);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
  }

  return timeBucket;
}

function truncateId(id: string, length: number = 8): string {
  if (id.length <= length) return id;
  return `${id.substring(0, length)}...`;
}

export interface UsageTableProps {
  data: UsageRecord[];
  loading?: boolean;
  onClearFilters?: () => void;
  hasActiveFilters?: boolean;
  onSelectRecord?: (record: UsageRecord) => void;
}

export function UsageTable({
  data,
  loading = false,
  onClearFilters,
  hasActiveFilters = false,
  onSelectRecord,
}: UsageTableProps) {
  const t = useTranslations('usage');
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
            <span className="text-sm text-foreground font-mono" title={resourceId}>
              {truncateId(resourceId, 8)}
            </span>
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
    ],
    [t],
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
        title={hasActiveFilters ? t('empty.filtered_title') : t('empty.title')}
        description={hasActiveFilters ? t('empty.filtered_description') : t('empty.description')}
        onClearFilters={onClearFilters}
      />
    );
  }

  return (
    <DataTable
      table={table}
      testId="usage__table"
      onRowClick={onSelectRecord}
      isRowClickable={() => true}
    />
  );
}
