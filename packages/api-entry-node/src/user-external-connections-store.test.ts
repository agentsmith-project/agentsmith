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
      provider: 'jira',
      custom_domain: null,
      kind: 'secret_bundle',
      display_name: 'Team Jira',
      status: 'active',
      fields: [
        {
          key: 'base_url',
          value: 'https://jira.example.com',
          description: 'Jira base URL',
          secret: false,
        },
        {
          key: 'api_token',
          value: 'secret-token-value',
          description: 'Jira API token',
          secret: true,
        },
      ],
      account_identity: null,
      scopes: ['read:jira-work'],
      expires_at: null,
      last_refreshed_at: null,
      last_used_at: null,
      last_error: null,
    });

    const persisted = await docStore.get<{
      fields: Array<{ key: string; value: string; secret: boolean }>;
    }>('user_external_connections', created.id);
    expect(persisted).not.toBeNull();
    expect(persisted?.fields.find((field) => field.key === 'base_url')?.value).toBe('https://jira.example.com');
    expect(persisted?.fields.find((field) => field.key === 'api_token')?.value).not.toBe('secret-token-value');
    expect(persisted?.fields.find((field) => field.key === 'api_token')?.value.startsWith('enc:v1:')).toBe(true);

    const fetched = await getUserExternalConnection(docStore, 'user_1', created.id);
    expect(fetched?.fields.find((field) => field.key === 'api_token')?.value).toBe('secret-token-value');

    const listed = await listUserExternalConnections(docStore, 'user_1');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.fields.find((field) => field.key === 'api_token')?.value).toBe('secret-token-value');
  });
});
