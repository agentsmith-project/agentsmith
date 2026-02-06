'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Key, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserAPIKeyService, getApiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import type { UserAPIKey } from '@/lib/api/types';
import { handleErrorForToast } from '@/lib/api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { KeyCreatedDialog } from '@/components/api-keys/KeyCreatedDialog';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';

const columnHelper = createColumnHelper<UserAPIKey>();

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

export default function UserAPIKeysPage() {
  const t = useTranslations('user_keys');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const api = React.useMemo(() => new UserAPIKeyService(getApiClient()), []);

  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [keyCreatedDialog, setKeyCreatedDialog] = React.useState<{ key: string; keyPrefix: string } | null>(null);
  const [revokeKeyId, setRevokeKeyId] = React.useState<string | null>(null);
  const [createNote, setCreateNote] = React.useState('');
  const [createExpiresIn, setCreateExpiresIn] = React.useState<string>('');

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['user', 'keys'],
    queryFn: () => api.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: { note?: string; expires_in?: number }) => api.create(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['user', 'keys'] });
      setCreateDialogOpen(false);
      setCreateNote('');
      setCreateExpiresIn('');
      if (data.key || data.key_prefix) {
        setKeyCreatedDialog({ key: data.key ?? '', keyPrefix: data.key_prefix });
      }
    },
    onError: (error) => handleErrorForToast(error),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => api.revoke(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', 'keys'] });
      setRevokeKeyId(null);
    },
    onError: (error) => handleErrorForToast(error),
  });

  const handleCreate = () => {
    const expiresIn = createExpiresIn ? parseInt(createExpiresIn, 10) : undefined;
    if (expiresIn !== undefined && (isNaN(expiresIn) || expiresIn <= 0)) return;
    createMutation.mutate({
      note: createNote.trim() || undefined,
      expires_in: expiresIn,
    });
  };

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
        cell: (info) => (
          <span className="text-primary">{info.getValue() || '—'}</span>
        ),
      }),
      columnHelper.accessor('created_at', {
        header: t('created'),
        cell: (info) => {
          const val = info.getValue();
          return (
            <span className="text-tertiary">
              {val ? formatRelativeTime(new Date(val)) : '—'}
            </span>
          );
        },
      }),
      columnHelper.accessor('last_used_at', {
        header: t('last_used'),
        cell: (info) => {
          const val = info.getValue();
          return (
            <span className="text-tertiary">
              {val ? formatRelativeTime(new Date(val)) : '—'}
            </span>
          );
        },
      }),
      columnHelper.accessor('expires_at', {
        header: t('expires'),
        cell: (info) => {
          const val = info.getValue();
          return (
            <span className="text-tertiary">
              {val ? formatRelativeTime(new Date(val)) : t('expiration_never')}
            </span>
          );
        },
      }),
      columnHelper.accessor('status', {
        header: '',
        cell: (info) => {
          const status = info.getValue();
          const badgeStatus =
            status === 'active'
              ? 'active'
              : status === 'suspended'
                ? 'paused'
                : 'error';
          return (
            <StatusBadge status={badgeStatus}>
              {status}
            </StatusBadge>
          );
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
              onClick={() => setRevokeKeyId(row.original.id)}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          ) : null,
      }),
    ],
    [t]
  );

  const table = useReactTable({
    data: keys,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <PageState state="success">
      <PageLayout>
        <div className="max-w-5xl mx-auto w-full p-6">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
            <p className="text-tertiary mt-1">
              Manage API keys for authenticating your applications.
            </p>
          </div>
          <Button variant="action" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-4 h-4" />
            {t('create')}
          </Button>
        </div>

        {isLoading ? (
          <div className="text-tertiary py-12">Loading...</div>
        ) : keys.length === 0 ? (
          <div className="py-20 text-center border border-border rounded-md bg-surface">
            <Key className="w-12 h-12 text-tertiary mx-auto mb-4" />
            <p className="text-foreground font-medium mb-2">No API keys yet</p>
            <p className="text-tertiary mb-4">
              Create an API key to authenticate your applications.
            </p>
            <Button variant="action" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4" />
              {t('create')}
            </Button>
          </div>
        ) : (
          <DataTable table={table} />
        )}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('create')}</DialogTitle>
            <DialogDescription>
              Create a new API key. You can add an optional note and expiration.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('note')}</label>
              <Input
                value={createNote}
                onChange={(e) => setCreateNote(e.target.value)}
                placeholder={t('note')}
                disabled={createMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('expires')}</label>
              <Input
                type="number"
                min="1"
                value={createExpiresIn}
                onChange={(e) => setCreateExpiresIn(e.target.value)}
                placeholder={t('expiration_never')}
                disabled={createMutation.isPending}
              />
              <p className="text-xs text-tertiary">Leave empty for no expiration (days)</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={createMutation.isPending}
            >
              {commonT('cancel')}
            </Button>
            <Button
              variant="action"
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : t('create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <KeyCreatedDialog
        open={!!keyCreatedDialog}
        onOpenChange={(open) => !open && setKeyCreatedDialog(null)}
        keyValue={keyCreatedDialog?.key || null}
        keyPrefix={keyCreatedDialog?.keyPrefix}
        scope="user"
      />

      <AlertDialog open={!!revokeKeyId} onOpenChange={() => setRevokeKeyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('revoke_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('revoke_confirm_hint')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{commonT('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeKeyId && revokeMutation.mutate(revokeKeyId)}
              className="bg-error hover:bg-error/90"
            >
              {t('revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </div>
      </PageLayout>
    </PageState>
  );
}
