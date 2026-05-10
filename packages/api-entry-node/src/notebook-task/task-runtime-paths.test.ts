import { describe, expect, it } from 'vitest';

import {
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
} from '../developer-runner-workspace-blocker.js';
import {
  isTaskRuntimePathResolutionError,
  resolveTaskRuntimeHomePaths,
  resolveTaskRuntimeHomePathsForRunner,
} from './task-runtime-paths.js';

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected_action_to_throw');
}

function expectDeveloperTaskHomeBindingUnavailable(error: unknown): void {
  expect(isTaskRuntimePathResolutionError(error)).toBe(true);
  expect(error).toMatchObject({
    code: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
    message: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
    reason: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
  });
  expect(JSON.stringify({
    error,
    message: error instanceof Error ? error.message : undefined,
  })).not.toMatch(
    /\/tmp|ags-workspace|developer_workspace_root|developerWorkspaceRoot|task_home_path|workspace_path|artifacts_path/i,
  );
}

describe('task runtime path resolver', () => {
  it('keeps managed task HOME paths canonical under /home', () => {
    expect(resolveTaskRuntimeHomePaths({
      runtimeProfile: 'managed',
      taskHomeSegment: 'task_managed',
      env: {
        HOME: '/home/developer',
        MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT: '/tmp/should-not-apply',
      },
    })).toEqual({
      runtimeProfile: 'managed',
      taskHomeSegment: 'task_managed',
      taskHomePath: '/home/task_managed',
      workspacePath: '/home/task_managed/workspace',
      artifactsPath: '/home/task_managed/workspace/.artifacts',
      libraryRootPath: '.',
    });
  });

  it('blocks developer profile before resolving a configured local workspace root', () => {
    const error = captureError(() => resolveTaskRuntimeHomePaths({
      runtimeProfile: 'developer',
      taskHomeSegment: 'task_developer',
      env: {
        HOME: '/home/developer',
        MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT: '/tmp/../agentsmith-dev-workspaces',
      },
    }));

    expectDeveloperTaskHomeBindingUnavailable(error);
  });

  it('blocks developer profile before defaulting to HOME/ags-workspace', () => {
    const error = captureError(() => resolveTaskRuntimeHomePaths({
      runtimeProfile: 'developer',
      taskHomeSegment: 'task_default_root',
      env: {
        HOME: '/home/developer',
      },
    }));

    expectDeveloperTaskHomeBindingUnavailable(error);
  });

  it('blocks developer profile before validating a local root', () => {
    const error = captureError(() => resolveTaskRuntimeHomePaths({
      runtimeProfile: 'developer',
      taskHomeSegment: 'task_relative_root',
      env: {
        HOME: '/home/developer',
        MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT: 'relative-root',
      },
    }));

    expectDeveloperTaskHomeBindingUnavailable(error);
  });

  it('blocks developer runner before deriving task HOME paths from runner state', () => {
    const error = captureError(() => resolveTaskRuntimeHomePathsForRunner({
      runnerProvider: 'developer',
      task: {
        id: 'task_for_runner',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        task_home_segment: '../task_escape',
      },
      env: {
        HOME: '/home/developer',
        MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT: '/tmp/agentsmith-dev-workspaces',
      },
    }));

    expectDeveloperTaskHomeBindingUnavailable(error);
  });

  it('fails typed when managed task home segment contains traversal', () => {
    expect(() => resolveTaskRuntimeHomePaths({
      runtimeProfile: 'managed',
      taskHomeSegment: '../task_escape',
      env: {
        HOME: '/home/developer',
      },
    })).toThrowError('runtime_path_unavailable');
  });

  it('keeps developer local env from affecting managed validation', () => {
    expect(() => resolveTaskRuntimeHomePaths({
      runtimeProfile: 'managed',
      taskHomeSegment: 'task_traversal_root',
      env: {
        HOME: '/home/developer',
        MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT: '/tmp/../agentsmith-dev-workspaces',
      },
    })).not.toThrow();
  });

  it('keeps managed runner resolution canonical under /home', () => {
    expect(resolveTaskRuntimeHomePathsForRunner({
      runnerProvider: 'managed',
      task: {
        id: 'task_managed_runner',
        workspace_id: 'ws_default',
        project_id: 'proj_1',
      },
      env: {
        HOME: '/home/developer',
        MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT: '/tmp/should-not-apply',
      },
    })).toMatchObject({
      runtimeProfile: 'managed',
      taskHomeSegment: 'task_managed_runner',
      taskHomePath: '/home/task_managed_runner',
      workspacePath: '/home/task_managed_runner/workspace',
      artifactsPath: '/home/task_managed_runner/workspace/.artifacts',
      libraryRootPath: '.',
    });
  });

  it('still rejects invalid managed task HOME segments through segment validation only', () => {
    expect(() => resolveTaskRuntimeHomePaths({
      runtimeProfile: 'managed',
      taskHomeSegment: 'task_traversal_root/child',
      env: {
        HOME: '/home/developer',
      },
    })).toThrowError('runtime_path_unavailable');
  });

  it('does not synthesize developer paths for traversal-like developer input', () => {
    const error = captureError(() => resolveTaskRuntimeHomePaths({
      runtimeProfile: 'developer',
      taskHomeSegment: 'task_traversal_root',
      env: {
        HOME: '/home/developer',
        MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT: '/tmp/../agentsmith-dev-workspaces',
      },
    }));

    expectDeveloperTaskHomeBindingUnavailable(error);
  });
});
