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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { MoreHorizontal, Trash2, History } from 'lucide-react';
import { EmptyState } from '@/components/ui/loading';
import type { Member } from '@/lib/api/endpoints/members';
import { formatRelativeTime } from '@/lib/utils/formatters';

const columnHelper = createColumnHelper<Member>();

function formatGroupAlias(groupAlias: string): string {
  switch (groupAlias) {
    case 'owner':
      return 'Governance';
    case 'admin':
      return 'Manager';
    case 'developer':
      return 'Operator';
    case 'user':
      return 'Member';
    default:
      return groupAlias.charAt(0).toUpperCase() + groupAlias.slice(1);
  }
}

function getGroupBadgeVariant(groupAlias: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (groupAlias) {
    case 'owner':
      return 'default';
    case 'admin':
      return 'secondary';
    case 'developer':
    case 'user':
      return 'outline';
    default:
      return 'outline';
  }
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export interface MembersTableProps {
  data: Member[];
  loading?: boolean;
  enableSelection?: boolean;
  selectedMemberIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onViewMember?: (member: Member) => void;
  onRemove?: (member: Member) => void;
  onViewHistory?: (member: Member) => void;
}

export function MembersTable({
  data,
  loading = false,
  enableSelection = false,
  selectedMemberIds = [],
  onSelectionChange,
  onViewMember,
  onRemove,
  onViewHistory,
}: MembersTableProps) {
  const t = useTranslations('members');
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const selectableIds = React.useMemo(
    () =>
      new Set(
        data
          .filter((m) => m.status === 'active')
          .map((m) => m.id),
      ),
    [data],
  );

  const columns = React.useMemo(
    () => [
      ...(enableSelection
        ? [
            columnHelper.display({
              id: 'select',
              header: () => {
                const allSelectableSelected =
                  selectableIds.size > 0 &&
                  selectedMemberIds.length === selectableIds.size;
                return (
                  <Checkbox
                    checked={allSelectableSelected}
                    onCheckedChange={(value) => {
                      if (value) {
                        onSelectionChange?.(Array.from(selectableIds));
                      } else {
                        onSelectionChange?.([]);
                      }
                    }}
                    aria-label={t('batch.clear_selection')}
                  />
                );
              },
              cell: ({ row }) => {
                const member = row.original;
                if (member.status !== 'active') {
                  return <div className="w-4" />;
                }
                const isSelected = selectedMemberIds.includes(member.id);
                return (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(value) => {
                      if (value) {
                        onSelectionChange?.([...selectedMemberIds, member.id]);
                      } else {
                        onSelectionChange?.(selectedMemberIds.filter((id) => id !== member.id));
                      }
                    }}
                    aria-label={`Select ${member.name || member.email}`}
                  />
                );
              },
              enableSorting: false,
            }),
          ]
        : []),
      columnHelper.accessor('name', {
        header: t('table.user'),
        cell: (info) => {
          const member = info.row.original;
          return (
            <div className="flex items-center gap-3">
              {member.avatar ? (
                <img
                  src={member.avatar}
                  alt={member.name}
                  className="h-8 w-8 rounded-full"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-surface-high flex items-center justify-center text-xs font-medium text-foreground">
                  {(member.name || member.email || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{member.name}</span>
                <span className="text-xs text-tertiary">{member.email}</span>
              </div>
            </div>
          );
        },
      }),
      columnHelper.accessor('role', {
        header: t('table.access_group'),
        cell: (info) => {
          const accessGroup = info.getValue();
          return (
            <Badge variant={getGroupBadgeVariant(accessGroup)} className="text-xs font-medium">
              {formatGroupAlias(accessGroup)}
            </Badge>
          );
        },
      }),
      columnHelper.accessor('status', {
        header: t('table.status'),
        cell: (info) => {
          const status = info.getValue();
          return (
            <Badge
              variant={
                status === 'active'
                  ? 'default'
                  : 'secondary'
              }
              className="text-xs"
            >
              {formatStatus(status)}
            </Badge>
          );
        },
      }),
      columnHelper.accessor('joined_at', {
        header: t('table.joined'),
        cell: (info) => (
          <span className="text-sm text-tertiary">
            {formatRelativeTime(info.getValue())}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: t('table.actions'),
        cell: (info) => {
          const member = info.row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onViewHistory && (
                  <DropdownMenuItem onClick={() => onViewHistory(member)}>
                <History className="h-4 w-4 mr-2" />
                {t('actions.view_history')}
              </DropdownMenuItem>
                )}
                {onRemove && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onRemove(member)}
                      className="text-error"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      {t('actions.remove_member')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
    ],
    [t, enableSelection, selectableIds, selectedMemberIds, onSelectionChange, onRemove, onViewHistory]
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
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-surface-high rounded-md animate-pulse" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title={t('table.no_members')}
        description={t('table.no_members_description')}
      />
    );
  }

  return (
    <DataTable
      table={table}
      testId="members__table"
      compact
      onRowClick={onViewMember}
      isRowClickable={(member) => member.status === 'active'}
    />
  );
}
