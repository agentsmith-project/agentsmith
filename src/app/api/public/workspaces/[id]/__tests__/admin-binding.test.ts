import { beforeEach, describe, expect, it, vi } from 'vitest';

const registryModule = vi.hoisted(() => ({
  bindPendingWorkspaceAdminByEmail: vi.fn(),
  getPublicSystemWorkspace: vi.fn(),
}));

vi.mock('@/lib/system-admin/workspace-registry', () => registryModule);

import { POST } from '../admin-binding/route';

describe('/api/public/workspaces/[id]/admin-binding', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    registryModule.bindPendingWorkspaceAdminByEmail.mockReset();
    registryModule.getPublicSystemWorkspace.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('binds a pending admin when userinfo matches a real user', async () => {
    registryModule.getPublicSystemWorkspace.mockResolvedValue({
      id: 'ws_alpha',
      name: 'Alpha Workspace',
      login_idp: {
        kind: 'keycloak',
        url: 'https://login.example.com',
        realm: 'alpha',
        client_id: 'alpha-client',
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        sub: 'user_123',
        email: 'owner@example.com',
        name: 'Owner User',
      }),
    });

    const response = await POST(new Request('http://localhost/api/public/workspaces/ws_alpha/admin-binding', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
    }), {
      params: Promise.resolve({ id: 'ws_alpha' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(registryModule.bindPendingWorkspaceAdminByEmail).toHaveBeenCalledWith({
      workspaceId: 'ws_alpha',
      user: {
        user_id: 'user_123',
        email: 'owner@example.com',
        name: 'Owner User',
      },
    });
  });

  it('returns 202 when userinfo cannot be resolved', async () => {
    registryModule.getPublicSystemWorkspace.mockResolvedValue({
      id: 'ws_alpha',
      name: 'Alpha Workspace',
      login_idp: {
        kind: 'keycloak',
        url: 'https://login.example.com',
        realm: 'alpha',
        client_id: 'alpha-client',
      },
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
    });

    const response = await POST(new Request('http://localhost/api/public/workspaces/ws_alpha/admin-binding', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
    }), {
      params: Promise.resolve({ id: 'ws_alpha' }),
    });

    expect(response.status).toBe(202);
    expect(registryModule.bindPendingWorkspaceAdminByEmail).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization is missing', async () => {
    registryModule.getPublicSystemWorkspace.mockResolvedValue({
      id: 'ws_alpha',
      name: 'Alpha Workspace',
      login_idp: {
        kind: 'keycloak',
        url: 'https://login.example.com',
        realm: 'alpha',
        client_id: 'alpha-client',
      },
    });

    const response = await POST(new Request('http://localhost/api/public/workspaces/ws_alpha/admin-binding', {
      method: 'POST',
    }), {
      params: Promise.resolve({ id: 'ws_alpha' }),
    });

    expect(response.status).toBe(401);
    expect(registryModule.bindPendingWorkspaceAdminByEmail).not.toHaveBeenCalled();
  });
});
