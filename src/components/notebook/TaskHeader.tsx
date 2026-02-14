'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, ArrowLeft, Trash2, Loader2, Pencil } from 'lucide-react';
import { useDeleteTask } from '@/lib/hooks/use-task';
import type { Task, TaskStatus } from '@/lib/types/task';
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
  canDeleteTask?: boolean;
  onCreateNew?: () => void;
  onEdit?: () => void;
  onDeleted?: () => void;
  onLeave?: () => void;
}

const getStatusConfig = (t: (key: string) => string): Record<TaskStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> => ({
  active: { label: t('status.active'), variant: 'default' },
  closed: { label: t('status.closed'), variant: 'secondary' },
  archived: { label: t('status.archived'), variant: 'outline' },
});

export function TaskHeader({
  task,
  workspaceId,
  projectId,
  canDeleteTask = true,
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

  const statusConfig = getStatusConfig(t);
  const statusInfo = statusConfig[task.status];

  return (
    <div
      className="border-b border-border bg-surface px-6 py-4 flex items-center justify-between"
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
                className="h-8 w-8 flex-shrink-0"
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
          <h1 className="text-base font-semibold text-foreground truncate">{task.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-tertiary">Agent: {task.agent_name}</span>
            <Badge variant={statusInfo.variant} className="text-xs">
              {statusInfo.label}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {onEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-2" />
            {t('edit')}
          </Button>
        )}
        {canDeleteTask && (
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-error hover:text-error">
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
          <Button variant="default" size="sm" onClick={onCreateNew}>
            <Plus className="h-4 w-4 mr-2" />
            {t('new')}
          </Button>
        )}
      </div>
    </div>
  );
}
