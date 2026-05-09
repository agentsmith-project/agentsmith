import { homedir } from 'node:os';
import { isAbsolute, join, normalize, relative } from 'node:path';

import {
  buildTaskHomePaths,
  resolveTaskHomeSegment,
  type TaskHomePaths,
} from './task-models.js';

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
  developerWorkspaceRoot?: string;
};

export class TaskRuntimePathResolutionError extends Error {
  readonly code = 'runtime_path_unavailable';
  readonly reason: string;
  readonly metadata: Record<string, unknown>;

  constructor(reason: string, metadata: Record<string, unknown> = {}) {
    super('runtime_path_unavailable');
    this.name = 'TaskRuntimePathResolutionError';
    this.reason = reason;
    this.metadata = metadata;
  }
}

const TASK_HOME_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEVELOPER_WORKSPACE_ROOT_ENV = 'MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT';

function fail(reason: string, metadata: Record<string, unknown> = {}): never {
  throw new TaskRuntimePathResolutionError(reason, metadata);
}

function hasPathTraversalSegment(value: string): boolean {
  return value.split(/[\\/]+/).some((part) => part === '..');
}

function trimTrailingSeparators(value: string): string {
  if (value === '/') return value;
  return value.replace(/\/+$/, '');
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

function normalizeAbsoluteRootPath(rawRoot: string, source: string): string {
  const root = rawRoot.trim();
  if (!root || root.includes('\0')) {
    fail(`${source}_invalid`, { source });
  }
  if (!isAbsolute(root)) {
    fail(`${source}_must_be_absolute`, { source, path: root });
  }
  if (hasPathTraversalSegment(root)) {
    fail(`${source}_must_not_contain_traversal`, { source, path: root });
  }
  const normalized = trimTrailingSeparators(normalize(root));
  if (!normalized || normalized === '/' || !isAbsolute(normalized)) {
    fail(`${source}_invalid`, { source, path: root });
  }
  return normalized;
}

function resolveDeveloperWorkspaceRoot(env: RuntimePathEnv): string {
  const configuredRoot = env[DEVELOPER_WORKSPACE_ROOT_ENV]?.trim();
  if (configuredRoot) {
    return normalizeAbsoluteRootPath(configuredRoot, 'developer_workspace_root');
  }
  const home = env.HOME?.trim() || homedir();
  const normalizedHome = normalizeAbsoluteRootPath(home, 'home');
  return join(normalizedHome, 'ags-workspace');
}

function assertChildPath(root: string, childPath: string, reason: string): void {
  const childRelativePath = relative(root, childPath);
  if (!childRelativePath || childRelativePath.startsWith('..') || isAbsolute(childRelativePath)) {
    fail(reason, { root, path: childPath });
  }
}

function resolveDeveloperTaskHomePaths(input: {
  taskHomeSegment: string;
  env: RuntimePathEnv;
}): ResolvedTaskRuntimeHomePaths {
  const developerWorkspaceRoot = resolveDeveloperWorkspaceRoot(input.env);
  const taskHomePath = normalize(join(developerWorkspaceRoot, input.taskHomeSegment));
  assertChildPath(developerWorkspaceRoot, taskHomePath, 'task_home_path_outside_developer_workspace_root');
  const workspacePath = join(taskHomePath, 'workspace');
  const artifactsPath = join(workspacePath, '.artifacts');
  return {
    runtimeProfile: 'developer',
    taskHomeSegment: input.taskHomeSegment,
    developerWorkspaceRoot,
    taskHomePath,
    workspacePath,
    artifactsPath,
    subPath: `agent-tasks/${input.taskHomeSegment}`,
  };
}

export function resolveTaskRuntimeHomePaths(input: {
  runtimeProfile: TaskRuntimeProfile;
  taskHomeSegment: string;
  env?: RuntimePathEnv;
}): ResolvedTaskRuntimeHomePaths {
  const taskHomeSegment = validateTaskHomeSegment(input.taskHomeSegment);
  if (input.runtimeProfile === 'managed') {
    return {
      runtimeProfile: 'managed',
      taskHomeSegment,
      ...buildTaskHomePaths(taskHomeSegment),
    };
  }
  return resolveDeveloperTaskHomePaths({
    taskHomeSegment,
    env: input.env ?? process.env,
  });
}

export function resolveTaskRuntimeHomePathsForRunner(input: {
  task: TaskRuntimePathTaskInput;
  runnerProvider?: string | null;
  env?: RuntimePathEnv;
}): ResolvedTaskRuntimeHomePaths {
  return resolveTaskRuntimeHomePaths({
    runtimeProfile: input.runnerProvider === 'developer' ? 'developer' : 'managed',
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
      && (error as Error & { code?: unknown }).code === 'runtime_path_unavailable'
    );
}
