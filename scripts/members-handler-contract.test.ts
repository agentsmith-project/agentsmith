import { describe, expect, it } from 'vitest';
import { memberHandlers } from '../src/mocks/handlers/members';
import { workspaceFixtures } from '../src/mocks/fixtures/workspaces';

describe('members handler contract', () => {
  it('keeps invite truth wired to the static workspace fixture layer', () => {
    const inviteHandler = memberHandlers.find((handler) => handler.info?.path === '/api/v1/join/invites/:token');
    const inviteCreateHandler = memberHandlers.find((handler) => handler.info?.path === '/api/v1/workspaces/:ws/projects/:prj/invites');

    expect(inviteCreateHandler).toBeTruthy();
    expect(inviteHandler).toBeTruthy();
    expect(workspaceFixtures.find((item) => item.id === 'ws_test')?.name).toBe('Test Workspace');
  });
});
