'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Key, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgentAPI, getApiClient } from '@/lib/api';
import type { AgentServiceKey } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
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

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['agents', workspaceId, projectId, agentId, 'keys'],
    queryFn: () => api.listKeys(workspaceId, projectId, agentId),
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-icon-default" />
              {t('keys_title')} — {agentName}
            </DialogTitle>
            <DialogDescription>
              {t('keys_description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex justify-end">
              <Button
                variant="action"
                size="sm"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
              >
                <Plus className="w-4 h-4" />
                {keysT('create')}
              </Button>
            </div>
            {isLoading ? (
              <div className="text-tertiary py-8 text-center">Loading...</div>
            ) : activeKeys.length === 0 ? (
              <div className="py-8 text-center border border-border rounded-md bg-surface">
                <Key className="w-10 h-10 text-tertiary mx-auto mb-2" />
                <p className="text-secondary text-sm">{t('keys_empty')}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {activeKeys.map((k) => (
                  <AgentKeyRow
                    key={k.id}
                    item={k}
                    onRevoke={() => setRevokeKeyId(k.id)}
                  />
                ))}
              </div>
            )}
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

function AgentKeyRow({ item, onRevoke }: { item: AgentServiceKey; onRevoke: () => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-sm bg-surface-high border border-subtle">
      <div className="flex items-center gap-2 min-w-0">
        <Key className="w-4 h-4 text-icon-default flex-shrink-0" />
        <code className="text-sm font-mono text-primary truncate">{item.key_prefix}</code>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-xs text-tertiary">
          {item.created_at ? formatRelativeTime(new Date(item.created_at)) : '—'}
        </span>
        <Button variant="ghost" size="sm" className="text-error hover:text-error" onClick={onRevoke}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
