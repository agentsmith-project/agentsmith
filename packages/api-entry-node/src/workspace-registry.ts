import type { WorkspaceRecord } from './resource-models.js';
import {
  getPersistedSystemWorkspace,
  listPersistedSystemWorkspaces,
  upsertPersistedSystemWorkspace,
} from './system-workspace-persistence.js';
import type {
  SystemWorkspaceRecord,
  WorkspaceIdentitySnapshot,
} from '../../../src/lib/system-admin/workspace-registry/types.js';

export type { WorkspaceIdentitySnapshot } from '../../../src/lib/system-admin/workspace-registry/types.js';

export type RegisteredWorkspaceConfig = SystemWorkspaceRecord;
export type RegisteredWorkspaceTenantConfig = RegisteredWorkspaceConfig['tenant'];

function normalizeIdentitySnapshots(items: WorkspaceIdentitySnapshot[]): WorkspaceIdentitySnapshot[] {
  return Array.from(
    new Map(
      items
        .map((item) => ({
          user_id: item.user_id.trim(),
          email: item.email.trim(),
          name: item.name && item.name.trim().length > 0 ? item.name.trim() : null,
        }))
        .filter((item) => item.user_id.length > 0 && item.email.length > 0)
        .map((item) => [item.user_id.toLowerCase(), item]),
    ).values(),
  );
}

export async function readRegisteredWorkspaces(): Promise<WorkspaceRecord[]> {
  const items = await listPersistedSystemWorkspaces();
  return items
    .filter((item) => item.provisioning_status === 'ready')
    .map((item) => ({
      id: item.id,
      name: item.name,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));
}

export async function listRegisteredWorkspaceIds(): Promise<string[]> {
  const defaults = new Set<string>([(process.env.MBOS_DEFAULT_WORKSPACE_ID ?? 'ws_default').trim()]);
  for (const item of await listPersistedSystemWorkspaces()) {
    if (item.id.trim().length > 0) {
      defaults.add(item.id.trim());
    }
  }
  return [...defaults].filter((item) => item.length > 0);
}

export async function getRegisteredWorkspaceConfig(workspaceId: string): Promise<RegisteredWorkspaceConfig | null> {
  return getPersistedSystemWorkspace(workspaceId);
}

export async function getRegisteredWorkspaceTenantConfig(
  workspaceId: string,
): Promise<RegisteredWorkspaceTenantConfig | null> {
  const record = await getRegisteredWorkspaceConfig(workspaceId);
  if (!record?.tenant) return null;
  const collectionPrefix = record.tenant.collection_prefix?.trim();
  const keyPrefix = record.tenant.key_prefix?.trim();
  const databaseName = record.tenant.database_name?.trim();
  if (!collectionPrefix || !keyPrefix || !databaseName) {
    return null;
  }
  return {
    substrate_label: record.tenant.substrate_label,
    database_name: databaseName,
    collection_prefix: collectionPrefix,
    key_prefix: keyPrefix,
    workspace_id: record.tenant.workspace_id,
    workspace_name: record.tenant.workspace_name,
  };
}

export async function updateRegisteredWorkspaceProjectCreators(
  workspaceId: string,
  projectCreators: WorkspaceIdentitySnapshot[],
): Promise<RegisteredWorkspaceConfig> {
  const target = await getPersistedSystemWorkspace(workspaceId);
  if (!target) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  const next: RegisteredWorkspaceConfig = {
    ...target,
    project_creators: normalizeIdentitySnapshots(projectCreators),
    updated_at: new Date().toISOString(),
  };
  await upsertPersistedSystemWorkspace(next);
  return next;
}

export async function bindRegisteredWorkspaceAdminIfMatched(args: {
  workspaceId: string;
  actorId: string;
  actorEmail?: string;
  actorName?: string;
}): Promise<RegisteredWorkspaceConfig | null> {
  const actorEmail = args.actorEmail?.trim().toLowerCase();
  if (!actorEmail) return null;
  const target = await getPersistedSystemWorkspace(args.workspaceId);
  if (!target?.workspace_admin_binding_required || !target.workspace_admin) {
    return target;
  }
  if (target.workspace_admin.trim().toLowerCase() !== actorEmail) {
    return target;
  }
  const next: RegisteredWorkspaceConfig = {
    ...target,
    workspace_admin_user_id: args.actorId.trim(),
    workspace_admin_name: args.actorName?.trim() || target.workspace_admin_name || null,
    workspace_admin_binding_required: false,
    updated_at: new Date().toISOString(),
  };
  await upsertPersistedSystemWorkspace(next);
  return next;
}
