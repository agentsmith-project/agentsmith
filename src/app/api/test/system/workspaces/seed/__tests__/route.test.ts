import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageModule = vi.hoisted(() => ({
  listPersistedSystemWorkspaces: vi.fn(),
  deletePersistedSystemWorkspace: vi.fn(),
  upsertPersistedSystemWorkspace: vi.fn(),
}));

vi.mock('@/lib/system-admin/workspace-registry/persistence', () => storageModule);

import { GET, POST } from '../route';

function buildRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ws_seeded',
    name: 'Seeded Workspace',
    workspace_admin: 'seed-admin@example.com',
    workspace_admin_user_id: 'kc-seed-admin',
    workspace_admin_name: 'Seed Admin',
    project_creators: [],
    idp: {
      kind: 'keycloak',
      url: 'https://seed.example.com',
      realm: 'seed',
      client_id: 'seed-client',
    },
    tenant: {
      workspace_id: 'ws_seeded',
      workspace_name: 'Seeded Workspace',
      substrate_label: 'primary',
      database_name: 'agentsmith_ws_ws_seeded',
      collection_prefix: 'ws_ws_seeded_',
      key_prefix: 'ws:ws_seeded:',
    },
    provisioning_status: 'ready',
    last_initialized_at: '2026-03-15T00:00:00.000Z',
    last_init_error: null,
    created_at: '2026-03-15T00:00:00.000Z',
    updated_at: '2026-03-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('/api/test/system/workspaces/seed', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    storageModule.listPersistedSystemWorkspaces.mockResolvedValue([]);
    storageModule.deletePersistedSystemWorkspace.mockResolvedValue(undefined);
    storageModule.upsertPersistedSystemWorkspace.mockResolvedValue(undefined);
    process.env = { ...originalEnv, NEXT_PUBLIC_USE_MSW: 'true' };
  });

  it('rejects invalid workspace payloads', async () => {
    const response = await POST(
      new Request('http://localhost/api/test/system/workspaces/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ records: [{ id: 'ws_bad' }] }),
      }),
    );

    expect(response.status).toBe(422);
  });

  it('writes an empty seeded state', async () => {
    const response = await POST(
      new Request('http://localhost/api/test/system/workspaces/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ records: [] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(storageModule.listPersistedSystemWorkspaces).toHaveBeenCalled();
    expect(storageModule.upsertPersistedSystemWorkspace).not.toHaveBeenCalled();
  });

  it('writes a seeded workspace state', async () => {
    const response = await POST(
      new Request('http://localhost/api/test/system/workspaces/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          records: [buildRecord({
            provisioning_status: 'failed',
            last_initialized_at: null,
            last_init_error: 'identity_provider_config_incomplete',
          })],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(storageModule.upsertPersistedSystemWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ws_seeded',
        provisioning_status: 'failed',
        last_init_error: 'identity_provider_config_incomplete',
      }),
    );
  });



  it('returns seeded records in mock mode', async () => {
    storageModule.listPersistedSystemWorkspaces.mockResolvedValue([buildRecord()]);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      items: [expect.objectContaining({ id: 'ws_seeded', name: 'Seeded Workspace' })],
    });
  });

  it('returns not found outside mock lane', async () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_USE_MSW: 'false' };

    const response = await POST(
      new Request('http://localhost/api/test/system/workspaces/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ records: [] }),
      }),
    );

    expect(response.status).toBe(404);
  });
});
