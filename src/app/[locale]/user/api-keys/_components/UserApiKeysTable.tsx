'use client';

import * as React from 'react';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Key, Trash2 } from 'lucide-react';

import type { UserAPIKey } from '@/lib/api/types';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

import { formatRelativeTime } from '../api-keys-utils';

const columnHelper = createColumnHelper<UserAPIKey>();

interface UserApiKeysTableProps {
  items: UserAPIKey[];
  onRevoke: (keyId: string) => void;
  t: (key: string) => string;
}

export function UserApiKeysTable({ items, onRevoke, t }: UserApiKeysTableProps) {
  const columns = React.useMemo(
    () => [
      columnHelper.accessor('key_prefix', {
        header: t('prefix'),
        cell: (info) => (
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-icon-default" />
            <code className="text-sm font-mono text-primary">{info.getValue()}</code>
          </div>
        ),
      }),
      columnHelper.accessor('note', {
        header: t('note'),
        cell: (info) => <span className="text-primary">{info.getValue() || '—'}</span>,
      }),
      columnHelper.accessor('created_at', {
        header: t('created'),
        cell: (info) => {
          const value = info.getValue();
          return <span className="text-tertiary">{value ? formatRelativeTime(new Date(value)) : '—'}</span>;
        },
      }),
      columnHelper.accessor('last_used_at', {
        header: t('last_used'),
        cell: (info) => {
          const value = info.getValue();
          return <span className="text-tertiary">{value ? formatRelativeTime(new Date(value)) : '—'}</span>;
        },
      }),
      columnHelper.accessor('expires_at', {
        header: t('expires'),
        cell: (info) => {
          const value = info.getValue();
          return <span className="text-tertiary">{value ? formatRelativeTime(new Date(value)) : t('expiration_never')}</span>;
        },
      }),
      columnHelper.accessor('status', {
        header: '',
        cell: (info) => {
          const status = info.getValue();
          const badgeStatus = status === 'active' ? 'active' : status === 'suspended' ? 'paused' : 'error';
          return <StatusBadge status={badgeStatus}>{status}</StatusBadge>;
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.status === 'active' ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-error hover:text-error"
              onClick={() => onRevoke(row.original.id)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          ) : null,
      }),
    ],
    [onRevoke, t],
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return <DataTable table={table} testId="api-keys__table" />;
}
