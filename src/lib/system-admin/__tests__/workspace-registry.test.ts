import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSystemWorkspace,
  disableSystemWorkspace,
  getPublicSystemWorkspace,
  listPublicSystemWorkspaces,
  publishSystemWorkspace,
  updateSystemWorkspace,
} from '../workspace-registry';

describe('system workspace registry', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-system-ws-'));
    process.env.SYSTEM_WORKSPACE_REGISTRY_PATH = join(dir, 'system-workspaces.json');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates draft workspaces and only lists ready workspaces publicly', async () => {
    const created = await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin: 'admin@example.com',
      project_creators: ['creator@example.com'],
      idp_url: 'https://idp.example.com',
      idp_realm: 'platform',
      idp_client_id: 'agentsmith-platform',
      idp_client_secret: 'secret-1',
    });

    expect(created.provisioning_status).toBe('draft');
    await expect(listPublicSystemWorkspaces()).resolves.toEqual([]);

    await publishSystemWorkspace('platform_ops');

    await expect(listPublicSystemWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        id: 'platform_ops',
        name: 'Platform Ops',
        workspace_admin: 'admin@example.com',
        project_creators: ['creator@example.com'],
        idp: expect.objectContaining({
          kind: 'keycloak',
          url: 'https://idp.example.com',
          realm: 'platform',
          client_id: 'agentsmith-platform',
          has_client_secret: true,
        }),
      }),
    ]);
  });

  it('updates existing workspace configuration', async () => {
    await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin: 'admin@example.com',
      project_creators: ['creator@example.com'],
      idp_url: 'https://idp.example.com',
      idp_realm: 'platform',
      idp_client_id: 'agentsmith-platform',
      idp_client_secret: 'secret-1',
    });

    const updated = await updateSystemWorkspace('platform_ops', {
      name: 'Platform Ops',
      workspace_admin: 'ops-admin@example.com',
      idp_url: 'https://login.example.com',
      idp_realm: 'platform-prod',
      idp_client_id: 'agentsmith-platform-prod',
      idp_client_secret: '',
    });

    expect(updated.workspace_admin).toBe('ops-admin@example.com');
    expect(updated.project_creators).toEqual(['creator@example.com']);
    expect(updated.idp.url).toBe('https://login.example.com');
    expect(updated.idp.realm).toBe('platform-prod');
    expect(updated.idp.client_secret).toBe('secret-1');
    expect(updated.provisioning_status).toBe('draft');
    expect(updated.last_initialized_at).toBeNull();
    expect(updated.last_init_error).toBeNull();
  });

  it('publishes and disables workspace visibility', async () => {
    await createSystemWorkspace({
      name: 'Platform Ops',
      workspace_admin: 'admin@example.com',
      idp_url: 'https://idp.example.com',
      idp_realm: 'platform',
      idp_client_id: 'agentsmith-platform',
      idp_client_secret: 'secret-1',
    });

    const published = await publishSystemWorkspace('platform_ops');
    expect(published.provisioning_status).toBe('ready');
    expect(published.last_initialized_at).toBeTruthy();
    await expect(getPublicSystemWorkspace('platform_ops')).resolves.toEqual(
      expect.objectContaining({ id: 'platform_ops', provisioning_status: 'ready' }),
    );

    const disabled = await disableSystemWorkspace('platform_ops');
    expect(disabled.provisioning_status).toBe('disabled');
    await expect(getPublicSystemWorkspace('platform_ops')).resolves.toBeNull();
  });
});
