'use client';

import { Key, RotateCcw, Trash2 } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import type { Credential } from '@/lib/api/types';
import { Button } from '@/components/ui/button';

const columnHelper = createColumnHelper<Credential>();

export function formatCredentialDate(iso: string | undefined): string {
  if (!iso) return '-';
  try {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function createCredentialColumns(args: {
  t: (key: string) => string;
  onRotate: (cred: Credential) => void;
  onDelete: (cred: Credential) => void;
  canManageCredentials: boolean;
  deletePending: boolean;
}) {
  const { t, onRotate, onDelete, canManageCredentials, deletePending } = args;

  return [
    columnHelper.accessor('name', {
      header: t('table.name'),
      cell: (info) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center">
            <Key className="w-4 h-4 text-icon-default" />
          </div>
          <span className="text-foreground font-medium">{info.getValue()}</span>
        </div>
      ),
    }),
    columnHelper.accessor('type', {
      header: t('table.type'),
      cell: (info) => <span className="text-tertiary text-sm capitalize">{info.getValue()}</span>,
    }),
    columnHelper.accessor('fingerprint', {
      header: t('fingerprint'),
      cell: (info) => <span className="text-tertiary text-sm font-mono">{info.getValue()}</span>,
    }),
    columnHelper.accessor('last_rotated_at', {
      header: t('table.last_rotated'),
      cell: (info) => <span className="text-tertiary text-sm">{formatCredentialDate(info.getValue())}</span>,
    }),
    columnHelper.display({
      id: 'actions',
      header: '',
      cell: (info) => (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRotate(info.row.original)}
            disabled={!canManageCredentials || deletePending}
            className="h-8 w-8 text-tertiary hover:text-foreground hover:bg-hover"
            title={t('rotate')}
            data-testid={`credentials__action-rotate--${info.row.original.id}`}
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onDelete(info.row.original)}
            disabled={!canManageCredentials || deletePending}
            className="h-8 w-8 text-error hover:bg-hover"
            title={t('delete')}
            data-testid={`credentials__action-delete--${info.row.original.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ),
    }),
  ];
}
