import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { createUserExternalConnection } from './user-external-connections-store.js';
import { buildThirdPartyCredentialFiles } from './third-party-credential-files.js';
import { upsertWorkspaceFeishuIntegration } from './workspace-feishu-settings-store.js';

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

    const files = await buildThirdPartyCredentialFiles(docStore, 'user_1', { taskId: 'task_1' });
    expect(files.length).toBe(2);
    expect(files.some((item) => item.relative_path === '.codex/credential/index.json')).toBe(true);
    const jiraFile = files.find((item) => item.relative_path === '.codex/credential/jira/connections.json');
    expect(jiraFile?.content).toContain('"provider": "jira"');
    expect(jiraFile?.content).toContain('"api_token": "token_123"');
  });

  it('prefers workspace-scoped feishu connection and injects matching app credentials', async () => {
    const docStore = new InMemoryJsonDocStore();
    await upsertWorkspaceFeishuIntegration(docStore, {
      id: 'workspace_feishu:ws_target',
      workspace_id: 'ws_target',
      provider: 'feishu',
      status: 'enabled',
      app_id: 'cli_target',
      app_secret: 'secret_target',
      redirect_uri: 'http://localhost/callback',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_other',
      provider: 'feishu',
      custom_domain: null,
      kind: 'oauth_account',
      display_name: 'other-tenant',
      note: null,
      status: 'active',
      fields: [
        { key: 'access_token', value: 'token_other', secret: true, description: null },
        { key: 'refresh_token', value: 'refresh_other', secret: true, description: null },
      ],
      account_identity: null,
      scopes: ['docs:read'],
      expires_at: null,
      last_refreshed_at: null,
      last_used_at: null,
      last_error: null,
    });
    await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      workspace_id: 'ws_target',
      provider: 'feishu',
      custom_domain: null,
      kind: 'oauth_account',
      display_name: 'target-tenant',
      note: null,
      status: 'active',
      fields: [
        { key: 'access_token', value: 'token_target', secret: true, description: null },
        { key: 'refresh_token', value: 'refresh_target', secret: true, description: null },
      ],
      account_identity: null,
      scopes: ['docs:read'],
      expires_at: null,
      last_refreshed_at: null,
      last_used_at: null,
      last_error: null,
    });

    const files = await buildThirdPartyCredentialFiles(docStore, 'user_1', { workspaceId: 'ws_target' });
    const feishuFile = files.find((item) => item.relative_path === '.codex/credential/feishu/connections.json');
    expect(feishuFile).toBeTruthy();
    const payload = JSON.parse(feishuFile!.content) as {
      connections: Array<{ workspace_id?: string | null; fields: Record<string, string> }>;
    };
    expect(payload.connections).toHaveLength(1);
    expect(payload.connections[0]?.workspace_id).toBe('ws_target');
    expect(payload.connections[0]?.fields.access_token).toBe('token_target');
    expect(payload.connections[0]?.fields.app_id).toBe('cli_target');
    expect(payload.connections[0]?.fields.app_secret).toBe('secret_target');
  });
});
