import { describe, expect, it } from 'vitest';
import {
  mapSystemWorkspaceToPublicConfig,
  mergeAvailableWorkspaceSummaries,
  resolvePublicWorkspaceConfig,
} from '@/mocks/handlers/workspace';

describe('workspace mock handler helpers', () => {
  it('prefers ready system workspace summaries over fixture duplicates', () => {
    const merged = mergeAvailableWorkspaceSummaries({
      fixtureWorkspaces: [
        { id: 'ws_default', name: 'Default fixture', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'ws_fixture_only', name: 'Fixture only', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ],
      systemWorkspaces: [
        { id: 'ws_default', name: 'System override', provisioning_status: 'ready', login_idp: { kind: 'keycloak', url: 'https://idp.example.com', realm: 'alpha', client_id: 'agentsmith' } },
      ],
    });

    expect(merged.map((item) => item.id)).toEqual(['ws_default', 'ws_fixture_only']);
    expect(merged[0]?.name).toBe('System override');
  });

  it('uses workspace-specific login_idp before fixture defaults', () => {
    const config = resolvePublicWorkspaceConfig({
      workspaceId: 'ws_default',
      systemWorkspaces: [
        { id: 'ws_default', name: 'System override', provisioning_status: 'ready', login_idp: { kind: 'keycloak', url: 'https://custom-idp.example.com', realm: 'custom', client_id: 'custom-web' } },
      ],
      fixtureWorkspaces: [{ id: 'ws_default', name: 'Fixture default' }],
      env: {
        NEXT_PUBLIC_KEYCLOAK_URL: 'https://default-idp.example.com',
        NEXT_PUBLIC_KEYCLOAK_REALM: 'default',
        NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: 'default-web',
      } as unknown as NodeJS.ProcessEnv,
    });

    expect(config).toEqual({
      id: 'ws_default',
      name: 'System override',
      login_idp: {
        kind: 'keycloak',
        url: 'https://custom-idp.example.com',
        realm: 'custom',
        client_id: 'custom-web',
      },
    });
  });

  it('falls back to fixture keycloak defaults when no system workspace exists', () => {
    const config = resolvePublicWorkspaceConfig({
      workspaceId: 'ws_fixture',
      systemWorkspaces: [],
      fixtureWorkspaces: [{ id: 'ws_fixture', name: 'Fixture workspace' }],
      env: {
        NEXT_PUBLIC_KEYCLOAK_URL: 'https://default-idp.example.com',
        NEXT_PUBLIC_KEYCLOAK_REALM: 'default',
        NEXT_PUBLIC_KEYCLOAK_CLIENT_ID: 'default-web',
      } as unknown as NodeJS.ProcessEnv,
    });

    expect(config?.login_idp.url).toBe('https://default-idp.example.com');
    expect(config?.login_idp.realm).toBe('default');
    expect(config?.login_idp.client_id).toBe('default-web');
  });

  it('maps login_idp and legacy idp shapes to the public config', () => {
    expect(mapSystemWorkspaceToPublicConfig({
      id: 'ws_login_idp',
      name: 'Workspace A',
      provisioning_status: 'ready',
      login_idp: { kind: 'keycloak', url: 'https://login-a.example.com', realm: 'realm-a', client_id: 'client-a' },
    })).toEqual({
      id: 'ws_login_idp',
      name: 'Workspace A',
      login_idp: { kind: 'keycloak', url: 'https://login-a.example.com', realm: 'realm-a', client_id: 'client-a' },
    });

    expect(mapSystemWorkspaceToPublicConfig({
      id: 'ws_legacy',
      name: 'Workspace B',
      provisioning_status: 'ready',
      idp: { kind: 'keycloak', url: 'https://login-b.example.com', realm: 'realm-b', client_id: 'client-b' },
    })).toEqual({
      id: 'ws_legacy',
      name: 'Workspace B',
      login_idp: { kind: 'keycloak', url: 'https://login-b.example.com', realm: 'realm-b', client_id: 'client-b' },
    });
  });
});
