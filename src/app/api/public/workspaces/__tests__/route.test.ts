import { beforeEach, describe, expect, it, vi } from 'vitest';

const registryModule = vi.hoisted(() => ({
  listPublicSystemWorkspaces: vi.fn(),
}));

vi.mock('@/lib/system-admin/workspace-registry', () => registryModule);

import { GET } from '../route';

describe('/api/public/workspaces', () => {
  beforeEach(() => {
    registryModule.listPublicSystemWorkspaces.mockReset();
  });

  it('returns ready public workspaces as a compact directory list', async () => {
    registryModule.listPublicSystemWorkspaces.mockResolvedValue([
      {
        id: 'ws_alpha',
        name: 'Alpha Workspace',
        idp: {
          kind: 'keycloak',
          url: 'http://localhost:18080/realms',
          realm: 'mbos',
          client_id: 'agentsmith',
        },
      },
      {
        id: 'ws_beta',
        name: 'Beta Workspace',
        idp: {
          kind: 'keycloak',
          url: 'http://localhost:18080/realms',
          realm: 'mbos',
          client_id: 'agentsmith',
        },
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        { id: 'ws_alpha', name: 'Alpha Workspace' },
        { id: 'ws_beta', name: 'Beta Workspace' },
      ],
      total: 2,
    });
  });

  it('returns an empty directory when no public workspaces are available', async () => {
    registryModule.listPublicSystemWorkspaces.mockResolvedValue([]);

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 0,
    });
  });
});
