import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../workspace-registry', () => ({
  listSystemWorkspaces: vi.fn(),
}));

import { listSystemWorkspaces } from '../workspace-registry';
import { getSystemInfoSnapshot } from '../system-info';

describe('system info snapshot', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = env;
    vi.restoreAllMocks();
  });

  it('builds restrained provisioning and config status summary', async () => {
    vi.mocked(listSystemWorkspaces).mockResolvedValue([
      { provisioning_status: 'draft', last_initialized_at: null, updated_at: '2026-03-10T00:00:00.000Z', last_init_error: null },
      { provisioning_status: 'ready', last_initialized_at: '2026-03-11T01:00:00.000Z', updated_at: '2026-03-11T01:00:00.000Z', last_init_error: null },
      { provisioning_status: 'ready', last_initialized_at: '2026-03-12T01:00:00.000Z', updated_at: '2026-03-12T01:00:00.000Z', last_init_error: null },
      { provisioning_status: 'failed', last_initialized_at: null, updated_at: '2026-03-13T02:00:00.000Z', last_init_error: 'tenant_configuration_incomplete' },
      { provisioning_status: 'disabled', last_initialized_at: '2026-03-09T01:00:00.000Z', updated_at: '2026-03-09T01:00:00.000Z', last_init_error: null },
    ] as never);

    process.env.SYSTEM_SUBSTRATE_URL = 'mongodb://db.internal:27017';
    process.env.NEXT_PUBLIC_KEYCLOAK_URL = 'https://login.example.com';
    process.env.NEXT_PUBLIC_KEYCLOAK_REALM = 'mbos';
    process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID = 'agentsmith';

    await expect(getSystemInfoSnapshot()).resolves.toEqual(
      expect.objectContaining({
        workspace_registry_status: 'available',
        data_service_status: 'configured',
        default_idp_status: 'configured',
        workspace_provisioning: {
          total: 5,
          draft: 1,
          provisioning: 0,
          ready: 2,
          failed: 1,
          disabled: 1,
          last_initialized_at: '2026-03-12T01:00:00.000Z',
          last_ready_at: '2026-03-12T01:00:00.000Z',
          last_failed_at: '2026-03-13T02:00:00.000Z',
          last_init_error: 'tenant_configuration_incomplete',
        },
      }),
    );
  });

  it('falls back to unavailable registry summary when registry cannot be read', async () => {
    vi.mocked(listSystemWorkspaces).mockRejectedValue(new Error('registry_unavailable'));
    process.env.SYSTEM_SUBSTRATE_URL = '';
    process.env.NEXT_PUBLIC_KEYCLOAK_URL = '';
    process.env.NEXT_PUBLIC_KEYCLOAK_REALM = '';
    process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID = '';

    await expect(getSystemInfoSnapshot()).resolves.toEqual(
      expect.objectContaining({
        workspace_registry_status: 'unavailable',
        data_service_status: 'configured',
        default_idp_status: 'incomplete',
        workspace_provisioning: {
          total: 0,
          draft: 0,
          provisioning: 0,
          ready: 0,
          failed: 0,
          disabled: 0,
          last_initialized_at: null,
          last_ready_at: null,
          last_failed_at: null,
          last_init_error: null,
        },
      }),
    );
  });
});
