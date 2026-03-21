import { describe, expect, it } from 'vitest';
import type { JsonDocStorePort } from '@mbos/ports';
import {
  createWorkspaceFoundationStoreResourceFromEnv,
  getWorkspaceFoundationBaseCollections,
  initializeWorkspaceFoundations,
} from './workspace-foundation-initializer.js';

class RecordingDocStore implements JsonDocStorePort {
  readonly upsertedCollections = new Set<string>();
  readonly deletedCollections = new Set<string>();

  async get<T>(_collection: string, _id: string): Promise<T | null> {
    return null;
  }

  async upsert<T>(collection: string, _id: string, _doc: T): Promise<void> {
    this.upsertedCollections.add(collection);
  }

  async list<T>(_collection: string, _filter?: Record<string, string>): Promise<T[]> {
    return [];
  }

  async delete(collection: string, _id: string): Promise<void> {
    this.deletedCollections.add(collection);
  }
}

class FailingRecordingDocStore extends RecordingDocStore {
  constructor(private readonly failingCollection: string) {
    super();
  }

  override async upsert<T>(collection: string, id: string, doc: T): Promise<void> {
    if (collection === this.failingCollection) {
      throw new Error(`materialization_failed:${collection}`);
    }
    await super.upsert(collection, id, doc);
  }
}

describe('workspace foundation initializer', () => {
  it('fails fast outside tests when workspace foundation store config is missing', () => {
    expect(() =>
      createWorkspaceFoundationStoreResourceFromEnv({
        NODE_ENV: 'production',
      }),
    ).toThrowError('workspace_foundation_store_unconfigured');
  });

  it('allows explicit memory mode for local-only scenarios', () => {
    const resource = createWorkspaceFoundationStoreResourceFromEnv({
      NODE_ENV: 'production',
      SYSTEM_WORKSPACE_REGISTRY_MODE: 'memory',
    });
    expect(resource.docStore).toBeDefined();
  });

  it('materializes all tenant-scoped foundation collections', async () => {
    const docStore = new RecordingDocStore();

    const result = await initializeWorkspaceFoundations(
      {
        workspace_id: 'platform_ops',
        workspace_name: 'Platform Ops',
        workspace_admin: 'admin@example.com',
        project_creators: ['creator@example.com'],
        tenant: {
          substrate_label: 'primary',
          database_name: 'agentsmith_ws_platform_ops',
          collection_prefix: 'ws_platform_ops_',
          key_prefix: 'ws:platform_ops:',
        },
        idp: {
          kind: 'keycloak',
          url: 'https://idp.example.com',
          realm: 'platform',
          client_id: 'agentsmith-platform',
        },
      },
      {
        docStore,
        now: '2026-03-13T12:00:00.000Z',
      },
    );

    expect(result.status).toBe('ready');
    expect(result.initialized_at).toBe('2026-03-13T12:00:00.000Z');
    expect(result.tenant_materialized).toBe(true);
    expect(result.data_config_applied).toBe(true);
    expect(result.idp_config_applied).toBe(true);
    expect(result.data_foundations.domains).toEqual([
      {
        domain: 'model_config',
        status: 'ready',
        init_error: null,
        collections: [
          'ws_platform_ops_provider_connections',
          'ws_platform_ops_project_model_entries',
          'ws_platform_ops_project_pricing_maps',
        ],
      },
      {
        domain: 'endpoints',
        status: 'ready',
        init_error: null,
        collections: ['ws_platform_ops_credentials', 'ws_platform_ops_endpoints'],
      },
      {
        domain: 'chat',
        status: 'ready',
        init_error: null,
        collections: [
          'ws_platform_ops_chat_sessions',
          'ws_platform_ops_chat_messages',
          'ws_platform_ops_chat_attachments',
        ],
      },
      {
        domain: 'agents',
        status: 'ready',
        init_error: null,
        collections: ['ws_platform_ops_agents', 'ws_platform_ops_agent_service_keys'],
      },
      {
        domain: 'audit_usage',
        status: 'ready',
        init_error: null,
        collections: ['ws_platform_ops_project_audit_events', 'ws_platform_ops_project_usage_facts'],
      },
      {
        domain: 'notebook',
        status: 'ready',
        init_error: null,
        collections: [
          'ws_platform_ops_notebook_tasks',
          'ws_platform_ops_notebook_task_messages',
          'ws_platform_ops_notebook_task_artifacts',
          'ws_platform_ops_notebook_task_trace_events',
        ],
      },
      {
        domain: 'governance',
        status: 'ready',
        init_error: null,
        collections: ['ws_platform_ops_governance_policy_overrides'],
      },
    ]);
    expect(result.data_foundations.materialized_collections).toEqual(
      getWorkspaceFoundationBaseCollections().map((collection) => `ws_platform_ops_${collection}`),
    );
    expect([...docStore.upsertedCollections]).toEqual(result.data_foundations.materialized_collections);
    expect([...docStore.deletedCollections]).toEqual(result.data_foundations.materialized_collections);
  });

  it('returns domain-level failure evidence when materialization fails mid-run', async () => {
    const docStore = new FailingRecordingDocStore('ws_platform_ops_chat_messages');

    const result = await initializeWorkspaceFoundations(
      {
        workspace_id: 'platform_ops',
        workspace_name: 'Platform Ops',
        workspace_admin: 'admin@example.com',
        project_creators: ['creator@example.com'],
        tenant: {
          substrate_label: 'primary',
          database_name: 'agentsmith_ws_platform_ops',
          collection_prefix: 'ws_platform_ops_',
          key_prefix: 'ws:platform_ops:',
        },
        idp: {
          kind: 'keycloak',
          url: 'https://idp.example.com',
          realm: 'platform',
          client_id: 'agentsmith-platform',
        },
      },
      {
        docStore,
        now: '2026-03-13T12:00:00.000Z',
      },
    );

    expect(result.status).toBe('failed');
    expect(result.failed_domain).toBe('chat');
    expect(result.init_error).toBe('materialization_failed:ws_platform_ops_chat_messages');
    expect(result.data_foundations.domains).toEqual([
      expect.objectContaining({ domain: 'model_config', status: 'ready', init_error: null }),
      expect.objectContaining({ domain: 'endpoints', status: 'ready', init_error: null }),
      expect.objectContaining({
        domain: 'chat',
        status: 'failed',
        init_error: 'materialization_failed:ws_platform_ops_chat_messages',
      }),
      expect.objectContaining({ domain: 'agents', status: 'not_started', init_error: null }),
      expect.objectContaining({ domain: 'audit_usage', status: 'not_started', init_error: null }),
      expect.objectContaining({ domain: 'notebook', status: 'not_started', init_error: null }),
      expect.objectContaining({ domain: 'governance', status: 'not_started', init_error: null }),
    ]);
    expect(result.data_foundations.materialized_collections).toEqual([
      'ws_platform_ops_provider_connections',
      'ws_platform_ops_project_model_entries',
      'ws_platform_ops_project_pricing_maps',
      'ws_platform_ops_credentials',
      'ws_platform_ops_endpoints',
    ]);
  });
});
