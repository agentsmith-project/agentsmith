import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { createUserExternalConnection } from './user-external-connections-store.js';
import { buildThirdPartyCredentialFiles } from './third-party-credential-files.js';

describe('third-party-credential-files', () => {
  it('builds provider files and index from user external connections', async () => {
    const docStore = new InMemoryJsonDocStore();
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      provider: 'jira',
      custom_domain: null,
      kind: 'secret_bundle',
      display_name: 'team-jira',
      note: 'jira-note',
      status: 'active',
      fields: [
        { key: 'base_url', value: 'https://jira.example.com', secret: false, description: null },
        { key: 'api_token', value: 'token_123', secret: true, description: null },
      ],
      account_identity: null,
      scopes: null,
      expires_at: null,
      last_refreshed_at: null,
      last_used_at: null,
      last_error: null,
    });

    const files = await buildThirdPartyCredentialFiles(docStore, 'user_1');
    expect(files.length).toBe(2);
    expect(files.some((item) => item.relative_path === '.codex/credential/index.json')).toBe(true);
    const jiraFile = files.find((item) => item.relative_path === '.codex/credential/jira/connections.json');
    expect(jiraFile?.content).toContain('"provider": "jira"');
    expect(jiraFile?.content).toContain('"api_token": "token_123"');
  });
});
