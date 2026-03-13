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
      { provisioning_status: 'draft' },
      { provisioning_status: 'ready' },
      { provisioning_status: 'ready' },
      { provisioning_status: 'failed' },
      { provisioning_status: 'disabled' },
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
        },
      }),
    );
  });
});
