'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Key } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgentAPI, getApiClient } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ConnectionInfoCard } from '@/components/api-keys/agent-keys-dialog/ConnectionInfoCard';
import { KeysListSection } from '@/components/api-keys/agent-keys-dialog/KeysListSection';

interface AgentKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  agentId: string;
  agentName: string;
}

export function AgentKeysDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  agentId,
  agentName,
}: AgentKeysDialogProps) {
  const t = useTranslations('agents');
  const keysT = useTranslations('user_keys');
  const commonT = useTranslations('common');
  const { handleError } = useApiError();
  const queryClient = useQueryClient();
  const api = React.useMemo(() => new AgentAPI(getApiClient()), []);

  const [keyCreated, setKeyCreated] = React.useState<{ key: string; keyPrefix: string } | null>(null);
  const [revokeKeyId, setRevokeKeyId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['agents', workspaceId, projectId, agentId, 'keys'],
    queryFn: () => api.listKeys(workspaceId, projectId, agentId),
    enabled: open && !!workspaceId && !!projectId && !!agentId,
  });
  const { data: connectionInfo } = useQuery({
    queryKey: ['agents', workspaceId, projectId, agentId, 'connection-info'],
    queryFn: () => api.getConnectionInfo(workspaceId, projectId, agentId),
    enabled: open && !!workspaceId && !!projectId && !!agentId,
  });

  const createMutation = useMutation({
    mutationFn: () => api.createKey(workspaceId, projectId, agentId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agents', workspaceId, projectId, agentId, 'keys'] });
      if (data.key || data.key_prefix) {
        setKeyCreated({ key: data.key ?? '', keyPrefix: data.key_prefix });
      }
    },
    onError: (error) => handleError(error, { context: t('keys_title') }),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => api.deleteKey(workspaceId, projectId, agentId, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', workspaceId, projectId, agentId, 'keys'] });
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(680px,calc(100vw-2rem))] max-w-[min(680px,calc(100vw-2rem))] overflow-x-hidden border-subtle bg-surface p-0">
          <DialogHeader className="border-b border-subtle px-6 pb-4 pt-6">
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-icon-default" />
              {t('keys_title')} — {agentName}
            </DialogTitle>
            <DialogDescription className="mt-1.5">
              {t('keys_description')}
            </DialogDescription>
          </DialogHeader>
          <div className="w-full max-w-full space-y-5 px-6 py-5">
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
              createPending={createMutation.isPending}
              createLabel={keysT('create')}
              emptyLabel={t('keys_empty')}
              isLoading={isLoading}
              sectionTitle={t('keys_title')}
              onCreate={() => createMutation.mutate()}
              onRevoke={setRevokeKeyId}
            />
          </div>
        </DialogContent>
      </Dialog>

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
