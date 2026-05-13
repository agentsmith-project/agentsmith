import { beforeEach, describe, expect, it, vi } from 'vitest';

const registryModule = vi.hoisted(() => ({
  getPublicSystemWorkspace: vi.fn(),
}));

vi.mock('@/lib/system-admin/workspace-registry', () => registryModule);

import { GET } from '../route';

describe('/api/public/workspaces/[id]', () => {
  beforeEach(() => {
    registryModule.getPublicSystemWorkspace.mockReset();
  });

  it('returns configured workspace login settings', async () => {
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

    const response = await GET(new Request('http://localhost/api/public/workspaces/ws_alpha'), {
      params: Promise.resolve({ id: 'ws_alpha' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'ws_alpha',
      name: 'Alpha Workspace',
      login_idp: {
        kind: 'keycloak',
        url: 'https://login.example.com',
        realm: 'alpha',
        client_id: 'alpha-client',
      },
    });
  });

  it('returns 404 when the workspace is not persisted as public', async () => {
    registryModule.getPublicSystemWorkspace.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/public/workspaces/ws_default'), {
      params: Promise.resolve({ id: 'ws_default' }),
    });

    expect(response.status).toBe(404);
  });

  it('returns 503 when public workspace storage is temporarily unavailable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    registryModule.getPublicSystemWorkspace.mockRejectedValue(new Error('MongoNetworkError: connection closed'));

    const response = await GET(new Request('http://localhost/api/public/workspaces/ws_alpha'), {
      params: Promise.resolve({ id: 'ws_alpha' }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error_code: 'WORKSPACE_CONFIG_UNAVAILABLE',
      error_message: 'workspace_config_unavailable',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to load public workspace configuration:',
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});
