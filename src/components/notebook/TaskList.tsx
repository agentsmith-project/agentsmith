'use client';
import * as React from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTasks } from '@/lib/hooks/use-task';
import { TaskCreateDialog } from './TaskCreateDialog';
import { TaskListContent } from '@/components/notebook/task-list/TaskListContent';
import { TaskListHeader } from '@/components/notebook/task-list/TaskListHeader';
import { buildTaskPath } from '@/components/notebook/task-list/navigation';

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
    router.push(buildTaskPath(locale, workspaceId, projectId, taskId));
  };

  const handleTaskClick = (taskId: string) => {
    router.push(buildTaskPath(locale, workspaceId, projectId, taskId));
  };

  return (
    <div className="h-full flex flex-col bg-background" data-testid="notebook__task-list">
      <TaskListHeader
        canCreateTask={canCreateTask}
        t={t}
        onCreate={() => setCreateDialogOpen(true)}
      />

      <TaskListContent
        canCreateTask={canCreateTask}
        isLoading={isLoading}
        t={t}
        tasks={tasks}
        onCreate={() => setCreateDialogOpen(true)}
        onTaskClick={handleTaskClick}
      />

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
