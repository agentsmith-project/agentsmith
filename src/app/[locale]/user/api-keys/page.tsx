'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Key, Clock3, ShieldCheck, TriangleAlert } from 'lucide-react';
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

  const activeKeys = React.useMemo(() => keys.filter((item) => item.status === 'active'), [keys]);
  const recentlyUsedKeys = React.useMemo(() => keys.filter((item) => item.last_used_at), [keys]);
  const expiringKeys = React.useMemo(
    () =>
      keys.filter((item) => {
        if (!item.expires_at || item.status !== 'active') return false;
        const expiresAt = new Date(item.expires_at).getTime();
        const threshold = Date.now() + 1000 * 60 * 60 * 24 * 30;
        return expiresAt <= threshold;
      }),
    [keys],
  );

  return (
    <PageState state="success">
      <PageLayout>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-4 md:px-5 md:py-5">
          <section className="rounded-lg border border-border bg-surface px-5 py-5 shadow-card md:px-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t('summary_security_badge')}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
                  <p className="mt-1 text-sm text-tertiary">{t('page_description')}</p>
                </div>
                <p className="max-w-xl text-sm leading-6 text-secondary">{t('summary_intro')}</p>
              </div>
              <Button variant="action" onClick={() => setCreateDialogOpen(true)} data-testid="api-keys__create-btn">
                <Plus className="w-4 h-4" />
                {t('create')}
              </Button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-border/70 bg-surface-high p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                  <Key className="h-3.5 w-3.5 text-accent" />
                  {t('summary_active_label')}
                </div>
                <div className="mt-3 text-2xl font-semibold text-foreground">{activeKeys.length}</div>
                <p className="mt-1 text-sm text-tertiary">{t('summary_active_hint')}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-surface-high p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                  <Clock3 className="h-3.5 w-3.5 text-accent" />
                  {t('summary_recent_label')}
                </div>
                <div className="mt-3 text-2xl font-semibold text-foreground">{recentlyUsedKeys.length}</div>
                <p className="mt-1 text-sm text-tertiary">{t('summary_recent_hint')}</p>
              </div>
              <div className="rounded-md border border-border/70 bg-surface-high p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                  {t('summary_expiring_label')}
                </div>
                <div className="mt-3 text-2xl font-semibold text-foreground">{expiringKeys.length}</div>
                <p className="mt-1 text-sm text-tertiary">{t('summary_expiring_hint')}</p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-surface shadow-card">
            <div className="border-b border-border px-5 py-4 md:px-6">
              <div className="flex items-center justify-between gap-3">
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
            </div>

            <div className="px-5 py-5 md:px-6">
              {isLoading ? (
                <div className="py-12 text-sm text-tertiary">{t('list_loading')}</div>
              ) : isError ? (
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-6 py-8" data-testid="api-keys__error">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-warning/15 p-2.5 text-warning">
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
                <div className="rounded-lg border border-dashed border-border bg-surface-high/70 px-6 py-16 text-center" data-testid="api-keys__empty">
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
