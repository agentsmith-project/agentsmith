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
import { MoreHorizontal, Settings, Trash2, History } from 'lucide-react';
import { EmptyState } from '@/components/ui/loading';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import type { Member } from '@/lib/api/endpoints/members';
import { formatRelativeTime } from '@/lib/utils/formatters';

const columnHelper = createColumnHelper<Member>();

function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export interface MembersTableProps {
  data: Member[];
  loading?: boolean;
  onEditPermissions?: (member: Member) => void;
  onRemove?: (member: Member) => void;
  onViewHistory?: (member: Member) => void;
}

export function MembersTable({
  data,
  loading = false,
  onEditPermissions,
  onRemove,
  onViewHistory,
}: MembersTableProps) {
  const t = useTranslations('members');
  const canManage = useHasPermission('project:member:manage');
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const columns = React.useMemo(
    () => [
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
                  {member.name.charAt(0).toUpperCase()}
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
        header: t('table.role'),
        cell: (info) => (
          <Badge variant="outline" className="text-xs">
            {formatRole(info.getValue())}
          </Badge>
        ),
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
                  : status === 'blocked'
                    ? 'destructive'
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
                {onEditPermissions && (
                  <DropdownMenuItem onClick={() => onEditPermissions(member)}>
                <Settings className="h-4 w-4 mr-2" />
                {t('actions.edit_permissions_quota')}
              </DropdownMenuItem>
                )}
                {onViewHistory && (
                  <DropdownMenuItem onClick={() => onViewHistory(member)}>
                <History className="h-4 w-4 mr-2" />
                {t('actions.view_history')}
              </DropdownMenuItem>
                )}
                {onRemove && member.role !== 'owner' && (
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
    [t, canManage, onEditPermissions, onRemove, onViewHistory]
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

  return <DataTable table={table} />;
}
