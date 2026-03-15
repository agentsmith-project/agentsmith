import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildWorkspaceTenantPreview } from '../config';
import type {
  PublicSystemWorkspaceRecord,
  SystemWorkspaceIdpConfig,
  SystemWorkspaceRecord,
  UpsertSystemWorkspaceInput,
  WorkspaceIdentitySnapshot,
} from './types';

function normalizeLegacyIdentifier(item: string): WorkspaceIdentitySnapshot {
  const trimmed = item.trim();
  const email = trimmed.includes('@') ? trimmed : `${trimmed}@workspace.local`;
  return {
    user_id: trimmed,
    email,
    name: trimmed,
  };
}

function normalizeIdentitySnapshots(items: unknown): WorkspaceIdentitySnapshot[] {
  if (!Array.isArray(items)) return [];
  return Array.from(
    new Map(
      items
        .map((item) => {
          if (typeof item === 'string') {
            return normalizeLegacyIdentifier(item);
          }
          if (typeof item !== 'object' || item === null) {
            return null;
          }
          const raw = item as Record<string, unknown>;
          const userId = typeof raw['user_id'] === 'string' ? raw['user_id'].trim() : '';
          const email = typeof raw['email'] === 'string' ? raw['email'].trim() : '';
          if (!userId || !email) {
            return null;
          }
          const name = typeof raw['name'] === 'string' && raw['name'].trim().length > 0
            ? raw['name'].trim()
            : null;
          return { user_id: userId, email, name };
        })
        .filter((item): item is WorkspaceIdentitySnapshot => item !== null)
        .map((item) => [item.user_id.trim().toLowerCase(), item]),
    ).values(),
  );
}

export function getRegistryPath(): string {
  return process.env.SYSTEM_WORKSPACE_REGISTRY_PATH?.trim() || join(process.cwd(), 'artifacts/system-workspaces.json');
}

export async function ensureRegistryDir(pathname: string): Promise<void> {
  await mkdir(dirname(pathname), { recursive: true });
}

function normalizeRecord(record: SystemWorkspaceRecord | Record<string, unknown>): SystemWorkspaceRecord {
  const raw = record as Record<string, unknown>;
  const provisioningStatus = raw['provisioning_status'];
  const workspaceAdmin = typeof raw['workspace_admin'] === 'string' ? raw['workspace_admin'].trim() : '';
  const workspaceAdminUserId =
    typeof raw['workspace_admin_user_id'] === 'string' ? raw['workspace_admin_user_id'].trim() : '';
  const workspaceAdminName =
    typeof raw['workspace_admin_name'] === 'string' && raw['workspace_admin_name'].trim().length > 0
      ? raw['workspace_admin_name'].trim()
      : null;
  return {
    ...(record as SystemWorkspaceRecord),
    workspace_admin: workspaceAdmin,
    workspace_admin_user_id: workspaceAdminUserId || undefined,
    workspace_admin_name: workspaceAdminName,
    project_creators: normalizeIdentitySnapshots(raw['project_creators']),
    provisioning_status:
      provisioningStatus === 'draft' ||
      provisioningStatus === 'provisioning' ||
      provisioningStatus === 'ready' ||
      provisioningStatus === 'failed' ||
      provisioningStatus === 'disabled'
        ? provisioningStatus
        : 'ready',
    last_initialized_at:
      typeof raw['last_initialized_at'] === 'string' && raw['last_initialized_at'].trim().length > 0
        ? String(raw['last_initialized_at'])
        : null,
    last_init_error:
      typeof raw['last_init_error'] === 'string' && raw['last_init_error'].trim().length > 0
        ? String(raw['last_init_error'])
        : null,
  };
}

export async function readRegistryFile(): Promise<SystemWorkspaceRecord[]> {
  const pathname = getRegistryPath();
  try {
    const raw = await readFile(pathname, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? data.map(normalizeRecord) : [];
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : '';
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function writeRegistryFile(records: SystemWorkspaceRecord[]): Promise<void> {
  const pathname = getRegistryPath();
  await ensureRegistryDir(pathname);
  await writeFile(pathname, `${JSON.stringify(records, null, 2)}\n`, 'utf-8');
}

export function sanitizeRecord(record: SystemWorkspaceRecord): PublicSystemWorkspaceRecord {
  return {
    ...record,
    project_creators: record.project_creators.map((item) => ({ ...item })),
    idp: {
      kind: record.idp.kind,
      url: record.idp.url,
      realm: record.idp.realm,
      client_id: record.idp.client_id,
      has_client_secret: Boolean(record.idp.client_secret),
    },
  };
}

export function createWorkspaceRecord(
  existingRecords: SystemWorkspaceRecord[],
  input: UpsertSystemWorkspaceInput,
  workspaceAdmin: WorkspaceIdentitySnapshot,
): SystemWorkspaceRecord {
  const tenant = buildWorkspaceTenantPreview(input.name);
  if (existingRecords.some((record) => record.id === tenant.workspace_id)) {
    throw Object.assign(new Error('workspace_exists'), { code: 'WORKSPACE_EXISTS' });
  }

  const now = new Date().toISOString();
  return {
    id: tenant.workspace_id,
    name: input.name.trim(),
    workspace_admin: workspaceAdmin.email,
    workspace_admin_user_id: workspaceAdmin.user_id,
    workspace_admin_name: workspaceAdmin.name,
    project_creators: [],
    idp: {
      kind: 'keycloak',
      url: input.idp_url.trim(),
      realm: input.idp_realm.trim(),
      client_id: input.idp_client_id.trim(),
      client_secret: input.idp_client_secret?.trim() || undefined,
    },
    tenant,
    provisioning_status: 'draft',
    last_initialized_at: null,
    last_init_error: null,
    created_at: now,
    updated_at: now,
  };
}

export function buildUpdatedWorkspaceRecord(
  existing: SystemWorkspaceRecord,
  input: UpsertSystemWorkspaceInput,
  workspaceAdmin: WorkspaceIdentitySnapshot,
): SystemWorkspaceRecord {
  const nextIdp: SystemWorkspaceIdpConfig = {
    kind: 'keycloak',
    url: input.idp_url.trim(),
    realm: input.idp_realm.trim(),
    client_id: input.idp_client_id.trim(),
    client_secret: input.idp_client_secret?.trim() || existing.idp.client_secret,
  };
  const requiresRepublish =
    existing.name !== input.name.trim() ||
    existing.workspace_admin !== workspaceAdmin.email ||
    existing.workspace_admin_user_id !== workspaceAdmin.user_id ||
    existing.idp.url !== nextIdp.url ||
    existing.idp.realm !== nextIdp.realm ||
    existing.idp.client_id !== nextIdp.client_id ||
    (existing.idp.client_secret || '') !== (nextIdp.client_secret || '');

  return {
    ...existing,
    name: input.name.trim(),
    workspace_admin: workspaceAdmin.email,
    workspace_admin_user_id: workspaceAdmin.user_id,
    workspace_admin_name: workspaceAdmin.name,
    idp: nextIdp,
    provisioning_status: requiresRepublish ? 'draft' : existing.provisioning_status,
    last_initialized_at: requiresRepublish ? null : existing.last_initialized_at,
    last_init_error: requiresRepublish ? null : existing.last_init_error,
    updated_at: new Date().toISOString(),
  };
}
