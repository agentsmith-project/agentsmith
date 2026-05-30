import type { JsonDocStorePort } from '@mbos/ports';
import {
  getContextEntry,
  putContextEntry,
  type ContextEntryRecord,
  type ContextScope,
} from './context-store.js';
import {
  listUserExternalConnections,
  selectUserExternalConnectionForProvider,
  type UserExternalConnectionProvider,
  type UserExternalConnectionRecord,
} from './user-external-connections-store.js';
import { getProjectMembership } from './project-member-governance-persistence.js';

export type ManagedCredentialBindingScope = 'member' | 'project_member';

export type ManagedCredentialBindingRecord = {
  provider: UserExternalConnectionProvider;
  connection_id: string;
};

export type ManagedCredentialResolutionSource =
  | 'project_member_binding'
  | 'member_binding'
  | 'workspace_active_connection';

export type ManagedCredentialResolution = {
  connection: UserExternalConnectionRecord;
  source: ManagedCredentialResolutionSource;
  binding_scope?: ManagedCredentialBindingScope | null;
};

export const FEISHU_MANAGED_CREDENTIAL_HELPER_FIELD_KEYS: ReadonlySet<string> = new Set([
  'access_token',
  'feishu_mcp_endpoint',
  'uat',
  'token',
]);

function bindingKey(provider: UserExternalConnectionProvider): string {
  return `managed_credential_bindings.${provider}`;
}

function parseBindingContent(content: string, provider: UserExternalConnectionProvider): ManagedCredentialBindingRecord | null {
  try {
    const parsed = JSON.parse(content) as Partial<ManagedCredentialBindingRecord>;
    if (parsed?.provider !== provider || typeof parsed.connection_id !== 'string' || !parsed.connection_id.trim()) {
      return null;
    }
    return {
      provider,
      connection_id: parsed.connection_id.trim(),
    };
  } catch {
    return null;
  }
}

async function readManagedCredentialBinding(args: {
  docStore: JsonDocStorePort;
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  provider: UserExternalConnectionProvider;
  scope: ManagedCredentialBindingScope;
}): Promise<ManagedCredentialBindingRecord | null> {
  const target = args.scope === 'project_member'
    ? {
        scope: 'project_member' as ContextScope,
        key: bindingKey(args.provider),
        user_id: args.userId,
        workspace_id: args.workspaceId ?? null,
        project_id: args.projectId ?? null,
      }
    : {
        scope: 'member' as ContextScope,
        key: bindingKey(args.provider),
        user_id: args.userId,
        workspace_id: args.workspaceId ?? null,
      };
  const entry = await getContextEntry(args.docStore, target);
  if (!entry) return null;
  return parseBindingContent(entry.content, args.provider);
}

async function canUseProjectMemberBinding(args: {
  docStore: JsonDocStorePort;
  userId: string;
  workspaceId: string;
  projectId: string;
}): Promise<boolean> {
  const membership = await getProjectMembership(args.docStore, args.workspaceId, args.projectId, args.userId);
  return membership?.status === 'active';
}

export async function syncManagedCredentialBinding(args: {
  docStore: JsonDocStorePort;
  userId: string;
  workspaceId: string;
  provider: UserExternalConnectionProvider;
  connectionId: string;
  updatedBy: string;
  scope: ManagedCredentialBindingScope;
  projectId?: string | null;
}): Promise<ContextEntryRecord> {
  return putContextEntry(args.docStore, {
    scope: args.scope,
    key: bindingKey(args.provider),
    content: JSON.stringify({
      provider: args.provider,
      connection_id: args.connectionId,
    }),
    content_type: 'json',
    user_id: args.userId,
    workspace_id: args.workspaceId,
    project_id: args.scope === 'project_member' ? args.projectId ?? null : null,
    updated_by: args.updatedBy,
  });
}

async function resolveBindingConnection(args: {
  docStore: JsonDocStorePort;
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  provider: UserExternalConnectionProvider;
  scope: ManagedCredentialBindingScope;
}): Promise<{ connection: UserExternalConnectionRecord; source: ManagedCredentialResolutionSource; bindingScope: ManagedCredentialBindingScope } | null> {
  const binding = await readManagedCredentialBinding(args);
  if (!binding) return null;
  if (args.scope === 'project_member') {
    if (!args.workspaceId || !args.projectId) return null;
    const allowed = await canUseProjectMemberBinding({
      docStore: args.docStore,
      userId: args.userId,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
    });
    if (!allowed) return null;
  }
  const connections = await listUserExternalConnections(args.docStore, args.userId);
  const connection = connections.find((item) => item.id === binding.connection_id && item.provider === args.provider);
  if (!connection) return null;
  if (args.workspaceId && connection.workspace_id && connection.workspace_id !== args.workspaceId) return null;
  return {
    connection,
    source: args.scope === 'project_member' ? 'project_member_binding' : 'member_binding',
    bindingScope: args.scope,
  };
}

function selectWorkspaceScopedExternalConnection(
  connections: UserExternalConnectionRecord[],
  provider: UserExternalConnectionProvider,
  workspaceId: string,
): UserExternalConnectionRecord | null {
  const scopedOrGlobalConnections = connections.filter((item) => item.workspace_id === workspaceId || item.workspace_id == null);
  return selectUserExternalConnectionForProvider(scopedOrGlobalConnections, provider, workspaceId);
}

export async function resolveManagedCredentialConnection(args: {
  docStore: JsonDocStorePort;
  userId: string;
  provider: UserExternalConnectionProvider;
  workspaceId?: string | null;
  projectId?: string | null;
}): Promise<ManagedCredentialResolution | null> {
  const projectBinding = await resolveBindingConnection({
    docStore: args.docStore,
    userId: args.userId,
    provider: args.provider,
    workspaceId: args.workspaceId ?? null,
    projectId: args.projectId ?? null,
    scope: 'project_member',
  });
  if (projectBinding) return projectBinding;

  const memberBinding = await resolveBindingConnection({
    docStore: args.docStore,
    userId: args.userId,
    provider: args.provider,
    workspaceId: args.workspaceId ?? null,
    scope: 'member',
  });
  if (memberBinding) return memberBinding;

  const connections = await listUserExternalConnections(args.docStore, args.userId);
  const fallback = args.workspaceId
    ? selectWorkspaceScopedExternalConnection(connections, args.provider, args.workspaceId)
    : selectUserExternalConnectionForProvider(connections, args.provider, null);
  if (!fallback) return null;
  return {
    connection: fallback,
    source: 'workspace_active_connection',
    binding_scope: null,
  };
}

function buildFeishuHelperProjectionContent(connection: UserExternalConnectionRecord): string | null {
  const fields: Record<string, string> = {};
  for (const field of connection.fields) {
    const key = field.key.trim();
    if (key && field.value && FEISHU_MANAGED_CREDENTIAL_HELPER_FIELD_KEYS.has(key)) {
      fields[key] = field.value;
    }
  }
  if (Object.keys(fields).length === 0) return null;
  return `${JSON.stringify({ fields }, null, 2)}\n`;
}

function buildProjectionContent(connection: UserExternalConnectionRecord): string | null {
  if (connection.provider !== 'feishu') return null;
  return buildFeishuHelperProjectionContent(connection);
}

export async function buildManagedCredentialProjection(args: {
  docStore: JsonDocStorePort;
  userId: string;
  provider: UserExternalConnectionProvider;
  workspaceId?: string | null;
  projectId?: string | null;
}): Promise<ContextEntryRecord | null> {
  const resolved = await resolveManagedCredentialConnection(args);
  if (!resolved) return null;
  const content = buildProjectionContent(resolved.connection);
  if (!content) return null;
  return {
    id: `ctx_managed_${resolved.connection.provider}_${resolved.connection.id}`,
    scope: 'member',
    key: `managed_credentials.${resolved.connection.provider}`,
    content,
    content_type: 'json',
    user_id: resolved.connection.user_id,
    workspace_id: resolved.connection.workspace_id ?? null,
    read_only: true,
    updated_at: resolved.connection.updated_at,
    updated_by: resolved.connection.user_id,
  };
}

export async function buildManagedCredentialEntries(args: {
  docStore: JsonDocStorePort;
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
}): Promise<ContextEntryRecord[]> {
  const all = await listUserExternalConnections(args.docStore, args.userId);
  const providers = Array.from(new Set(all.map((item) => item.provider)));
  const projections = await Promise.all(providers.map((provider) => buildManagedCredentialProjection({
    docStore: args.docStore,
    userId: args.userId,
    provider,
    workspaceId: args.workspaceId ?? null,
    projectId: args.projectId ?? null,
  })));
  return projections
    .filter((item): item is ContextEntryRecord => item !== null)
    .sort((left, right) => left.key.localeCompare(right.key));
}
