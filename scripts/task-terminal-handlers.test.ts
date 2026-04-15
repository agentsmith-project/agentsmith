import { describe, expect, it } from 'vitest';
import { VISUAL_TEST_REFERENCE_NOW_ISO } from '../src/lib/mock-time';
import {
  createMockTaskTerminalSession,
  listMockTaskTerminalSessions,
  resetMockTaskTerminalSessions,
} from '../src/mocks/handlers/tasks';

describe('task terminal mock handlers', () => {
  it('models terminal truth as available with no live sessions by default', () => {
    resetMockTaskTerminalSessions();

    expect(listMockTaskTerminalSessions({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      taskId: 'task_001',
    })).toEqual({ total: 0, items: [] });
  });

  it('creates deterministic mock terminal sessions when a visual or mock story opens terminal work', () => {
    resetMockTaskTerminalSessions();

    const created = createMockTaskTerminalSession({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      taskId: 'task_001',
      cols: 100,
      rows: 28,
    });

    expect(created).toMatchObject({
      session_id: 'mock_terminal_001',
      status: 'active',
    });
    expect(listMockTaskTerminalSessions({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      taskId: 'task_001',
    })).toEqual({
      total: 1,
      items: [
        expect.objectContaining({
          id: 'mock_terminal_001',
          cols: 100,
          rows: 28,
          created_at: VISUAL_TEST_REFERENCE_NOW_ISO,
          last_activity_at: VISUAL_TEST_REFERENCE_NOW_ISO,
        }),
      ],
    });
  });
});
