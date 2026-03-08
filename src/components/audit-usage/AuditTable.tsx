'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  createColumnHelper,
  type SortingState,
  type VisibilityState,
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
import { MoreHorizontal, Copy, Eye, Columns3 } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { FilesTableSkeleton } from '@/components/files/FilesTableSkeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import type { AuditEvent } from '@/lib/api/types';

const columnHelper = createColumnHelper<AuditEvent>();
const AUDIT_COLUMN_VISIBILITY_KEY = 'agentsmith.audit.table.anchor_columns.v1';

function loadAuditColumnVisibility(): VisibilityState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(AUDIT_COLUMN_VISIBILITY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as VisibilityState;
  } catch {
    return {};
  }
}

function persistAuditColumnVisibility(state: VisibilityState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUDIT_COLUMN_VISIBILITY_KEY, JSON.stringify(state));
  } catch {
    // Ignore persistence errors, table remains functional.
  }
}

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
  const t = useTranslations('audit');
  const commonT = useTranslations('common');
  const toastT = useTranslations('common.toast');
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'timestamp', desc: true },
  ]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});

  React.useEffect(() => {
    setColumnVisibility(loadAuditColumnVisibility());
  }, []);

  React.useEffect(() => {
    persistAuditColumnVisibility(columnVisibility);
  }, [columnVisibility]);

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
        cell: (info) => (
          <Badge variant="outline" className="text-xs">
            {info.getValue()}
          </Badge>
        ),
      }),
      columnHelper.accessor('actor_type', {
        id: 'actor',
        header: t('table.actor'),
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
        header: t('table.end_user'),
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
        header: t('table.resource'),
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
      columnHelper.accessor('request_id', {
        header: t('table.request_id'),
        cell: (info) => {
          const requestId = info.getValue();
          if (!requestId) return <span className="text-tertiary">—</span>;
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
                  toast.success(toastT('copied'));
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          );
        },
        size: 200,
      }),
      columnHelper.accessor('decision_id', {
        header: t('table.decision_id'),
        cell: (info) => {
          const decisionId = info.getValue();
          if (!decisionId) return <span className="text-tertiary">—</span>;
          const displayId = truncateId(decisionId, 12);
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
                    <p className="font-mono">{decisionId}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  navigator.clipboard.writeText(decisionId);
                  toast.success(toastT('copied'));
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          );
        },
        size: 200,
      }),
      columnHelper.accessor('trace_ref', {
        header: t('table.trace_ref'),
        cell: (info) => {
          const traceRef = info.getValue();
          if (!traceRef) return <span className="text-tertiary">—</span>;
          const displayId = truncateId(traceRef, 12);
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
                    <p className="font-mono">{traceRef}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  navigator.clipboard.writeText(traceRef);
                  toast.success(toastT('copied'));
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
        header: t('table.error_code'),
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
    [onViewDetails, t, commonT, toastT],
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      columnVisibility,
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
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="audit__column-settings">
              <Columns3 className="mr-2 h-4 w-4" />
              {t('table.column_settings')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {anchorColumns.map((column) => {
              const visible = table.getColumn(column.id)?.getIsVisible() ?? true;
              return (
                <DropdownMenuItem
                  key={column.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    table.getColumn(column.id)?.toggleVisibility(!visible);
                  }}
                  data-testid={`audit__column-toggle-${column.id}`}
                >
                  <span className="inline-block w-4 text-xs">{visible ? '✓' : ''}</span>
                  <span>{column.label}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <DataTable table={table} testId="audit__table" />
    </div>
  );
}
