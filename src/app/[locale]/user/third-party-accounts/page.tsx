'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UserExternalConnectionsAPI,
  getApiClient,
  handleErrorForToast,
} from '@/lib/api';
import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';
import type {
  CreateUserExternalConnectionRequest,
  UpdateUserExternalConnectionRequest,
  UserExternalConnectionField,
  UserExternalConnection,
  UserExternalConnectionFieldInput,
} from '@/lib/api';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus } from 'lucide-react';

import { ConnectionFormFields } from './_components/ConnectionFormFields';
import { ThirdPartyAccountsTable } from './_components/ThirdPartyAccountsTable';
import {
  clearVisualThirdPartyAccountsSeed,
  readVisualThirdPartyAccountsSeed,
} from './third-party-accounts-visual-seed';
import {
  CUSTOM_CONNECTION_KIND,
  CUSTOM_CONNECTION_PROVIDER,
  createEmptyField,
} from './third-party-accounts-utils';

export default function ThirdPartyAccountsPage() {
  const t = useTranslations('third_party_accounts');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const api = React.useMemo(() => new UserExternalConnectionsAPI(getApiClient()), []);
  const runtimeConfig = React.useMemo(() => getPublicRuntimeConfig(), []);
  const [mswReady, setMswReady] = React.useState(() => !runtimeConfig.useMsw);
  const visualSeedItems = React.useMemo(
    () => readVisualThirdPartyAccountsSeed({ enabled: runtimeConfig.useMsw }),
    [runtimeConfig.useMsw],
  );

  React.useEffect(() => {
    if (!visualSeedItems) return;
    clearVisualThirdPartyAccountsSeed();
  }, [visualSeedItems]);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<UserExternalConnection | null>(null);

  const [displayName, setDisplayName] = React.useState('');
  const [note, setNote] = React.useState('');
  const [customDomain, setCustomDomain] = React.useState('');
  const [fields, setFields] = React.useState<UserExternalConnectionFieldInput[]>([createEmptyField()]);

  React.useEffect(() => {
    if (mswReady) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      setMswReady(true);
      return;
    }
    let cancelled = false;
    navigator.serviceWorker.ready.then(() => {
      if (cancelled) return;
      if (navigator.serviceWorker.controller) {
        setMswReady(true);
        return;
      }
      const onControllerChange = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        if (!cancelled) {
          setMswReady(true);
        }
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    }).catch(() => {
      if (!cancelled) setMswReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [mswReady]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['me', 'external-connections'],
    queryFn: () => api.list(),
    initialData: visualSeedItems ?? undefined,
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: mswReady,
  });

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['me', 'external-connections'] });
  }, [queryClient]);

  const resetForm = React.useCallback(() => {
    setDisplayName('');
    setNote('');
    setCustomDomain('');
    setFields([createEmptyField()]);
    setEditing(null);
  }, []);

  const createMutation = useMutation({
    mutationFn: (payload: CreateUserExternalConnectionRequest) => api.create(payload),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      resetForm();
    },
    onError: (error) => handleErrorForToast(error),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserExternalConnectionRequest }) =>
      api.update(id, payload),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      resetForm();
    },
    onError: (error) => handleErrorForToast(error),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
    },
    onError: (error) => handleErrorForToast(error),
  });

  const openCreateDialog = () => {
    resetForm();
    setCreateOpen(true);
  };

  const openEditDialog = (item: UserExternalConnection) => {
    setEditing(item);
    setDisplayName(item.display_name);
    setNote(item.note ?? '');
    setCustomDomain(item.custom_domain ?? '');
    setFields(
      item.fields.length > 0
        ? item.fields.map((field: UserExternalConnectionField) => ({
            key: field.key,
            value: field.secret ? '' : (field.masked_value ?? ''),
            description: field.description ?? '',
            secret: field.secret,
          }))
        : [createEmptyField()]
    );
    setCreateOpen(true);
  };

  const handleSheetOpenChange = React.useCallback((open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      resetForm();
    }
  }, [resetForm]);

  const saveConnection = () => {
    const sanitizedFields = fields
      .map((field: UserExternalConnectionFieldInput) => ({
        key: field.key.trim(),
        value: field.value,
        description: field.description?.trim() || undefined,
        secret: field.secret !== false,
      }))
      .filter((field) => field.key && (field.value || (editing && field.secret)));

    const payloadBase = {
      custom_domain: customDomain.trim() || undefined,
      display_name: displayName.trim(),
      note: note.trim() || null,
      status: 'active' as const,
      fields: sanitizedFields,
    };

    if (!payloadBase.display_name) return;
    if (!payloadBase.custom_domain) return;

    if (editing) {
      updateMutation.mutate({ id: editing.id, payload: payloadBase });
      return;
    }

    createMutation.mutate({
      provider: CUSTOM_CONNECTION_PROVIDER,
      kind: CUSTOM_CONNECTION_KIND,
      ...payloadBase,
    });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const canSubmit = (() => {
    if (!displayName.trim()) return false;
    return Boolean(customDomain.trim());
  })();
  return (
    <PageState state="success">
      <PageLayout contentWidth="narrow">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 md:px-5 md:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
              <p className="text-sm text-tertiary">{t('description')}</p>
              <p className="text-sm leading-6 text-tertiary">{t('personal_scope_note')}</p>
              <p className="text-sm leading-6 text-secondary" data-testid="third-party-accounts__capability-note">
                {t('agent_capability_note')}
              </p>
            </div>
            <Button variant="action" onClick={openCreateDialog} data-testid="third-party-accounts__create-btn">
              <Plus className="w-4 h-4" />
              {t('create_personal_connection')}
            </Button>
          </div>

          <section className="rounded-md border border-subtle bg-surface" data-testid="third-party-accounts__list-section">
            <div className="flex items-center justify-between gap-3 border-b border-subtle/60 px-4 py-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-secondary">
                  {t('list_title')}
                </h2>
                <p className="mt-1 text-sm text-tertiary">{t('list_description')}</p>
              </div>
              <div className="rounded-full border border-border/70 bg-surface-high px-3 py-1 text-xs font-medium text-secondary">
                {t('summary_total_label', { count: String(items.length) })}
              </div>
            </div>
            <div className="px-4 py-4">
              {isLoading ? (
                <div className="py-12 text-sm text-tertiary">{commonT('loading')}</div>
              ) : items.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-surface-high/70 px-6 py-16 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-subtle text-tertiary">
                    <Plus className="w-5 h-5" />
                  </div>
                  <p className="mb-2 text-foreground font-medium">{t('empty_title')}</p>
                  <p className="mx-auto mb-5 max-w-xl text-sm leading-6 text-tertiary">{t('empty_description')}</p>
                  <Button variant="action" onClick={openCreateDialog}>
                    <Plus className="w-4 h-4" />
                    {t('create_personal_connection')}
                  </Button>
                </div>
              ) : (
                <ThirdPartyAccountsTable
                  items={items}
                  onDelete={setDeleteId}
                  onEdit={openEditDialog}
                  t={t}
                />
              )}
            </div>
          </section>
        </div>

        <Sheet open={createOpen} onOpenChange={handleSheetOpenChange}>
          <SheetContent
            side="right-wide"
            className="flex h-full flex-col gap-0 overflow-hidden p-0"
            data-testid="third-party-accounts__sheet"
          >
            <SheetHeader className="border-b border-subtle px-6 py-4">
              <SheetTitle>{editing ? t('edit_title') : t('create_title')}</SheetTitle>
              <SheetDescription>{t('dialog_description')}</SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <ConnectionFormFields
                  createEmptyField={createEmptyField}
                  customDomain={customDomain}
                  displayName={displayName}
                  editing={Boolean(editing)}
                  fields={fields}
                  note={note}
                  t={t}
                  onCustomDomainChange={setCustomDomain}
                  onDisplayNameChange={setDisplayName}
                  onFieldsChange={setFields}
                  onNoteChange={setNote}
                />
              </div>

              <div className="flex flex-shrink-0 justify-end gap-2 border-t border-subtle px-6 py-4">
                <Button variant="outline" onClick={() => handleSheetOpenChange(false)} disabled={isPending}>
                  {commonT('cancel')}
                </Button>
                <Button
                  variant="action"
                  onClick={saveConnection}
                  disabled={isPending || !canSubmit}
                  data-testid="third-party-accounts__submit-btn"
                >
                  {editing ? t('save') : t('create')}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('delete_confirm_description')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{commonT('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
                className="bg-error hover:bg-error/90"
              >
                {commonT('delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageLayout>
    </PageState>
  );
}
