'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Key } from 'lucide-react';
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

  return (
    <PageState state="success">
      <PageLayout>
        <div className="max-w-6xl mx-auto w-full px-4 py-4 md:px-5 md:py-5">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
            <p className="text-tertiary mt-1">
              Manage API keys for authenticating your applications.
            </p>
          </div>
          <Button variant="action" onClick={() => setCreateDialogOpen(true)} data-testid="api-keys__create-btn">
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
          <UserApiKeysTable items={keys} onRevoke={setRevokeKeyId} t={t} />
        )}

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
