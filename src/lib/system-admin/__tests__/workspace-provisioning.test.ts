import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apiEntryNodeModule = vi.hoisted(() => ({
  initializeWorkspaceFoundations: vi.fn(),
}));

vi.mock('@mbos/api-entry-node', () => apiEntryNodeModule);

import { initializeWorkspaceResources } from '../workspace-registry/provisioning';
import type { SystemWorkspaceRecord } from '../workspace-registry/types';

describe('workspace provisioning', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-system-provisioning-'));
    process.env.SYSTEM_WORKSPACE_PROVISIONING_PATH = dir;
    apiEntryNodeModule.initializeWorkspaceFoundations.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('summarizes failed domain into top-level init_error and artifact attempt evidence', async () => {
    apiEntryNodeModule.initializeWorkspaceFoundations.mockResolvedValue({
      status: 'failed',
      initialized_at: null,
      init_error: 'materialization_failed:ws_platform_ops_chat_messages',
      failed_domain: 'chat',
      tenant_materialized: false,
      idp_config_applied: false,
      data_config_applied: false,
      data_foundations: {
        database_name: 'agentsmith_ws_platform_ops',
        collection_prefix: 'ws_platform_ops_',
        key_prefix: 'ws:platform_ops:',
        domains: [
          {
            domain: 'chat',
            status: 'failed',
            init_error: 'materialization_failed:ws_platform_ops_chat_messages',
            collections: ['ws_platform_ops_chat_sessions', 'ws_platform_ops_chat_messages'],
          },
        ],
        materialized_collections: [],
      },
    });

    const record: SystemWorkspaceRecord = {
      id: 'platform_ops',
      name: 'Platform Ops',
      workspace_admin: 'admin@example.com',
      project_creators: ['creator@example.com'],
      idp: {
        kind: 'keycloak',
        url: 'https://idp.example.com',
        realm: 'platform',
        client_id: 'agentsmith-platform',
      },
      tenant: {
        workspace_id: 'platform_ops',
        workspace_name: 'Platform Ops',
        substrate_label: 'primary',
        database_name: 'agentsmith_ws_platform_ops',
        collection_prefix: 'ws_platform_ops_',
        key_prefix: 'ws:platform_ops:',
      },
      provisioning_status: 'provisioning',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-03-13T00:00:00.000Z',
      updated_at: '2026-03-13T00:00:00.000Z',
    };

    const result = await initializeWorkspaceResources(record);
    expect(result).toEqual({
      status: 'failed',
      initialized_at: null,
      init_error: 'chat: materialization_failed:ws_platform_ops_chat_messages',
    });

    const artifact = JSON.parse(
      readFileSync(join(process.env.SYSTEM_WORKSPACE_PROVISIONING_PATH!, 'platform_ops.json'), 'utf-8'),
    ) as {
      provisioning_result: { init_error: string | null };
      latest_attempt: { init_error: string | null; failed_domain: string | null };
    };

    expect(artifact.provisioning_result.init_error).toBe('chat: materialization_failed:ws_platform_ops_chat_messages');
    expect(artifact.latest_attempt).toEqual(
      expect.objectContaining({
        init_error: 'chat: materialization_failed:ws_platform_ops_chat_messages',
        failed_domain: 'chat',
      }),
    );
  });
});
