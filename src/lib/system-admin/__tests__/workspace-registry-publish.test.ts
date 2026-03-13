import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const provisioningModule = vi.hoisted(() => ({
  initializeWorkspaceResources: vi.fn(),
}));

vi.mock('../workspace-registry/provisioning', () => provisioningModule);

import {
  createSystemWorkspace,
  getSystemWorkspace,
  publishSystemWorkspace,
} from '../workspace-registry';

describe('publishSystemWorkspace retry semantics', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-system-ws-publish-'));
    process.env.SYSTEM_WORKSPACE_REGISTRY_PATH = join(dir, 'system-workspaces.json');
    provisioningModule.initializeWorkspaceResources.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('preserves the last successful initialization timestamp when a later publish attempt fails', async () => {
    await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin: 'admin@example.com',
      idp_url: 'https://idp.example.com',
      idp_realm: 'platform',
      idp_client_id: 'agentsmith-platform',
      idp_client_secret: 'secret-1',
    });

    provisioningModule.initializeWorkspaceResources
      .mockResolvedValueOnce({
        status: 'ready',
        initialized_at: '2026-03-13T08:00:00.000Z',
        init_error: null,
      })
      .mockResolvedValueOnce({
        status: 'failed',
        initialized_at: null,
        init_error: 'chat: materialization_failed',
      });

    const firstPublish = await publishSystemWorkspace('platform_ops');
    expect(firstPublish.provisioning_status).toBe('ready');
    expect(firstPublish.last_initialized_at).toBe('2026-03-13T08:00:00.000Z');

    const secondPublish = await publishSystemWorkspace('platform_ops');
    expect(secondPublish.provisioning_status).toBe('failed');
    expect(secondPublish.last_initialized_at).toBe('2026-03-13T08:00:00.000Z');
    expect(secondPublish.last_init_error).toBe('chat: materialization_failed');

    const persisted = await getSystemWorkspace('platform_ops');
    expect(persisted).toEqual(
      expect.objectContaining({
        provisioning_status: 'failed',
        last_initialized_at: '2026-03-13T08:00:00.000Z',
        last_init_error: 'chat: materialization_failed',
      }),
    );
  });

  it('rejects publish when the workspace is already provisioning', async () => {
    await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin: 'admin@example.com',
      idp_url: 'https://idp.example.com',
      idp_realm: 'platform',
      idp_client_id: 'agentsmith-platform',
      idp_client_secret: 'secret-1',
    });

    provisioningModule.initializeWorkspaceResources.mockResolvedValue({
      status: 'ready',
      initialized_at: '2026-03-13T08:00:00.000Z',
      init_error: null,
    });

    const published = await publishSystemWorkspace('platform_ops');
    expect(published.provisioning_status).toBe('ready');

    const registryPath = process.env.SYSTEM_WORKSPACE_REGISTRY_PATH!;
    const raw = await import('node:fs/promises');
    const records = JSON.parse(await raw.readFile(registryPath, 'utf-8')) as Array<Record<string, unknown>>;
    records[0] = {
      ...records[0],
      provisioning_status: 'provisioning',
    };
    await raw.writeFile(registryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf-8');

    await expect(publishSystemWorkspace('platform_ops')).rejects.toMatchObject({
      code: 'WORKSPACE_ALREADY_PROVISIONING',
    });
  });
});
