import { InMemoryJsonDocStore, MongoJsonDocStore } from '@mbos/adapters-private';
import {
  WorkspaceFoundationInitializationRequestSchema,
  WorkspaceFoundationInitializationResultSchema,
  type WorkspaceFoundationInitializationRequest,
  type WorkspaceFoundationInitializationResult,
} from '@mbos/contracts';
import type { JsonDocStorePort } from '@mbos/ports';

const WORKSPACE_FOUNDATION_DOMAINS = [
  {
    domain: 'model_config',
    baseCollections: ['provider_connections', 'project_model_entries', 'project_pricing_maps'],
  },
  {
    domain: 'endpoints',
    baseCollections: ['credentials', 'endpoints'],
  },
  {
    domain: 'chat',
    baseCollections: ['chat_sessions', 'chat_messages', 'chat_attachments'],
  },
  {
    domain: 'agents',
    baseCollections: ['agents', 'agent_service_keys'],
  },
  {
    domain: 'audit_usage',
    baseCollections: ['project_audit_events', 'project_usage_facts'],
  },
  {
    domain: 'agent_task',
    baseCollections: ['agent_tasks', 'agent_task_messages', 'agent_task_artifacts', 'agent_task_trace_events'],
  },
  {
    domain: 'governance',
    baseCollections: ['governance_policy_overrides'],
  },
] as const;

type WorkspaceFoundationStoreResource = {
  docStore: JsonDocStorePort;
  close?: () => Promise<void>;
};

type WorkspaceFoundationDomain = (typeof WORKSPACE_FOUNDATION_DOMAINS)[number]['domain'];

function materializedCollectionName(collectionPrefix: string, baseCollection: string): string {
  return `${collectionPrefix}${baseCollection}`;
}

function buildFoundationDomainReports(input: WorkspaceFoundationInitializationRequest): Array<{
  domain: WorkspaceFoundationDomain;
  status: 'ready' | 'failed' | 'not_started';
  init_error: string | null;
  collections: string[];
}> {
  return WORKSPACE_FOUNDATION_DOMAINS.map((item) => ({
    domain: item.domain,
    status: 'not_started',
    init_error: null,
    collections: item.baseCollections.map((collection) =>
      materializedCollectionName(input.tenant.collection_prefix, collection),
    ),
  }));
}

function listMaterializedCollections(input: WorkspaceFoundationInitializationRequest): string[] {
  return buildFoundationDomainReports(input).flatMap((item) => item.collections);
}

async function materializeCollection(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  workspaceName: string;
  collection: string;
  initializedAt: string;
}): Promise<void> {
  const markerId = `workspace_foundation_bootstrap_${args.workspaceId}`;
  await args.docStore.upsert(args.collection, markerId, {
    id: markerId,
    workspace_id: args.workspaceId,
    workspace_name: args.workspaceName,
    kind: 'workspace_foundation_bootstrap_marker',
    collection: args.collection,
    initialized_at: args.initializedAt,
  });
  await args.docStore.delete(args.collection, markerId);
}

export function createWorkspaceFoundationStoreResourceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceFoundationStoreResource {
  const explicitMode = env.SYSTEM_WORKSPACE_REGISTRY_MODE?.trim().toLowerCase();
  if (explicitMode === 'memory' || explicitMode === 'file') {
    return { docStore: new InMemoryJsonDocStore() };
  }
  const mongoUrl = env.MONGO_URL?.trim();
  if (mongoUrl) {
    const store = new MongoJsonDocStore({
      url: mongoUrl,
      dbName: env.MONGO_DB_NAME?.trim() || 'mbos',
    });
    return {
      docStore: store,
      close: () => store.close(),
    };
  }
  if (env.NODE_ENV === 'test') {
    return { docStore: new InMemoryJsonDocStore() };
  }
  throw new Error('workspace_foundation_store_unconfigured');
}

export async function initializeWorkspaceFoundations(
  input: WorkspaceFoundationInitializationRequest,
  options: {
    docStore?: JsonDocStorePort;
    now?: string;
  } = {},
): Promise<WorkspaceFoundationInitializationResult> {
  const parsed = WorkspaceFoundationInitializationRequestSchema.parse(input);
  const initializedAt = options.now ?? new Date().toISOString();
  const resource = options.docStore ? { docStore: options.docStore } : createWorkspaceFoundationStoreResourceFromEnv();
  const domains = buildFoundationDomainReports(parsed);
  const materializedCollections = listMaterializedCollections(parsed);

  try {
    for (const domainReport of domains) {
      for (const collection of domainReport.collections) {
        await materializeCollection({
          docStore: resource.docStore,
          workspaceId: parsed.workspace_id,
          workspaceName: parsed.workspace_name,
          collection,
          initializedAt,
        });
      }
      domainReport.status = 'ready';
    }

    return WorkspaceFoundationInitializationResultSchema.parse({
      status: 'ready',
      initialized_at: initializedAt,
      init_error: null,
      failed_domain: null,
      tenant_materialized: true,
      idp_config_applied: true,
      data_config_applied: true,
      data_foundations: {
        database_name: parsed.tenant.database_name,
        collection_prefix: parsed.tenant.collection_prefix,
        key_prefix: parsed.tenant.key_prefix,
        domains,
        materialized_collections: materializedCollections,
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.message.trim() ? error.message : 'workspace_foundation_initialization_failed';
    const failedDomain = domains.find((item) => item.status === 'not_started')?.domain ?? domains[domains.length - 1]?.domain ?? null;
    for (const domainReport of domains) {
      if (domainReport.status === 'not_started' && domainReport.domain === failedDomain) {
        domainReport.status = 'failed';
        domainReport.init_error = message;
        continue;
      }
      if (domainReport.status === 'not_started') {
        domainReport.status = 'not_started';
      }
    }
    return WorkspaceFoundationInitializationResultSchema.parse({
      status: 'failed',
      initialized_at: null,
      init_error: message,
      failed_domain: failedDomain,
      tenant_materialized: false,
      idp_config_applied: false,
      data_config_applied: false,
      data_foundations: {
        database_name: parsed.tenant.database_name,
        collection_prefix: parsed.tenant.collection_prefix,
        key_prefix: parsed.tenant.key_prefix,
        domains,
        materialized_collections: domains.filter((item) => item.status === 'ready').flatMap((item) => item.collections),
      },
    });
  } finally {
    await resource.close?.();
  }
}

export function getWorkspaceFoundationBaseCollections(): readonly string[] {
  return WORKSPACE_FOUNDATION_DOMAINS.flatMap((item) => item.baseCollections);
}
