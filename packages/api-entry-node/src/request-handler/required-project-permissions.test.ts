import { describe, expect, it } from 'vitest';
import { requiredProjectPermissions } from './required-project-permissions.js';

describe('requiredProjectPermissions', () => {
  it('requires both task-use and terminal-use permissions for creating new terminal sessions', () => {
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
    ).toEqual(['project:endpoint:use', 'project:terminal:use']);
  });

  it('treats existing terminal session management as task-use access instead of terminal-create access', () => {
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
    ).toEqual(['project:endpoint:use']);

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
    ).toEqual(['project:endpoint:use']);

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
    ).toEqual(['project:endpoint:use']);
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
        { kind: 'fileLibraryStorageCredentialExchange', workspaceId: 'ws_default', projectId: 'proj_1', libraryId: 'lib_1' },
        'POST',
      ),
    ).toEqual(['project:endpoint:use']);

    expect(
      requiredProjectPermissions(
        { kind: 'fileLibraryDesktopMountAccess', workspaceId: 'ws_default', projectId: 'proj_1', libraryId: 'lib_1' },
        'POST',
      ),
    ).toEqual(['project:endpoint:use']);
  });
});
