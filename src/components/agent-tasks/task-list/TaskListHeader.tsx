'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TaskListHeaderProps {
  canCreateTask: boolean;
  t: (key: string) => string;
  onCreate: () => void;
}

export function TaskListHeader({
  canCreateTask,
  t,
  onCreate,
}: TaskListHeaderProps) {
  return (
    <div className="px-4 pt-2 md:px-5">
      <div
        data-testid="agent-tasks__task-list-header"
        className="flex items-center justify-between gap-3 border-b border-subtle/60 pb-2.5"
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('title')}</div>
        <Button
          variant="primary"
          size="sm"
          className="shrink-0 font-semibold"
          onClick={onCreate}
          disabled={!canCreateTask}
          data-testid="agent-tasks__create-task-btn"
          data-visual-primary-action="true"
          data-visual-viewport-required="true"
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('new_task')}
        </Button>
      </div>
    </div>
  );
}
