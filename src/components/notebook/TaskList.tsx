'use client';
import * as React from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { Plus, Loader2 } from 'lucide-react';
import { useTasks } from '@/lib/hooks/use-task';
import { TaskCreateDialog } from './TaskCreateDialog';
import { EmptyState } from '@/components/ui/loading';
import { TaskCard } from '@/components/notebook/task-list/TaskCard';

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
  const t = useTranslations('notebook.task_list');
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
            {t('new_task')}
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
              title={t('empty_title')}
              description={t('empty_description')}
              action={{
                label: t('create_task'),
                onClick: () => {
                  if (!canCreateTask) return;
                  setCreateDialogOpen(true);
                },
              }}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                t={t}
                task={task}
                onClick={() => handleTaskClick(task.id)}
              />
            ))}
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
