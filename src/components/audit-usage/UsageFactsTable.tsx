'use client';
import * as React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from './EmptyState';
import { FilesTableSkeleton } from '@/components/files/FilesTableSkeleton';
import type { UsageFactRecord } from '@/lib/api/types';

const columnHelper = createColumnHelper<UsageFactRecord>();

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function truncateValue(value: string, length = 16): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}...`;
}

function formatUsd(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return `$${value.toFixed(6)}`;
}

export interface UsageFactsTableProps {
  data: UsageFactRecord[];
  loading?: boolean;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  onRefresh?: () => void;
  onSelectFact?: (fact: UsageFactRecord) => void;
}

export function UsageFactsTable({
  data,
  loading = false,
  hasActiveFilters = false,
  onClearFilters,
  onRefresh,
  onSelectFact,
}: UsageFactsTableProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'timestamp', desc: true },
  ]);

  const columns = React.useMemo(
    () => [
      columnHelper.accessor('timestamp', {
        header: t('facts_table.timestamp'),
        cell: (info) => <span className="text-sm text-foreground">{formatTimestamp(info.getValue())}</span>,
        size: 220,
      }),
      columnHelper.accessor('request_id', {
        header: t('facts_table.request_id'),
        cell: (info) => {
          const value = info.getValue();
          return <code className="text-xs text-foreground">{value ? truncateValue(value) : '--'}</code>;
        },
        size: 180,
      }),
      columnHelper.accessor('decision_id', {
        header: t('facts_table.decision_id'),
        cell: (info) => {
          const value = info.getValue();
          return <code className="text-xs text-foreground">{value ? truncateValue(value) : '--'}</code>;
        },
        size: 180,
      }),
      columnHelper.accessor('result', {
        header: t('facts_table.result'),
        cell: (info) => {
          const value = info.getValue();
          return (
            <Badge variant={value === 'ok' ? 'outline' : 'destructive'}>
              {value === 'ok' ? commonT('success') : commonT('error')}
            </Badge>
          );
        },
        size: 120,
      }),
      columnHelper.accessor((row) => row.runtime?.provider, {
        id: 'provider',
        header: t('facts_table.provider'),
        cell: (info) => <span className="text-sm text-foreground">{info.getValue() ?? '--'}</span>,
        size: 140,
      }),
      columnHelper.accessor((row) => row.runtime?.resolved_model, {
        id: 'model',
        header: t('facts_table.model'),
        cell: (info) => <span className="text-sm text-foreground">{info.getValue() ?? '--'}</span>,
        size: 160,
      }),
      columnHelper.accessor('tokens_total', {
        header: t('facts_table.tokens'),
        cell: (info) => <div className="text-right text-sm text-foreground">{info.getValue() ?? '--'}</div>,
        size: 120,
      }),
      columnHelper.accessor((row) => row.runtime?.estimated_cost, {
        id: 'estimated_cost',
        header: t('facts_table.estimated_cost'),
        cell: (info) => <div className="text-right text-sm text-foreground">{formatUsd(info.getValue())}</div>,
        size: 140,
      }),
    ],
    [commonT, t],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
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
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <DataTable
      table={table}
      testId="usage-facts__table"
      onRowClick={onSelectFact}
      isRowClickable={() => true}
    />
  );
}
