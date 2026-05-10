import { describe, expect, it } from 'vitest';
import { requiredProjectPermissions } from './required-project-permissions.js';

describe('requiredProjectPermissions', () => {
  it('requires Agent task use for task create/run/update/archive routes without legacy agent tokens', () => {
    expect(
      requiredProjectPermissions(
        { kind: 'tasks', workspaceId: 'ws_default', projectId: 'proj_1' },
        'POST',
      ),
    ).toEqual(['project:agent_task:use']);

    expect(
      requiredProjectPermissions(
        {
          kind: 'taskMessages',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
        },
        'POST',
      ),
    ).toEqual(['project:agent_task:use']);

    expect(
      requiredProjectPermissions(
        {
          kind: 'taskRunnerBindingOptions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
        } as never,
        'GET',
      ),
    ).toEqual(['project:agent_task:use']);

    expect(
      requiredProjectPermissions(
        {
          kind: 'taskItem',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
        },
        'PATCH',
      ),
    ).toEqual(['project:agent_task:use']);
  });

  it('lets Agent task model setting GET be shaped by the handler and gates PATCH by governance update', () => {
    expect(
      requiredProjectPermissions(
        {
          kind: 'agentTaskModelSetting',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
        } as never,
        'GET',
      ),
    ).toEqual([]);

    expect(
      requiredProjectPermissions(
        {
          kind: 'agentTaskModelSetting',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
        } as never,
        'PATCH',
      ),
    ).toEqual(['project:governance:update']);
  });

  it('requires Agent task use and terminal permissions for creating new terminal sessions', () => {
    expect(
      requiredProjectPermissions(
        {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
        },
        'POST',
      ),
    ).toEqual(['project:agent_task:use', 'project:agent_task:terminal']);
  });

  it('requires Agent task use and terminal permissions for terminal routes that can issue interactive websocket tickets', () => {
    expect(
      requiredProjectPermissions(
        {
          kind: 'taskTerminalSession',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
          terminalSessionId: 'term_1',
        },
        'GET',
      ),
    ).toEqual(['project:agent_task:use', 'project:agent_task:terminal']);

    expect(
      requiredProjectPermissions(
        {
          kind: 'taskTerminalSessions',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
        },
        'GET',
      ),
    ).toEqual(['project:agent_task:use', 'project:agent_task:terminal']);
  });

  it('keeps terminal session delete behind Agent task use and terminal permissions', () => {
    expect(
      requiredProjectPermissions(
        {
          kind: 'taskTerminalSession',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
          terminalSessionId: 'term_1',
        },
        'DELETE',
      ),
    ).toEqual(['project:agent_task:use', 'project:agent_task:terminal']);
  });

  it('requires Agent Runner read/manage permissions without legacy agent tokens', () => {
    expect(
      requiredProjectPermissions(
        { kind: 'agents', workspaceId: 'ws_default', projectId: 'proj_1' },
        'GET',
      ),
    ).toEqual(['project:agent_runner:read']);

    expect(
      requiredProjectPermissions(
        { kind: 'agentDiagnostics', workspaceId: 'ws_default', projectId: 'proj_1', agentId: 'ag_1' },
        'GET',
      ),
    ).toEqual(['project:agent_runner:read']);

    expect(
      requiredProjectPermissions(
        { kind: 'agents', workspaceId: 'ws_default', projectId: 'proj_1' },
        'POST',
      ),
    ).toEqual(['project:agent_runner:manage']);

    expect(
      requiredProjectPermissions(
        { kind: 'agentConnectionInfo', workspaceId: 'ws_default', projectId: 'proj_1', agentId: 'ag_1' },
        'GET',
      ),
    ).toEqual(['project:agent_runner:manage']);

    expect(
      requiredProjectPermissions(
        { kind: 'agentKeys', workspaceId: 'ws_default', projectId: 'proj_1', agentId: 'ag_1' },
        'POST',
      ),
    ).toEqual(['project:agent_runner:manage']);

    expect(
      requiredProjectPermissions(
        { kind: 'agentTestConnection', workspaceId: 'ws_default', projectId: 'proj_1', agentId: 'ag_1' } as never,
        'POST',
      ),
    ).toEqual(['project:agent_runner:manage']);

    expect(
      requiredProjectPermissions(
        { kind: 'agentTestTaskRuns', workspaceId: 'ws_default', projectId: 'proj_1', agentId: 'ag_1' } as never,
        'POST',
      ),
    ).toEqual(['project:agent_task:use', 'project:agent_runner:manage']);
  });

  it('requires project:files:update for file-library writes and project:endpoint:use for reads', () => {
    expect(
      requiredProjectPermissions(
        { kind: 'fileLibraries', workspaceId: 'ws_default', projectId: 'proj_1' },
        'GET',
      ),
    ).toEqual(['project:endpoint:use']);

    expect(
      requiredProjectPermissions(
        { kind: 'fileLibraries', workspaceId: 'ws_default', projectId: 'proj_1' },
        'POST',
      ),
    ).toEqual(['project:files:update']);

    expect(
      requiredProjectPermissions(
        { kind: 'fileLibraryUpload', workspaceId: 'ws_default', projectId: 'proj_1', libraryId: 'lib_1' },
        'POST',
      ),
    ).toEqual(['project:files:update']);

    expect(
      requiredProjectPermissions(
        { kind: 'fileLibraryDownload', workspaceId: 'ws_default', projectId: 'proj_1', libraryId: 'lib_1' },
        'GET',
      ),
    ).toEqual(['project:endpoint:use']);

    expect(
      requiredProjectPermissions(
        { kind: 'fileLibrarySavePoints', workspaceId: 'ws_default', projectId: 'proj_1', libraryId: 'lib_1' } as never,
        'GET',
      ),
    ).toEqual(['project:endpoint:use']);

    expect(
      requiredProjectPermissions(
        { kind: 'fileLibraryRestoreRun', workspaceId: 'ws_default', projectId: 'proj_1', libraryId: 'lib_1' } as never,
        'POST',
      ),
    ).toEqual(['project:files:update']);

    expect(
      requiredProjectPermissions(
        { kind: 'taskFileTemplates', workspaceId: 'ws_default', projectId: 'proj_1' } as never,
        'GET',
      ),
    ).toEqual([]);

    expect(
      requiredProjectPermissions(
        { kind: 'taskFileTemplatePublish', workspaceId: 'ws_default', projectId: 'proj_1', taskFileTemplateId: 'tftpl_1' } as never,
        'POST',
      ),
    ).toEqual(['project:files:update']);
  });

  it('gates file-library operation projections by project audit read', () => {
    expect(
      requiredProjectPermissions(
        {
          kind: 'fileLibraryOperation',
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          operationId: 'op_repo_create',
        } as never,
        'GET',
      ),
    ).toEqual(['project:audit:read']);
  });
});
