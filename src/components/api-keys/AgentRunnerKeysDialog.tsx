'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Key } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgentRunnerAPI, getApiClient } from '@/lib/api';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { KeyCreatedDialog } from './KeyCreatedDialog';
import { useApiError } from '@/lib/hooks/use-api-error';
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
import { ConnectionInfoCard } from '@/components/api-keys/agent-runner-keys-dialog/ConnectionInfoCard';
import { KeysListSection } from '@/components/api-keys/agent-runner-keys-dialog/KeysListSection';

interface AgentRunnerKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  runnerId: string;
  runnerName: string;
}

export function AgentRunnerKeysDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  runnerId,
  runnerName,
}: AgentRunnerKeysDialogProps) {
  const t = useTranslations('agent_runners');
  const keysT = useTranslations('user_keys');
  const commonT = useTranslations('common');
  const { handleError } = useApiError();
  const queryClient = useQueryClient();
  const api = React.useMemo(() => new AgentRunnerAPI(getApiClient()), []);

  const [keyCreated, setKeyCreated] = React.useState<{ key: string; keyPrefix: string } | null>(null);
  const [revokeKeyId, setRevokeKeyId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['agent-runners', workspaceId, projectId, runnerId, 'keys'],
    queryFn: () => api.listKeys(workspaceId, projectId, runnerId),
    enabled: open && !!workspaceId && !!projectId && !!runnerId,
  });
  const { data: connectionInfo } = useQuery({
    queryKey: ['agent-runners', workspaceId, projectId, runnerId, 'connection-info'],
    queryFn: () => api.getConnectionInfo(workspaceId, projectId, runnerId),
    enabled: open && !!workspaceId && !!projectId && !!runnerId,
  });

  const createMutation = useMutation({
    mutationFn: () => api.createKey(workspaceId, projectId, runnerId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-runners', workspaceId, projectId, runnerId, 'keys'] });
      if (data.key || data.key_prefix) {
        setKeyCreated({ key: data.key ?? '', keyPrefix: data.key_prefix });
      }
    },
    onError: (error) => handleError(error, { context: t('keys_title') }),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => api.deleteKey(workspaceId, projectId, runnerId, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-runners', workspaceId, projectId, runnerId, 'keys'] });
      setRevokeKeyId(null);
    },
    onError: (error) => handleError(error, { context: keysT('revoke') }),
  });

  const activeKeys = keys.filter((k) => k.status === 'active');
  const onCopyWsUrl = async () => {
    if (!connectionInfo?.ws_url) return;
    await navigator.clipboard.writeText(connectionInfo.ws_url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  const handleOpenChange = (next: boolean) => {
    if (!next && (createMutation.isPending || revokeMutation.isPending)) {
      return;
    }

    onOpenChange(next);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right-wide"
          className="flex h-full flex-col gap-0 overflow-hidden p-0"
          data-testid="agent-runners__connection-keys-sheet"
        >
          <SheetHeader className="border-b border-subtle px-6 py-5">
            <SheetTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-icon-default" />
              {t('keys_title')} — {runnerName}
            </SheetTitle>
            <SheetDescription>{t('keys_description')}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-5">
              <ConnectionInfoCard
                copied={copied}
                copyLabel={copied ? commonT('copied') : commonT('copy')}
                title={t('connection_address')}
                wsUrl={connectionInfo?.ws_url}
                onCopy={() => {
                  void onCopyWsUrl();
                }}
              />

              <KeysListSection
                activeKeys={activeKeys}
                emptyLabel={t('keys_empty')}
                isLoading={isLoading}
                sectionTitle={t('keys_title')}
                onRevoke={setRevokeKeyId}
              />
            </div>
          </div>

          <div
            className="flex flex-shrink-0 justify-end gap-2 border-t border-subtle px-6 py-4"
            data-testid="agent-runners__connection-keys-footer"
          >
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={createMutation.isPending || revokeMutation.isPending}
            >
              {commonT('cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {keysT('create')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <KeyCreatedDialog
        open={!!keyCreated}
        onOpenChange={(open) => !open && setKeyCreated(null)}
        keyValue={keyCreated?.key || null}
        keyPrefix={keyCreated?.keyPrefix}
        scope="project"
      />

      <AlertDialog open={!!revokeKeyId} onOpenChange={() => setRevokeKeyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{keysT('revoke_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{keysT('revoke_confirm_hint')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{commonT('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeKeyId && revokeMutation.mutate(revokeKeyId)}
              className="bg-error hover:bg-error/90"
            >
              {keysT('revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
