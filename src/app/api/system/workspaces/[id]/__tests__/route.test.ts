import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspacePayload } from '../../__tests__/helpers';

const sessionModule = vi.hoisted(() => ({
  isSystemAdminAuthenticated: vi.fn(),
}));

const registryModule = vi.hoisted(() => ({
  updateSystemWorkspace: vi.fn(),
  deleteSystemWorkspace: vi.fn(),
  publishSystemWorkspace: vi.fn(),
  disableSystemWorkspace: vi.fn(),
}));

vi.mock('@/lib/system-admin/session', () => sessionModule);
vi.mock('@/lib/system-admin/workspace-registry', () => registryModule);

import { DELETE, PATCH } from '../route';
import { POST as PUBLISH } from '../publish/route';
import { POST as DISABLE } from '../disable/route';

describe('/api/system/workspaces/[id]', () => {
  beforeEach(() => {
    sessionModule.isSystemAdminAuthenticated.mockReset();
    registryModule.updateSystemWorkspace.mockReset();
    registryModule.deleteSystemWorkspace.mockReset();
    registryModule.publishSystemWorkspace.mockReset();
    registryModule.disableSystemWorkspace.mockReset();
  });

  it('returns 401 when system admin session is missing', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(false);

    const response = await PATCH(
      new Request('http://localhost/api/system/workspaces/ws_alpha', { method: 'PATCH' }),
      { params: Promise.resolve({ id: 'ws_alpha' }) },
    );

    expect(response.status).toBe(401);
  });

  it('updates workspace config for authenticated system admin', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);
    registryModule.updateSystemWorkspace.mockResolvedValue({ id: 'ws_alpha' });

    const response = await PATCH(
      new Request('http://localhost/api/system/workspaces/ws_alpha', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createWorkspacePayload({ workspace_admin: 'ops-admin@example.com' })),
      }),
      { params: Promise.resolve({ id: 'ws_alpha' }) },
    );

    expect(response.status).toBe(200);
    expect(registryModule.updateSystemWorkspace).toHaveBeenCalledWith(
      'ws_alpha',
      expect.objectContaining({
        workspace_admin: 'ops-admin@example.com',
        project_creators: ['creator@example.com'],
      }),
    );
  });

  it('deletes workspace config for authenticated system admin', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);
    registryModule.deleteSystemWorkspace.mockResolvedValue(undefined);

    const response = await DELETE(
      new Request('http://localhost/api/system/workspaces/ws_alpha', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'ws_alpha' }) },
    );

    expect(response.status).toBe(200);
    expect(registryModule.deleteSystemWorkspace).toHaveBeenCalledWith('ws_alpha');
  });

  it('publishes workspace config for authenticated system admin', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);
    registryModule.publishSystemWorkspace.mockResolvedValue({ id: 'ws_alpha', provisioning_status: 'ready' });

    const response = await PUBLISH(
      new Request('http://localhost/api/system/workspaces/ws_alpha/publish', { method: 'POST' }),
      { params: Promise.resolve({ id: 'ws_alpha' }) },
    );

    expect(response.status).toBe(200);
    expect(registryModule.publishSystemWorkspace).toHaveBeenCalledWith('ws_alpha');
  });

  it('disables workspace config for authenticated system admin', async () => {
    sessionModule.isSystemAdminAuthenticated.mockResolvedValue(true);
    registryModule.disableSystemWorkspace.mockResolvedValue({ id: 'ws_alpha', provisioning_status: 'disabled' });

    const response = await DISABLE(
      new Request('http://localhost/api/system/workspaces/ws_alpha/disable', { method: 'POST' }),
      { params: Promise.resolve({ id: 'ws_alpha' }) },
    );

    expect(response.status).toBe(200);
    expect(registryModule.disableSystemWorkspace).toHaveBeenCalledWith('ws_alpha');
  });
});
