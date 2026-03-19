import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageModule = vi.hoisted(() => ({
  listPersistedSystemWorkspaces: vi.fn(),
  deletePersistedSystemWorkspace: vi.fn(),
  upsertPersistedSystemWorkspace: vi.fn(),
}));

vi.mock('@/lib/system-admin/workspace-registry/persistence', () => storageModule);

import { POST } from '../route';

describe('/api/test/system/workspaces/seed', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    storageModule.listPersistedSystemWorkspaces.mockResolvedValue([]);
    storageModule.deletePersistedSystemWorkspace.mockResolvedValue(undefined);
    storageModule.upsertPersistedSystemWorkspace.mockResolvedValue(undefined);
    process.env = { ...originalEnv, NEXT_PUBLIC_USE_MSW: 'true' };
  });

  it('rejects invalid seed states', async () => {
    const response = await POST(
      new Request('http://localhost/api/test/system/workspaces/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'unknown' }),
      }),
    );

    expect(response.status).toBe(422);
  });

  it('writes an empty seeded state', async () => {
    const response = await POST(
      new Request('http://localhost/api/test/system/workspaces/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'empty' }),
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
        body: JSON.stringify({ state: 'with_failed_workspace' }),
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

  it('returns not found outside mock lane', async () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_USE_MSW: 'false' };

    const response = await POST(
      new Request('http://localhost/api/test/system/workspaces/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'empty' }),
      }),
    );

    expect(response.status).toBe(404);
  });
});
