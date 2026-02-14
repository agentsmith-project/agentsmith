'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
  type SortingState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { Checkbox } from '@/components/ui/checkbox';
import { File } from 'lucide-react';
import { AIReadyStatusBadge } from './AIReadyStatusBadge';
import { AIReadyProgress } from './AIReadyProgress';
import { EmptyState } from '@/components/ui/loading';
import { FilesTableSkeleton } from './FilesTableSkeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { FileItemWithAIReady } from '@/lib/api/types';

import { formatBytes, formatRelativeTime } from '@/lib/utils/formatters';

const columnHelper = createColumnHelper<FileItemWithAIReady>();

function getFileIcon(_fileType: string) {
  return File;
}

export interface FilesTableProps {
  data: FileItemWithAIReady[];
  loading?: boolean;
  compact?: boolean;
  /** Controlled selection: pass selected IDs to sync (e.g. when clearing from parent) */
  selectedIds?: string[];
  onRowSelect?: (selectedIds: string[]) => void;
  onUploadClick?: () => void;
}

export function FilesTable({
  data,
  loading = false,
  compact = false,
  selectedIds = [],
  onRowSelect,
  onUploadClick,
}: FilesTableProps) {
  const t = useTranslations('files');
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const rowSelection: RowSelectionState = React.useMemo(
    () => Object.fromEntries(selectedIds.map((id) => [id, true])),
    [selectedIds],
  );

  const setRowSelection = React.useCallback(
    (updater: React.SetStateAction<RowSelectionState>) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      const ids = Object.keys(next).filter((k) => next[k]);
      onRowSelect?.(ids);
    },
    [rowSelection, onRowSelect],
  );

  const columns = React.useMemo(
    () => [
      // Selection column
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label={t('action_attach')}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={`${t('action_attach')} ${row.original.filename || 'file'}`}
          />
        ),
        enableSorting: false,
      }),
      // Filename column
      columnHelper.accessor('filename', {
        header: t('table.filename'),
        cell: (info) => {
          const file = info.row.original;
          const FileIcon = getFileIcon(file.file_type);
          const filename = file.filename || 'Unknown file';
          const displayName = filename.length > 40
            ? `${filename.substring(0, 40)}...`
            : filename;
          
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-3 cursor-default">
                    <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center flex-shrink-0">
                      <FileIcon className="w-4 h-4 text-icon-default" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-foreground block truncate">{displayName}</span>
                      {file.version > 1 && (
                        <span className="text-tertiary text-xs">v{file.version}</span>
                      )}
                    </div>
                  </div>
                </TooltipTrigger>
                {filename.length > 40 && (
                  <TooltipContent>
                    <p className="max-w-xs break-words">{filename}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          );
        },
      }),
      // Size column
      columnHelper.accessor('file_size', {
        header: t('table.size'),
        cell: (info) => (
          <span className="text-tertiary text-sm font-mono">
            {formatBytes(info.getValue())}
          </span>
        ),
      }),
      // Updated at column
      columnHelper.accessor('updated_at', {
        header: t('table.updated_at'),
        cell: (info) => (
          <span className="text-tertiary text-sm">
            {formatRelativeTime(info.getValue())}
          </span>
        ),
      }),
      // AIReady status column
      columnHelper.display({
        id: 'ai_ready_status',
        header: t('table.ai_ready_status'),
        cell: (info) => {
          const file = info.row.original;
          const aiReady = file.ai_ready;
          const status = aiReady?.status || 'idle';

          return (
            <div className="flex flex-col gap-1">
              <AIReadyStatusBadge status={status} />
              {status === 'preparing' && (
                <AIReadyProgress
                  progress={aiReady?.progress}
                  isQueued={aiReady?.progress === undefined}
                />
              )}
            </div>
          );
        },
      }),
      // Usage column
      columnHelper.display({
        id: 'usage',
        header: t('table.usage'),
        cell: (info) => {
          const file = info.row.original;
          const usage = file.ai_ready_usage;
          if (!usage) return <span className="text-tertiary text-xs">-</span>;

          return (
            <div className="text-xs text-tertiary">
              <div>DocDB: {formatBytes(usage.docdb_bytes)}</div>
              <div>VDB: {formatBytes(usage.vectordb_bytes)}</div>
            </div>
          );
        },
      }),
    ],
    [t],
  );

  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      rowSelection,
    },
    enableRowSelection: true,
  });

  if (loading) {
    return <FilesTableSkeleton />;
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title={t('empty_title')}
        description={t('empty_cta')}
        action={
          onUploadClick
            ? {
                label: t('upload_files'),
                onClick: onUploadClick,
              }
            : undefined
        }
      />
    );
  }

  return <DataTable table={table} compact={compact} testId="files__table" />;
}
