'use client';

import * as React from 'react';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { RefreshCw, Trash2 } from 'lucide-react';

import type { UserExternalConnection } from '@/lib/api';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

import { formatDateTime, statusBadgeTone } from '../third-party-accounts-utils';

const columnHelper = createColumnHelper<UserExternalConnection>();

interface ThirdPartyAccountsTableProps {
  items: UserExternalConnection[];
  onDelete: (id: string) => void;
  onEdit: (item: UserExternalConnection) => void;
  onRefresh: (id: string) => void;
  t: (key: string) => string;
}

export function ThirdPartyAccountsTable({
  items,
  onDelete,
  onEdit,
  onRefresh,
  t,
}: ThirdPartyAccountsTableProps) {
  const columns = React.useMemo(
    () => [
      columnHelper.accessor('display_name', {
        header: t('table_name'),
        cell: ({ row }) => (
          <button
            type="button"
            className="text-left"
            onClick={() => onEdit(row.original)}
            data-testid={`third-party-accounts__row-${row.original.id}`}
          >
            <div className="font-medium text-primary">{row.original.display_name}</div>
            <div className="text-xs text-tertiary">
              {row.original.provider === 'custom'
                ? row.original.custom_domain || t('provider_custom')
                : t(`provider_${row.original.provider}`)}
            </div>
          </button>
        ),
      }),
      columnHelper.accessor('kind', {
        header: t('table_kind'),
        cell: (info) => <span className="text-tertiary">{t(`kind_${info.getValue()}`)}</span>,
      }),
      columnHelper.accessor('status', {
        header: t('table_status'),
        cell: (info) => (
          <StatusBadge status={statusBadgeTone(info.getValue())}>
            {t(`status_${info.getValue()}`)}
          </StatusBadge>
        ),
      }),
      columnHelper.display({
        id: 'fields',
        header: t('table_fields'),
        cell: ({ row }) => (
          <span className="text-tertiary">
            {row.original.fields.map((field) => field.key).join(', ') || '—'}
          </span>
        ),
      }),
      columnHelper.accessor('updated_at', {
        header: t('table_updated'),
        cell: (info) => <span className="text-tertiary">{formatDateTime(info.getValue())}</span>,
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {row.original.provider === 'feishu' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRefresh(row.original.id)}
                data-testid={`third-party-accounts__refresh-${row.original.id}`}
                title={t('refresh_connection')}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="text-error hover:text-error"
              onClick={() => onDelete(row.original.id)}
              data-testid={`third-party-accounts__delete-${row.original.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ),
      }),
    ],
    [onDelete, onEdit, onRefresh, t],
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return <DataTable table={table} testId="third-party-accounts__table" />;
}
