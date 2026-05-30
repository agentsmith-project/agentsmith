import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  createUserExternalConnection,
  getUserExternalConnection,
  listUserExternalConnections,
} from './user-external-connections-store.js';

describe('user-external-connections-store', () => {
  it('encrypts secret field values at rest and decrypts them on read', async () => {
    const docStore = new InMemoryJsonDocStore();

    const created = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      provider: 'custom',
      custom_domain: 'issues.internal.example',
      kind: 'secret_bundle',
      display_name: 'Issue Tracker Bundle',
      status: 'active',
      fields: [
        {
          key: 'base_url',
          value: 'https://issues.internal.example',
          description: 'Base URL',
          secret: false,
        },
        {
          key: 'token',
          value: 'secret-token-value',
          description: 'API token',
          secret: true,
        },
      ],
      last_used_at: null,
      last_error: null,
    });

    const persisted = await docStore.get<{
      fields: Array<{ key: string; value: string; secret: boolean }>;
    }>('user_external_connections', created.id);
    expect(persisted).not.toBeNull();
    expect(persisted?.fields.find((field) => field.key === 'base_url')?.value).toBe('https://issues.internal.example');
    expect(persisted?.fields.find((field) => field.key === 'token')?.value).not.toBe('secret-token-value');
    expect(persisted?.fields.find((field) => field.key === 'token')?.value.startsWith('enc:v1:')).toBe(true);

    const fetched = await getUserExternalConnection(docStore, 'user_1', created.id);
    expect(fetched?.fields.find((field) => field.key === 'token')?.value).toBe('secret-token-value');

    const listed = await listUserExternalConnections(docStore, 'user_1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.fields.find((field) => field.key === 'token')?.value).toBe('secret-token-value');
  });

  it('filters retired provider and kind records before hydrating persisted data', async () => {
    const docStore = new InMemoryJsonDocStore();
    const baseRecord = {
      user_id: 'user_1',
      custom_domain: null,
      display_name: 'Legacy OAuth Record',
      note: null,
      status: 'active',
      fields: [
        {
          key: 'access_token',
          value: 'legacy-token-should-not-hydrate',
          description: 'Legacy token',
          secret: true,
        },
      ],
      last_used_at: null,
      last_error: null,
      created_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
    };
    await docStore.upsert('user_external_connections', 'uec_legacy_provider', {
      ...baseRecord,
      id: 'uec_legacy_provider',
      provider: 'sample_provider',
      kind: 'secret_bundle',
    });
    await docStore.upsert('user_external_connections', 'uec_legacy_kind', {
      ...baseRecord,
      id: 'uec_legacy_kind',
      provider: 'custom',
      kind: 'oauth_account',
    });
    const supported = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      provider: 'custom',
      custom_domain: 'custom.local',
      kind: 'secret_bundle',
      display_name: 'Supported Custom Bundle',
      status: 'active',
      fields: [],
      last_used_at: null,
      last_error: null,
    });

    await expect(getUserExternalConnection(docStore, 'user_1', 'uec_legacy_provider')).resolves.toBeNull();
    await expect(getUserExternalConnection(docStore, 'user_1', 'uec_legacy_kind')).resolves.toBeNull();

    const listed = await listUserExternalConnections(docStore, 'user_1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(supported.id);
  });
});
