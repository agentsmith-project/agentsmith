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
  agentMode?: 'external' | 'internal' | null;
  agentPresence?: 'online' | 'offline' | 'managed' | null;
  agentRunActivity?: { active: boolean; elapsedSeconds: number } | null;
  canDeleteTask?: boolean;
  canOpenTerminal?: boolean;
  hasTerminalSession?: boolean;
  terminalOpen?: boolean;
  terminalStatus?: 'idle' | 'preparing' | 'connecting' | 'active' | 'closed' | 'failed';
  terminalDisabledReason?: string | null;
  onCloseTerminalSession?: () => void;
  onCreateNew?: () => void;
  onEdit?: () => void;
  onDeleted?: () => void;
  onLeave?: () => void;
  onToggleTerminal?: () => void;
}

export function TaskHeader({
  task,
  workspaceId,
  projectId,
  agentMode = null,
  agentPresence = null,
  agentRunActivity = null,
  canDeleteTask = true,
  canOpenTerminal = false,
  hasTerminalSession = false,
  terminalOpen = false,
  terminalStatus = 'idle',
  terminalDisabledReason = null,
  onCloseTerminalSession,
  onCreateNew,
  onEdit,
  onDeleted,
  onLeave,
  onToggleTerminal,
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
  const canToggleTerminal = hasTerminalSession || canOpenTerminal;
  const terminalToggleLabel = hasTerminalSession
    ? terminalOpen
      ? t('terminal_hide')
      : terminalStatus === 'failed'
        ? t('terminal_recovery_show')
        : t('terminal_show')
    : t('terminal_open');
  const shouldShowTerminalStatus = hasTerminalSession && !terminalOpen;
  const terminalStatusLabel = terminalStatus === 'failed'
    ? t('terminal_session_attention_badge')
    : t('terminal_session_active_badge');
  const terminalStatusVariant: 'secondary' | 'destructive' = terminalStatus === 'failed' ? 'destructive' : 'secondary';

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
        {shouldShowTerminalStatus ? (
          <Badge
            variant={terminalStatusVariant}
            className="text-[11px]"
            data-testid="notebook__task-header-terminal-status"
          >
            {terminalStatusLabel}
          </Badge>
        ) : null}
        {onEdit && (
          <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-2" />
            {t('edit')}
          </Button>
        )}
        {onToggleTerminal ? (
          <Button
            variant={terminalOpen ? 'default' : 'outline'}
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={onToggleTerminal}
            disabled={!canToggleTerminal}
            title={!canToggleTerminal ? terminalDisabledReason ?? undefined : undefined}
            data-testid="notebook__task-header-terminal"
          >
            <TerminalSquare className="mr-2 h-4 w-4" />
            {terminalToggleLabel}
          </Button>
        ) : null}
        {hasTerminalSession && onCloseTerminalSession ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={onCloseTerminalSession}
            data-testid="notebook__task-header-terminal-close"
          >
            <TerminalSquare className="mr-2 h-4 w-4" />
            {t('terminal_close')}
          </Button>
        ) : null}
        {canDeleteTask && (
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
        )}

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
