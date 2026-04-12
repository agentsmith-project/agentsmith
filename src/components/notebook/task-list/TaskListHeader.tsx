'use client';

import { Plus } from 'lucide-react';

import { PageToolbar } from '@/components/layout/PageToolbar';
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
    <div className="px-4 pb-3 pt-3 md:px-5">
      <div className="rounded-md border border-subtle bg-surface/95 p-4 shadow-card">
        <div className="mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{t('title')}</div>
          <div className="mt-1 text-sm text-secondary">{t('description')}</div>
        </div>
        <PageToolbar className="justify-end">
        <Button
          onClick={onCreate}
          disabled={!canCreateTask}
          data-testid="notebook__create-task-btn"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('new_task')}
        </Button>
        </PageToolbar>
      </div>
    </div>
  );
}
