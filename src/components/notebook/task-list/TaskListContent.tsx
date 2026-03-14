'use client';

import { Loader2 } from 'lucide-react';

import { EmptyState } from '@/components/ui/loading';
import type { Task } from '@/lib/types/task';

import { TaskCard } from './TaskCard';

interface TaskListContentProps {
  canCreateTask: boolean;
  isLoading: boolean;
  t: (key: string) => string;
  tasks: Task[];
  onCreate: () => void;
  onTaskClick: (taskId: string) => void;
}

export function TaskListContent({
  canCreateTask,
  isLoading,
  t,
  tasks,
  onCreate,
  onTaskClick,
}: TaskListContentProps) {
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-3 md:px-5 md:pb-4">
      {isLoading ? (
        <div className="flex h-full items-center justify-center rounded-[22px] border border-subtle bg-surface/95 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
          <Loader2 className="h-6 w-6 animate-spin text-tertiary" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex h-full items-center justify-center rounded-[22px] border border-subtle bg-surface/95 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
          <EmptyState
            title={t('empty_title')}
            description={t('empty_description')}
            action={{
              label: t('create_task'),
              onClick: () => {
                if (!canCreateTask) return;
                onCreate();
              },
            }}
          />
        </div>
      ) : (
        <div className="rounded-[22px] border border-subtle bg-surface/95 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.16)]">
          <div className="space-y-1.5">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              t={t}
              task={task}
              onClick={() => onTaskClick(task.id)}
            />
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
