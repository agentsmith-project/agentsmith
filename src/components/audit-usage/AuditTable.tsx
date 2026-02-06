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
import { MoreHorizontal, Copy, Eye } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { SourcesTableSkeleton } from '@/components/sources/SourcesTableSkeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import type { AuditEvent } from '@/lib/api/types';

const columnHelper = createColumnHelper<AuditEvent>();

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/, '$3-$1-$2 $4:$5:$6');
}

function truncateId(id: string, length: number = 8): string {
  if (id.length <= length) return id;
  return `${id.substring(0, length)}...`;
}

export interface AuditTableProps {
  data: AuditEvent[];
  loading?: boolean;
  onViewDetails?: (event: AuditEvent) => void;
  onClearFilters?: () => void;
}

export function AuditTable({
  data,
  loading = false,
  onViewDetails,
  onClearFilters,
}: AuditTableProps) {
  const t = useTranslations('common.toast');
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'timestamp', desc: true },
  ]);

  const columns = React.useMemo(
    () => [
      columnHelper.accessor('timestamp', {
        header: 'Timestamp',
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
        header: 'Action',
        cell: (info) => (
          <Badge variant="outline" className="text-xs">
            {info.getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor('actor_type', {
        id: 'actor',
        header: 'Actor',
        cell: (info) => {
          const event = info.row.original;
          const actorType = event.actor_type;
          const actorId = truncateId(event.actor_id, 8);
          const variant =
            actorType === 'user' ? 'default' : actorType === 'agent' ? 'secondary' : 'outline';
          return (
            <div className="flex items-center gap-2">
              <Badge variant={variant} className="text-xs">
                {actorType}
              </Badge>
              <span className="text-sm text-foreground">{actorId}</span>
            </div>
          );
        },
      }),
      columnHelper.accessor('end_user_id', {
        header: 'End User',
        cell: (info) => {
          const endUserId = info.getValue();
          if (!endUserId) return <span className="text-tertiary">—</span>;
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-sm text-foreground cursor-help">
                    {truncateId(endUserId, 8)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{endUserId}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
      }),
      columnHelper.accessor('resource_type', {
        id: 'resource',
        header: 'Resource',
        cell: (info) => {
          const event = info.row.original;
          const resourceType = event.resource_type;
          const resourceId = event.resource_id;
          if (!resourceType && !resourceId) return <span className="text-tertiary">—</span>;
          return (
            <div className="flex items-center gap-2">
              {resourceType && (
                <Badge variant="outline" className="text-xs">
                  {resourceType}
                </Badge>
              )}
              {resourceId && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-sm text-foreground cursor-help">
                        {truncateId(resourceId, 8)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{resourceId}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('result', {
        header: 'Result',
        cell: (info) => {
          const result = info.getValue();
          const variant = result === 'ok' ? 'default' : 'destructive';
          return (
            <Badge variant={variant} className="text-xs">
              {result === 'ok' ? 'Success' : 'Error'}
            </Badge>
          );
        },
        size: 100,
      }),
      columnHelper.accessor('request_id', {
        header: 'Request ID',
        cell: (info) => {
          const requestId = info.getValue();
          const displayId = truncateId(requestId, 12);
          return (
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-sm text-foreground cursor-help font-mono">
                      {displayId}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-mono">{requestId}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  navigator.clipboard.writeText(requestId);
                  toast.success(t('copied'));
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          );
        },
        size: 200,
      }),
      columnHelper.accessor('error_code', {
        header: 'Error Code',
        cell: (info) => {
          const event = info.row.original;
          if (event.result !== 'error' || !event.error_code) {
            return <span className="text-tertiary">—</span>;
          }
          return (
            <Badge variant="destructive" className="text-xs">
              {event.error_code}
            </Badge>
          );
        },
        size: 150,
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
                    View Details
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        size: 80,
      }),
    ],
    [onViewDetails, t],
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
        title="No audit events found"
        description="Try adjusting your filters or select a different time range"
        onClearFilters={onClearFilters}
      />
    );
  }

  return <DataTable table={table} />;
}
