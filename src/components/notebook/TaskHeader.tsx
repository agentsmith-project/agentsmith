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

export interface TaskHeaderProps {
  task: Task;
  workspaceId: string;
  projectId: string;
  viewMode?: 'conversation' | 'terminal';
  agentMode?: 'external' | 'internal' | null;
  agentPresence?: 'online' | 'offline' | 'managed' | null;
  agentRunActivity?: { active: boolean; elapsedSeconds: number } | null;
  canDeleteTask?: boolean;
  deleteBlockedReason?: string | null;
  canCreateTerminalSession?: boolean;
  terminalSessionCount?: number;
  terminalHasRecovery?: boolean;
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
  viewMode = 'conversation',
  agentMode = null,
  agentPresence = null,
  agentRunActivity = null,
  canDeleteTask = true,
  deleteBlockedReason = null,
  canCreateTerminalSession = false,
  terminalSessionCount = 0,
  terminalHasRecovery = false,
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

  const agentPresenceLabel = (
    agentPresence === 'online'
      ? t('agent_presence_online')
      : agentPresence === 'managed'
        ? t('agent_presence_managed')
        : agentPresence === 'offline'
          ? t('agent_presence_offline')
          : t('agent_presence_unknown')
  );
  const agentPresenceVariant: 'default' | 'secondary' | 'destructive' | 'outline' = (
    agentPresence === 'online'
      ? 'default'
      : agentPresence === 'managed'
        ? 'secondary'
        : agentPresence === 'offline'
          ? 'destructive'
          : 'outline'
  );
  const formatElapsed = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0s';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remain = seconds % 60;
    return remain === 0 ? `${minutes}m` : `${minutes}m ${remain}s`;
  };
  const agentModeLabel = (
    agentMode === 'internal'
      ? t('agent_mode_internal')
      : agentMode === 'external'
        ? t('agent_mode_external')
        : t('agent_mode_unknown')
  );
  const workspaceFileLibraryName = task.workspace_file_library_name?.trim() || t('workspace_file_library_unknown');
  const hasTerminalTabs = terminalSessionCount > 0;
  const canSwitchToTerminalWorkspace = hasTerminalTabs;
  const terminalModeLabel = t('terminal_mode_terminal');
  const conversationModeLabel = t('terminal_mode_conversation');
  const terminalSessionSummary = terminalHasRecovery
    ? t('terminal_status_strip_recovery', { count: terminalSessionCount })
    : t('terminal_status_strip_active', { count: terminalSessionCount });
  const shouldShowOpenTerminalAction = !!onCreateTerminalSession && !hasTerminalTabs;
  const effectiveDeleteBlockedReason =
    deleteBlockedReason
    ?? (terminalSessionCount > 0 ? t('delete_blocked_terminal_sessions') : null);
  const canOpenDeleteDialog = canDeleteTask && !effectiveDeleteBlockedReason;

  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-subtle bg-surface/55 px-3.5 py-1.5"
      data-testid="notebook__task-header"
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Leave Task Button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 flex-shrink-0"
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
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground md:text-base">{task.title}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-tertiary">Agent: {task.agent_name}</span>
            <Badge variant={agentPresenceVariant} className="text-[11px]">
              {agentPresenceLabel}
            </Badge>
            <Badge variant="outline" className="text-[11px]" data-testid="notebook__task-header-agent-mode">
              {agentModeLabel}
            </Badge>
            <Badge variant="outline" className="text-[11px]" data-testid="notebook__task-header-workspace-library">
              {t('workspace_file_library_label')}: {workspaceFileLibraryName}
            </Badge>
            {agentRunActivity?.active ? (
              <Badge variant="secondary" className="text-[11px]" data-testid="notebook__task-header-agent-busy">
                {t('agent_busy', { duration: formatElapsed(agentRunActivity.elapsedSeconds) })}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        {onSetViewMode ? (
          <div className="inline-flex items-center rounded-md border border-subtle bg-surface-low/40 p-0.5">
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
              disabled={!canSwitchToTerminalWorkspace}
              data-testid="notebook__task-header-mode-terminal"
            >
              {terminalModeLabel}
            </Button>
          </div>
        ) : null}
        {hasTerminalTabs ? (
          <Badge
            variant={terminalHasRecovery ? 'destructive' : 'secondary'}
            className="text-[11px]"
            data-testid="notebook__task-header-terminal-summary"
          >
            {terminalSessionSummary}
          </Badge>
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
