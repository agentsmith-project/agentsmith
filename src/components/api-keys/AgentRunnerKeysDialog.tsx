'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Activity, Key, Loader2, Play, Wifi } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AgentRunnerAPI, getApiClient } from '@/lib/api';
import type {
  AgentRunnerActions,
  AgentRunnerKind,
  AgentRunnerStatus,
  AgentRunnerTestConnectionResponse,
  AgentRunnerTestTaskRunAcceptedResponse,
} from '@/lib/api/types';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
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
import { deriveAgentRunnerKeysSheetState } from '@/components/api-keys/agent-runner-keys-dialog/utils';

interface AgentRunnerKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  projectId: string;
  runnerId: string;
  runnerName: string;
  runnerKind: AgentRunnerKind;
  readOnly: boolean;
  runnerStatus: AgentRunnerStatus;
  actions: AgentRunnerActions;
}

export function AgentRunnerKeysDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  runnerId,
  runnerName,
  runnerKind,
  readOnly,
  runnerStatus,
  actions,
}: AgentRunnerKeysDialogProps) {
  const t = useTranslations('agent_runners');
  const commonT = useTranslations('common');
  const { handleError } = useApiError();
  const queryClient = useQueryClient();
  const api = React.useMemo(() => new AgentRunnerAPI(getApiClient()), []);

  const [keyCreated, setKeyCreated] = React.useState<{ key: string; keyPrefix: string } | null>(null);
  const [revokeKeyId, setRevokeKeyId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [testConnectionResult, setTestConnectionResult] = React.useState<AgentRunnerTestConnectionResponse | null>(null);
  const [testConnectionFailed, setTestConnectionFailed] = React.useState(false);
  const [testTaskResult, setTestTaskResult] = React.useState<AgentRunnerTestTaskRunAcceptedResponse | null>(null);

  const isDeveloperConnection = runnerKind === 'developer' && !readOnly;
  const actionVisible = React.useCallback(
    (operation: keyof AgentRunnerActions) => isDeveloperConnection && actions[operation]?.visible === true,
    [actions, isDeveloperConnection],
  );
  const actionAllowed = React.useCallback(
    (operation: keyof AgentRunnerActions) => actions[operation]?.allowed === true,
    [actions],
  );

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['agent-runners', workspaceId, projectId, runnerId, 'keys'],
    queryFn: () => api.listKeys(workspaceId, projectId, runnerId),
    enabled: open && isDeveloperConnection && !!workspaceId && !!projectId && !!runnerId,
  });
  const { data: connectionInfo } = useQuery({
    queryKey: ['agent-runners', workspaceId, projectId, runnerId, 'connection-info'],
    queryFn: () => api.getConnectionInfo(workspaceId, projectId, runnerId),
    enabled: open && isDeveloperConnection && !!workspaceId && !!projectId && !!runnerId,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!actionVisible('issue_connection_key') || !actionAllowed('issue_connection_key')) {
        throw new Error('Agent Runner key issue action is not allowed');
      }
      return api.createKey(workspaceId, projectId, runnerId);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-runners', workspaceId, projectId, runnerId, 'keys'] });
      setTestConnectionResult(null);
      setTestConnectionFailed(false);
      setTestTaskResult(null);
      if (data.key || data.key_prefix) {
        setKeyCreated({ key: data.key ?? '', keyPrefix: data.key_prefix });
      }
    },
    onError: (error) => handleError(error, { context: t('connection_key_title') }),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => {
      if (!actionVisible('revoke_connection_key') || !actionAllowed('revoke_connection_key')) {
        throw new Error('Agent Runner key revoke action is not allowed');
      }
      return api.deleteKey(workspaceId, projectId, runnerId, keyId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-runners', workspaceId, projectId, runnerId, 'keys'] });
      setTestConnectionResult(null);
      setTestConnectionFailed(false);
      setTestTaskResult(null);
      setRevokeKeyId(null);
    },
    onError: (error) => handleError(error, { context: t('connection_key_revoke_action') }),
  });

  const testConnectionMutation = useMutation({
    mutationFn: () => {
      if (!actionVisible('test_connection') || !actionAllowed('test_connection')) {
        throw new Error('Agent Runner test connection action is not allowed');
      }
      return api.testConnection(workspaceId, projectId, runnerId, { timeout_ms: 5000 });
    },
    onMutate: () => {
      setTestConnectionFailed(false);
    },
    onSuccess: (data) => {
      setTestConnectionResult(data);
      setTestConnectionFailed(false);
      setTestTaskResult(null);
    },
    onError: (error) => {
      setTestConnectionResult(null);
      setTestConnectionFailed(true);
      setTestTaskResult(null);
      handleError(error, { context: t('test_connection_action') });
    },
  });

  const testTaskMutation = useMutation({
    mutationFn: () => {
      if (!actionVisible('run_test_task') || !actionAllowed('run_test_task')) {
        throw new Error('Agent Runner test task action is not allowed');
      }
      return api.createTestTaskRun(workspaceId, projectId, runnerId, { intent: 'developer_runner_connection_check' });
    },
    onMutate: () => {
      setTestTaskResult(null);
    },
    onSuccess: (data) => {
      setTestTaskResult(data);
    },
    onError: (error) => {
      setTestTaskResult(null);
      handleError(error, { context: t('run_test_task_action') });
    },
  });

  const sheetState = deriveAgentRunnerKeysSheetState({
    runnerKind,
    readOnly,
    runnerStatus,
    actions,
    keys,
    keyIssuedSecretVisible: keyCreated !== null,
    testConnectionResult,
    testConnectionFailed,
    createPending: createMutation.isPending,
    revokePending: revokeMutation.isPending,
    testConnectionPending: testConnectionMutation.isPending,
    testTaskPending: testTaskMutation.isPending,
  });
  const activeKeys = sheetState.activeKeys;
  const canIssueKey = sheetState.actionStates.issueKey.visible;
  const canRevokeKey = sheetState.actionStates.revokeKey.visible;
  const canTestConnection = sheetState.actionStates.testConnection.visible;
  const canRunTestTask = sheetState.actionStates.runTestTask.visible;
  const testConnectionEnabled = sheetState.actionStates.testConnection.enabled;
  const runTestTaskEnabled = sheetState.actionStates.runTestTask.enabled;

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
              {t('connection_key_title')} — {runnerName}
            </SheetTitle>
            <SheetDescription>{t('connection_key_description')}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {sheetState.isDeveloperConnection ? (
              <div className="space-y-5">
                <div
                  className="rounded-lg border border-subtle bg-surface-high/25 p-4"
                  data-testid="agent-runners__sheet-state"
                  data-state={sheetState.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={sheetState.badgeStatus}>{t(sheetState.titleKey)}</StatusBadge>
                    {sheetState.disabledReasonKey ? (
                      <span className="text-xs text-tertiary">{t(sheetState.disabledReasonKey)}</span>
                    ) : null}
                  </div>
                  {sheetState.id === 'key_issued_secret_shown_once' ? (
                    <div className="mt-2 text-sm font-medium text-primary">
                      {t('sheet_state_waiting_for_connection_title')}
                    </div>
                  ) : null}
                  <p className="mt-2 text-sm leading-6 text-secondary">{t(sheetState.descriptionKey)}</p>
                </div>

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
                  emptyLabel={t('connection_key_empty')}
                  isLoading={isLoading}
                  loadingLabel={t('connection_key_loading')}
                  sectionTitle={t('connection_key_current_title')}
                  showRevoke={canRevokeKey}
                  revokeDisabled={!sheetState.actionStates.revokeKey.enabled}
                  onRevoke={(keyId) => {
                    if (canRevokeKey) setRevokeKeyId(keyId);
                  }}
                />

                {(canTestConnection || canRunTestTask) ? (
                  <div className="rounded-lg border border-subtle bg-surface-high/20 p-4" data-testid="agent-runners__developer-checks">
                    <div className="mb-3 flex items-center gap-2 text-sm text-primary">
                      <Activity className="h-4 w-4 text-icon-default" />
                      {t('developer_checks_title')}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canTestConnection ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => testConnectionMutation.mutate()}
                          disabled={!testConnectionEnabled}
                          className="gap-2"
                        >
                          {testConnectionMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Wifi className="h-3.5 w-3.5" />
                          )}
                          {t('test_connection_action')}
                        </Button>
                      ) : null}
                      {canRunTestTask ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => testTaskMutation.mutate()}
                          disabled={!runTestTaskEnabled}
                          className="gap-2"
                        >
                          {testTaskMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          {t('run_test_task_action')}
                        </Button>
                      ) : null}
                    </div>
                    {testConnectionResult ? (
                      <div className="mt-3 text-xs text-tertiary">
                        {testConnectionResult.status === 'connected'
                          ? t('test_connection_result_connected')
                          : t('test_connection_result_disconnected')}
                      </div>
                    ) : null}
                    {testTaskResult ? (
                      <div
                        className="mt-3 space-y-2 rounded-md border border-subtle bg-surface px-3 py-3 text-xs text-tertiary"
                        data-testid="agent-runners__runner-test-task-result"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-foreground">
                          <StatusBadge status="info">{t('runner_test_badge')}</StatusBadge>
                          <span>{t('run_test_task_result_accepted')}</span>
                        </div>
                        <div>
                          {t('runner_test_source_label')}: {t('runner_test_source_value')}
                        </div>
                        <div>
                          {t('runner_test_run_reference')}: {testTaskResult.run_id}
                        </div>
                        <div>
                          {t('runner_test_task_reference')}: {testTaskResult.task_id}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                <div
                  className="rounded-lg border border-subtle bg-surface-high/25 p-4"
                  data-testid="agent-runners__sheet-state"
                  data-state={sheetState.id}
                >
                  <StatusBadge status={sheetState.badgeStatus}>{t(sheetState.titleKey)}</StatusBadge>
                  <p className="mt-2 text-sm leading-6 text-secondary">{t(sheetState.descriptionKey)}</p>
                </div>
                <div className="rounded-md border border-subtle bg-surface-high/25 px-4 py-5 text-sm text-tertiary">
                  {t('system_managed_read_only_notice')}
                </div>
              </div>
            )}
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
              {keyCreated ? commonT('done') : commonT('cancel')}
            </Button>
            {canIssueKey ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => createMutation.mutate()}
                disabled={!sheetState.actionStates.issueKey.enabled}
              >
                {t('connection_key_issue_action')}
              </Button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <KeyCreatedDialog
        open={!!keyCreated}
        onOpenChange={(open) => {
          if (open) return;
          setKeyCreated(null);
          handleOpenChange(false);
        }}
        keyValue={keyCreated?.key || null}
        keyPrefix={keyCreated?.keyPrefix}
        scope="project"
      />

      <AlertDialog open={!!revokeKeyId} onOpenChange={() => setRevokeKeyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('connection_key_revoke_confirm_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('connection_key_revoke_confirm_hint')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{commonT('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeKeyId && revokeMutation.mutate(revokeKeyId)}
              className="bg-error hover:bg-error/90"
            >
              {t('connection_key_revoke_action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
