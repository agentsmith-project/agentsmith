'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Key, TriangleAlert } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserAPIKeyService, getApiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
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
import { KeyCreatedDialog } from '@/components/api-keys/KeyCreatedDialog';
import { CreateApiKeyDialog } from './_components/CreateApiKeyDialog';
import { UserApiKeysTable } from './_components/UserApiKeysTable';

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

  const { data: keys = [], isLoading, isError, refetch } = useQuery({
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

  return (
    <PageState state="success">
      <PageLayout contentWidth="narrow">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:px-5 md:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
              <p className="text-sm text-tertiary">{t('page_description')}</p>
            </div>
            <Button variant="action" onClick={() => setCreateDialogOpen(true)} data-testid="api-keys__create-btn">
              <Plus className="w-4 h-4" />
              {t('create')}
            </Button>
          </div>

          <section className="rounded-md border border-subtle bg-surface" data-testid="api-keys__list-section">
            <div className="flex items-center justify-between gap-3 border-b border-subtle/60 px-4 py-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-secondary">
                  {t('list_title')}
                </h2>
                <p className="mt-1 text-sm text-tertiary">{t('list_description')}</p>
              </div>
              <div className="rounded-full border border-border/70 bg-surface-high px-3 py-1 text-xs font-medium text-secondary">
                {t('summary_total_label', { count: String(keys.length) })}
              </div>
            </div>

            <div className="px-4 py-4">
              {isLoading ? (
                <div className="py-12 text-sm text-tertiary">{t('list_loading')}</div>
              ) : isError ? (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-5 py-7" data-testid="api-keys__error">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-md bg-warning/15 p-2.5 text-warning">
                      <TriangleAlert className="h-4 w-4" />
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-base font-semibold text-foreground">{t('list_error_title')}</p>
                        <p className="mt-1 text-sm leading-6 text-secondary">{t('list_error_description')}</p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Button variant="outline" onClick={() => void refetch()} data-testid="api-keys__retry-btn">
                          {commonT('retry')}
                        </Button>
                        <Button variant="action" onClick={() => setCreateDialogOpen(true)}>
                          <Plus className="w-4 h-4" />
                          {t('create')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : keys.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-surface-high/70 px-6 py-16 text-center" data-testid="api-keys__empty">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-border text-tertiary">
                    <Key className="h-6 w-6" />
                  </div>
                  <p className="mb-2 text-base font-medium text-foreground">{t('list_empty_title')}</p>
                  <p className="mx-auto mb-5 max-w-lg text-sm leading-6 text-tertiary">{t('list_empty_description')}</p>
                  <Button variant="action" onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="w-4 h-4" />
                    {t('create')}
                  </Button>
                </div>
              ) : (
                <UserApiKeysTable items={keys} onRevoke={setRevokeKeyId} t={t} />
              )}
            </div>
          </section>

          <CreateApiKeyDialog
            commonT={commonT}
            createExpiresIn={createExpiresIn}
            createNote={createNote}
            isPending={createMutation.isPending}
            open={createDialogOpen}
            t={t}
            onCreate={handleCreate}
            onCreateExpiresInChange={setCreateExpiresIn}
            onCreateNoteChange={setCreateNote}
            onOpenChange={setCreateDialogOpen}
          />

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
