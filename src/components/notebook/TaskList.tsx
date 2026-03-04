'use client';
import * as React from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { Plus, Loader2, ChevronRight, Clock3, Bot } from 'lucide-react';
import { useTasks } from '@/lib/hooks/use-task';
import { TaskCreateDialog } from './TaskCreateDialog';
import { EmptyState } from '@/components/ui/loading';

export interface TaskListProps {
  workspaceId: string;
  projectId: string;
  canCreateTask: boolean;
}

export function TaskList({
  workspaceId,
  projectId,
  canCreateTask,
}: TaskListProps) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en-US';
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const { data: tasksData, isLoading } = useTasks(workspaceId, projectId, {
    sort_by: 'last_activity_at',
    sort_order: 'desc',
  });

  const tasks = tasksData?.items || [];

  const handleCreateSuccess = (taskId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook/tasks/${taskId}`);
  };

  const handleTaskClick = (taskId: string) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/notebook/tasks/${taskId}`);
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="h-full flex flex-col bg-background" data-testid="notebook__task-list">
      <div className="px-4 pb-2 pt-3 md:px-5">
        <PageToolbar className="justify-end">
          <Button
            onClick={() => setCreateDialogOpen(true)}
            disabled={!canCreateTask}
            data-testid="notebook__create-task-btn"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </PageToolbar>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-3 md:px-5 md:pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-tertiary" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              title="No tasks yet"
              description="Create your first task to start working with an agent"
              action={{
                label: 'Create Task',
                onClick: () => {
                  if (!canCreateTask) return;
                  setCreateDialogOpen(true);
                },
              }}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            {tasks.map((task) => {
              return (
                <div
                  key={task.id}
                  onClick={() => handleTaskClick(task.id)}
                  className="rounded-md border border-border bg-surface hover:bg-hover transition-colors cursor-pointer"
                  data-testid="notebook__task-card"
                  data-task-id={task.id}
                >
                  <div className="px-4 py-2.5 md:px-5 md:py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-sm md:text-[15px] font-semibold text-foreground truncate">{task.title}</h3>
                      </div>
                      <div className="text-xs text-tertiary flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1">
                          <Bot className="h-3.5 w-3.5" />
                          {task.agent_name}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {formatTime(task.last_activity_at)}
                        </span>
                        <span>{task.attached_inputs.length} file(s)</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-tertiary shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <TaskCreateDialog
        open={canCreateTask && createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        projectId={projectId}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
