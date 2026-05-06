'use client';

import { Activity, CalendarClock, ChevronRight, Clock3, FileText, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { isRunnerTestSource, RunnerTestBadge } from '../RunnerTestBadge';
import { formatTaskDateTime, formatTaskRelativeTime } from './utils';
import type { Task, TaskRunState } from '@/lib/types/task';

function getTaskRunStateLabelKey(runState: TaskRunState | undefined) {
  if (!runState || runState === 'idle') return null;
  return `run_${runState}`;
}

type TaskCardTask = Pick<
  Task,
  | 'id'
  | 'title'
  | 'source'
  | 'runner_test'
  | 'run_state'
  | 'active_run'
  | 'last_activity_at'
  | 'created_at'
  | 'attached_inputs'
> & {
  stats?: Pick<
    NonNullable<Task['stats']>,
    'user_turn_count' | 'artifact_count' | 'attached_input_count'
  >;
};

export function TaskCard(args: {
  t: (key: string, values?: Record<string, string | number>) => string;
  task: TaskCardTask;
  onClick: () => void;
}) {
  const { t, task, onClick } = args;
  const lastActivityLabel = formatTaskRelativeTime(task.last_activity_at);
  const lastActivityAbsoluteLabel = formatTaskDateTime(task.last_activity_at);
  const createdAtLabel = formatTaskDateTime(task.created_at);
  const taskCardSurfaceTestId = `agent-tasks__task-card--${task.id}`;
  const taskRunStateLabelKey = getTaskRunStateLabelKey(task.run_state);
  const isRunnerTest = isRunnerTestSource(task) || isRunnerTestSource(task.active_run);

  return (
    <div data-testid={taskCardSurfaceTestId}>
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-md border border-border bg-surface hover:bg-hover transition-colors cursor-pointer text-left"
        data-testid="agent-tasks__task-card"
        data-task-id={task.id}
      >
        <div className="px-4 py-2.5 md:px-5 md:py-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm md:text-[15px] font-semibold text-foreground truncate">{task.title}</h3>
              {taskRunStateLabelKey ? (
                <Badge variant="secondary" className="text-[11px]">
                  {t(taskRunStateLabelKey)}
                </Badge>
              ) : null}
              {isRunnerTest ? (
                <RunnerTestBadge
                  label={t('runner_test_badge')}
                  title={t('runner_test_source_value')}
                />
              ) : null}
            </div>
            <div className="text-xs text-tertiary flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" />
                {t('turns', { count: String(task.stats?.user_turn_count ?? 0) })}
              </span>
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" />
                {t('artifacts', { count: String(task.stats?.artifact_count ?? 0) })}
              </span>
              <span className="inline-flex items-center gap-1">
                <Activity className="h-3.5 w-3.5" />
                {t('inputs', { count: String(task.stats?.attached_input_count ?? task.attached_inputs.length) })}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" />
                {t('last_activity')}:{' '}
                <time
                  dateTime={task.last_activity_at}
                  title={lastActivityAbsoluteLabel}
                  data-testid="agent-tasks__task-last-activity"
                  data-visual-datetime={task.last_activity_at}
                  data-visual-datetime-policy="viewer_local"
                >
                  {lastActivityLabel}
                </time>
              </span>
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3.5 w-3.5" />
                {t('created_at')}:{' '}
                <time
                  dateTime={task.created_at}
                  title={createdAtLabel}
                  data-testid="agent-tasks__task-created-at"
                  data-visual-datetime={task.created_at}
                  data-visual-datetime-policy="viewer_local"
                >
                  {createdAtLabel}
                </time>
              </span>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-tertiary shrink-0" />
        </div>
      </button>
    </div>
  );
}
