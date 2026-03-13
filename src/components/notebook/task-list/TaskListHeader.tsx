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
    <div className="px-4 pb-2 pt-3 md:px-5">
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
  );
}
