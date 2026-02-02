'use client';
import * as React from 'react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, File, Download, Trash2, Play, X, RotateCw } from 'lucide-react';
import { AIReadyStatusBadge } from './AIReadyStatusBadge';
import { AIReadyProgress } from './AIReadyProgress';
import { EmptyState } from '@/components/ui/loading';
import { SourcesTableSkeleton } from './SourcesTableSkeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { SourceFileWithAIReady } from '@/lib/api/types';

import { formatBytes, formatRelativeTime } from '@/lib/utils/formatters';

const columnHelper = createColumnHelper<SourceFileWithAIReady>();

function getFileIcon(fileType: string) {
  // Simple icon based on file type - can be enhanced later
  return File;
}

export interface SourcesTableProps {
  data: SourceFileWithAIReady[];
  loading?: boolean;
  onRowSelect?: (selectedIds: string[]) => void;
  onStartAIReady?: (fileId: string) => void;
  onCancelAIReady?: (fileId: string) => void;
  onRetryAIReady?: (fileId: string) => void;
  onDelete?: (fileId: string) => void;
  onDownload?: (fileId: string) => void;
  onUploadClick?: () => void;
}

export function SourcesTable({
  data,
  loading = false,
  onRowSelect,
  onStartAIReady,
  onCancelAIReady,
  onRetryAIReady,
  onDelete,
  onDownload,
  onUploadClick,
}: SourcesTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  // Notify parent of selection changes
  React.useEffect(() => {
    if (onRowSelect) {
      const selectedIds = Object.keys(rowSelection).filter(
        (key) => rowSelection[key],
      );
      onRowSelect(selectedIds);
    }
  }, [rowSelection, onRowSelect]);

  const columns = React.useMemo(
    () => [
      // Selection column
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all files"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label={`Select ${row.original.filename || 'file'}`}
          />
        ),
        enableSorting: false,
      }),
      // Filename column
      columnHelper.accessor('filename', {
        header: 'Filename',
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
        header: 'Size',
        cell: (info) => (
          <span className="text-tertiary text-sm font-mono">
            {formatBytes(info.getValue())}
          </span>
        ),
      }),
      // Updated at column
      columnHelper.accessor('updated_at', {
        header: 'Updated',
        cell: (info) => (
          <span className="text-tertiary text-sm">
            {formatRelativeTime(info.getValue())}
          </span>
        ),
      }),
      // AIReady status column
      columnHelper.display({
        id: 'ai_ready_status',
        header: 'AIReady Status',
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
        header: 'Usage',
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
      // Actions column
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const file = info.row.original;
          const aiReady = file.ai_ready;
          const status = aiReady?.status || 'idle';

          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Actions for ${file.filename}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {status === 'idle' && onStartAIReady && (
                  <DropdownMenuItem
                    onClick={() => onStartAIReady(file.id)}
                    className="flex items-center gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Start AIReady
                  </DropdownMenuItem>
                )}
                {(status === 'preparing' || status === 'ready') && onCancelAIReady && (
                  <DropdownMenuItem
                    onClick={() => onCancelAIReady(file.id)}
                    className="flex items-center gap-2"
                  >
                    <X className="h-4 w-4" />
                    Cancel AIReady
                  </DropdownMenuItem>
                )}
                {status === 'failed' && (
                  <>
                    {onRetryAIReady && (
                      <DropdownMenuItem
                        onClick={() => onRetryAIReady(file.id)}
                        className="flex items-center gap-2"
                      >
                        <RotateCw className="h-4 w-4" />
                        Retry
                      </DropdownMenuItem>
                    )}
                    {onCancelAIReady && (
                      <DropdownMenuItem
                        onClick={() => onCancelAIReady(file.id)}
                        className="flex items-center gap-2"
                      >
                        <X className="h-4 w-4" />
                        Cancel AIReady
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {status === 'cancelled' && onStartAIReady && (
                  <DropdownMenuItem
                    onClick={() => onStartAIReady(file.id)}
                    className="flex items-center gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Start AIReady
                  </DropdownMenuItem>
                )}
                {onDownload && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDownload(file.id)}
                      className="flex items-center gap-2"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </DropdownMenuItem>
                  </>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete(file.id)}
                      className="flex items-center gap-2 text-error focus:text-error"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
    ],
    [onStartAIReady, onCancelAIReady, onRetryAIReady, onDelete, onDownload],
  );

  const table = useReactTable({
    data,
    columns,
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
    return <SourcesTableSkeleton />;
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title="No files yet"
        description="Upload your first file to get started"
        action={
          onUploadClick
            ? {
                label: 'Upload Files',
                onClick: onUploadClick,
              }
            : undefined
        }
      />
    );
  }

  return <DataTable table={table} />;
}
