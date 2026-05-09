import { describe, expect, it } from 'vitest';

import {
  resolveTaskRuntimeHomePaths,
} from './task-runtime-paths.js';

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
      subPath: 'agent-tasks/task_managed',
    });
  });

  it('resolves developer task HOME paths under the configured absolute root', () => {
    expect(resolveTaskRuntimeHomePaths({
      runtimeProfile: 'developer',
      taskHomeSegment: 'task_developer',
      env: {
        HOME: '/home/developer',
        MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT: '/tmp/agentsmith-dev-workspaces',
      },
    })).toEqual({
      runtimeProfile: 'developer',
      taskHomeSegment: 'task_developer',
      developerWorkspaceRoot: '/tmp/agentsmith-dev-workspaces',
      taskHomePath: '/tmp/agentsmith-dev-workspaces/task_developer',
      workspacePath: '/tmp/agentsmith-dev-workspaces/task_developer/workspace',
      artifactsPath: '/tmp/agentsmith-dev-workspaces/task_developer/workspace/.artifacts',
      subPath: 'agent-tasks/task_developer',
    });
  });

  it('defaults developer workspace root to HOME/ags-workspace', () => {
    expect(resolveTaskRuntimeHomePaths({
      runtimeProfile: 'developer',
      taskHomeSegment: 'task_default_root',
      env: {
        HOME: '/home/developer',
      },
    })).toMatchObject({
      developerWorkspaceRoot: '/home/developer/ags-workspace',
      taskHomePath: '/home/developer/ags-workspace/task_default_root',
      workspacePath: '/home/developer/ags-workspace/task_default_root/workspace',
      artifactsPath: '/home/developer/ags-workspace/task_default_root/workspace/.artifacts',
    });
  });

  it('fails typed when developer workspace root is relative', () => {
    expect(() => resolveTaskRuntimeHomePaths({
      runtimeProfile: 'developer',
      taskHomeSegment: 'task_relative_root',
      env: {
        HOME: '/home/developer',
        MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT: 'relative-root',
      },
    })).toThrowError('runtime_path_unavailable');
  });

  it('fails typed when developer workspace root contains traversal', () => {
    expect(() => resolveTaskRuntimeHomePaths({
      runtimeProfile: 'developer',
      taskHomeSegment: 'task_traversal_root',
      env: {
        HOME: '/home/developer',
        MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT: '/tmp/../agentsmith-dev-workspaces',
      },
    })).toThrowError('runtime_path_unavailable');
  });

  it('fails typed when task home segment contains traversal', () => {
    expect(() => resolveTaskRuntimeHomePaths({
      runtimeProfile: 'developer',
      taskHomeSegment: '../task_escape',
      env: {
        HOME: '/home/developer',
      },
    })).toThrowError('runtime_path_unavailable');
  });
});
