'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, ArrowLeft, Trash2, Loader2, Pencil, TerminalSquare } from 'lucide-react';
import { useDeleteTask } from '@/lib/hooks/use-task';
import type { Task } from '@/lib/types/task';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getTerminalSessionSummaryLabel } from './terminal-session-summary';

export interface TaskHeaderProps {
  task: Task;
  workspaceId: string;
  projectId: string;
  headerAccessory?: React.ReactNode;
  viewMode?: 'conversation' | 'terminal';
  agentMode?: 'external' | 'internal' | null;
  agentPresence?: 'online' | 'offline' | 'managed' | null;
  canDeleteTask?: boolean;
  deleteBlockedReason?: string | null;
  canCreateTerminalSession?: boolean;
  terminalSessionCount?: number;
  terminalTruthState?: 'pending' | 'ready' | 'unavailable';
  terminalHasRecovery?: boolean;
  terminalRecoveryCount?: number;
  terminalDisabledReason?: string | null;
  onSetViewMode?: (mode: 'conversation' | 'terminal') => void;
  onCreateTerminalSession?: () => void;
  onCreateNew?: () => void;
  onEdit?: () => void;
  onDeleted?: () => void;
  onLeave?: () => void;
}

export function TaskHeader({
  task,
  workspaceId,
  projectId,
  headerAccessory = null,
  viewMode = 'conversation',
  agentMode = null,
  agentPresence = null,
  canDeleteTask = true,
  deleteBlockedReason = null,
  canCreateTerminalSession = false,
  terminalSessionCount = 0,
  terminalTruthState = 'ready',
  terminalHasRecovery = false,
  terminalRecoveryCount,
  terminalDisabledReason = null,
  onSetViewMode,
  onCreateTerminalSession,
  onCreateNew,
  onEdit,
  onDeleted,
  onLeave,
}: TaskHeaderProps) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const t = useTranslations('notebook.task');
  const deleteTask = useDeleteTask();
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  const handleLeave = () => {
    if (onLeave) {
      onLeave();
    } else {
      // Default behavior: navigate to notebook list
      router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook`);
    }
  };

  const handleDelete = async () => {
    if (!canDeleteTask) return;
    try {
      await deleteTask.mutateAsync({
        workspaceId,
        projectId,
        taskId: task.id,
      });
      setDeleteDialogOpen(false);
      if (onDeleted) {
        onDeleted();
      }
    } catch {
      // Error is handled by the hook
    }
  };

  const agentPresenceLabel = agentPresence === 'online'
    ? t('agent_presence_online')
    : agentPresence === 'managed'
      ? t('agent_presence_managed')
      : agentPresence === 'offline'
        ? t('agent_presence_offline')
        : null;
  const agentPresenceVariant: 'default' | 'secondary' | 'destructive' | 'outline' | null = agentPresence === 'online'
    ? 'default'
    : agentPresence === 'managed'
      ? 'secondary'
      : agentPresence === 'offline'
        ? 'destructive'
        : null;
  const agentModeLabel = agentMode === 'internal'
    ? t('agent_mode_internal')
    : agentMode === 'external'
      ? t('agent_mode_external')
      : null;
  const shouldShowAgentRecordUnavailable = agentPresenceLabel === null && agentModeLabel === null;
  const workspaceFileLibraryName = task.workspace_file_library_name?.trim() || t('workspace_file_library_unknown');
  const hasTerminalTabs = terminalSessionCount > 0;
  const terminalModeLabel = t('terminal_mode_terminal');
  const conversationModeLabel = t('terminal_mode_conversation');
  const terminalSessionSummary = getTerminalSessionSummaryLabel(t, {
    count: terminalSessionCount,
    recoveryCount: terminalRecoveryCount,
    hasRecovery: terminalHasRecovery,
  });
  const hasTerminalRecoveryAttention = terminalRecoveryCount !== undefined
    ? terminalRecoveryCount > 0
    : terminalHasRecovery;
  const shouldShowOpenTerminalAction = !!onCreateTerminalSession && !hasTerminalTabs;
  const effectiveDeleteBlockedReason =
    deleteBlockedReason
    ?? (terminalSessionCount > 0 ? t('delete_blocked_terminal_sessions') : null);
  const canOpenDeleteDialog = canDeleteTask && !effectiveDeleteBlockedReason;

  return (
    <div
      className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-subtle bg-background/95 px-4 py-3 shadow-ambient"
      data-testid="notebook__task-header"
      data-terminal-truth-state={terminalTruthState}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3" data-testid="notebook__task-header-summary">
        {/* Leave Task Button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0 rounded-lg border border-subtle bg-background/80"
                onClick={handleLeave}
                aria-label={t('leave')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('leave')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Task Info */}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-foreground md:text-base">{task.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="notebook__task-header-meta">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-subtle bg-background/80 px-2.5 py-1.5 text-[11px] text-secondary">
              <span className="font-medium text-foreground">Agent: {task.agent_name}</span>
            </div>
            {agentPresenceLabel && agentPresenceVariant ? (
              <Badge variant={agentPresenceVariant} className="text-[11px]">
                {agentPresenceLabel}
              </Badge>
            ) : null}
            {agentModeLabel ? (
              <Badge variant="outline" className="text-[11px]" data-testid="notebook__task-header-agent-mode">
                {agentModeLabel}
              </Badge>
            ) : null}
            {shouldShowAgentRecordUnavailable ? (
              <Badge
                variant="outline"
                className="border-warning/30 bg-warning/10 text-[11px] text-warning"
                data-testid="notebook__task-header-agent-record-unavailable"
              >
                {t('agent_record_unavailable')}
              </Badge>
            ) : null}
            <Badge variant="outline" className="text-[11px]" data-testid="notebook__task-header-workspace-library">
              {t('workspace_file_library_label')}: {workspaceFileLibraryName}
            </Badge>
            {onSetViewMode && hasTerminalTabs ? (
              <div className="inline-flex items-center rounded-lg border border-subtle bg-background/80 p-1">
                <Button
                  type="button"
                  variant={viewMode === 'conversation' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={() => onSetViewMode('conversation')}
                  data-testid="notebook__task-header-mode-conversation"
                >
                  {conversationModeLabel}
                </Button>
                <Button
                  type="button"
                  variant={viewMode === 'terminal' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={() => onSetViewMode('terminal')}
                  data-testid="notebook__task-header-mode-terminal"
                >
                  {terminalModeLabel}
                </Button>
              </div>
            ) : null}
            {hasTerminalTabs ? (
              <Badge
                variant={hasTerminalRecoveryAttention ? 'destructive' : 'secondary'}
                className="text-[11px]"
                data-testid="notebook__task-header-terminal-summary"
              >
                {terminalSessionSummary}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div
        className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2"
        data-testid="notebook__task-header-actions"
      >
        {headerAccessory ? (
          <div className="flex items-center" data-testid="notebook__task-header-accessory">
            {headerAccessory}
          </div>
        ) : null}
        {shouldShowOpenTerminalAction ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={onCreateTerminalSession}
            disabled={!canCreateTerminalSession}
            title={!canCreateTerminalSession ? terminalDisabledReason ?? undefined : undefined}
            data-testid="notebook__task-header-terminal-create"
          >
            <TerminalSquare className="mr-2 h-4 w-4" />
            {t('terminal_open')}
          </Button>
        ) : null}
        {onEdit && (
          <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-2" />
            {t('edit')}
          </Button>
        )}
        {canDeleteTask ? (
          canOpenDeleteDialog ? (
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs text-error hover:text-error">
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('delete')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('delete')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('delete_confirm_message')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('delete_cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      void handleDelete();
                    }}
                    disabled={deleteTask.isPending}
                    variant="destructive"
                  >
                    {deleteTask.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs text-error hover:text-error"
              disabled
              title={effectiveDeleteBlockedReason ?? undefined}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('delete')}
            </Button>
          )
        ) : null}

        {/* New Task Button */}
        {onCreateNew && (
          <Button variant="default" size="sm" className="h-8 px-2.5 text-xs" onClick={onCreateNew}>
            <Plus className="h-4 w-4 mr-2" />
            {t('new')}
          </Button>
        )}
      </div>
    </div>
  );
}
