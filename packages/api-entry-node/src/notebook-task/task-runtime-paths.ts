import { normalize } from 'node:path';

import {
  buildTaskHomePaths,
  resolveTaskHomeSegment,
  type TaskHomePaths,
} from './task-models.js';
import {
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
} from '../developer-runner-workspace-blocker.js';

export type TaskRuntimeProfile = 'managed' | 'developer';

type RuntimePathEnv = Record<string, string | undefined>;

type TaskRuntimePathTaskInput = {
  id: string;
  workspace_id: string;
  project_id: string;
  task_home_segment?: string;
};

export type ResolvedTaskRuntimeHomePaths = TaskHomePaths & {
  runtimeProfile: TaskRuntimeProfile;
  taskHomeSegment: string;
};

type TaskRuntimePathResolutionCode =
  | 'runtime_path_unavailable'
  | typeof DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE;

export class TaskRuntimePathResolutionError extends Error {
  readonly code: TaskRuntimePathResolutionCode;
  readonly reason: string;
  readonly metadata: Record<string, unknown>;

  constructor(
    reason: string,
    metadata: Record<string, unknown> = {},
    options: {
      code?: TaskRuntimePathResolutionCode;
      message?: string;
    } = {},
  ) {
    super(options.message ?? 'runtime_path_unavailable');
    this.name = 'TaskRuntimePathResolutionError';
    this.code = options.code ?? 'runtime_path_unavailable';
    this.reason = reason;
    this.metadata = metadata;
  }
}

const TASK_HOME_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function fail(reason: string, metadata: Record<string, unknown> = {}): never {
  throw new TaskRuntimePathResolutionError(reason, metadata);
}

function failDeveloperTaskHomeBindingUnavailable(): never {
  throw new TaskRuntimePathResolutionError(
    DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
    {},
    {
      code: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
      message: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
    },
  );
}

function hasPathTraversalSegment(value: string): boolean {
  return value.split(/[\\/]+/).some((part) => part === '..');
}

function validateTaskHomeSegment(rawSegment: string): string {
  const segment = rawSegment.trim();
  if (
    !TASK_HOME_SEGMENT_PATTERN.test(segment)
    || segment === '.'
    || segment === '..'
    || hasPathTraversalSegment(segment)
    || normalize(segment) !== segment
  ) {
    fail('invalid_task_home_segment', { task_home_segment: rawSegment });
  }
  return segment;
}

export function resolveTaskRuntimeHomePaths(input: {
  runtimeProfile: TaskRuntimeProfile;
  taskHomeSegment: string;
  env?: RuntimePathEnv;
}): ResolvedTaskRuntimeHomePaths {
  if (input.runtimeProfile === 'developer') {
    failDeveloperTaskHomeBindingUnavailable();
  }
  const taskHomeSegment = validateTaskHomeSegment(input.taskHomeSegment);
  return {
    runtimeProfile: 'managed',
    taskHomeSegment,
    ...buildTaskHomePaths(taskHomeSegment),
  };
}

export function resolveTaskRuntimeHomePathsForRunner(input: {
  task: TaskRuntimePathTaskInput;
  runnerProvider?: string | null;
  env?: RuntimePathEnv;
}): ResolvedTaskRuntimeHomePaths {
  if (input.runnerProvider === 'developer') {
    failDeveloperTaskHomeBindingUnavailable();
  }
  return resolveTaskRuntimeHomePaths({
    runtimeProfile: 'managed',
    taskHomeSegment: resolveTaskHomeSegment(input.task),
    env: input.env,
  });
}

export function isTaskRuntimePathResolutionError(
  error: unknown,
): error is TaskRuntimePathResolutionError {
  return error instanceof TaskRuntimePathResolutionError
    || (
      error instanceof Error
      && (
        (error as Error & { code?: unknown }).code === 'runtime_path_unavailable'
        || (error as Error & { code?: unknown }).code
          === DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE
      )
    );
}
