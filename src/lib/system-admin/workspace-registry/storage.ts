import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildWorkspaceTenantPreview } from '../config';
import type {
  PublicSystemWorkspaceRecord,
  SystemWorkspaceIdpConfig,
  SystemWorkspaceRecord,
  UpsertSystemWorkspaceInput,
} from './types';

function normalizeIdentifiers(items: string[] | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return Array.from(
    new Set(
      items
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0),
    ),
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
  return {
    ...(record as SystemWorkspaceRecord),
    project_creators: normalizeIdentifiers(Array.isArray(raw['project_creators']) ? (raw['project_creators'] as string[]) : []),
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
    project_creators: [...record.project_creators],
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
): SystemWorkspaceRecord {
  const tenant = buildWorkspaceTenantPreview(input.name);
  if (existingRecords.some((record) => record.id === tenant.workspace_id)) {
    throw Object.assign(new Error('workspace_exists'), { code: 'WORKSPACE_EXISTS' });
  }

  const now = new Date().toISOString();
  return {
    id: tenant.workspace_id,
    name: input.name.trim(),
    workspace_admin: input.workspace_admin.trim(),
    project_creators: normalizeIdentifiers(input.project_creators),
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
): SystemWorkspaceRecord {
  const nextProjectCreators = input.project_creators
    ? normalizeIdentifiers(input.project_creators)
    : existing.project_creators;
  const nextIdp: SystemWorkspaceIdpConfig = {
    kind: 'keycloak',
    url: input.idp_url.trim(),
    realm: input.idp_realm.trim(),
    client_id: input.idp_client_id.trim(),
    client_secret: input.idp_client_secret?.trim() || existing.idp.client_secret,
  };
  const requiresRepublish =
    existing.name !== input.name.trim() ||
    existing.workspace_admin !== input.workspace_admin.trim() ||
    JSON.stringify(existing.project_creators) !== JSON.stringify(nextProjectCreators) ||
    existing.idp.url !== nextIdp.url ||
    existing.idp.realm !== nextIdp.realm ||
    existing.idp.client_id !== nextIdp.client_id ||
    (existing.idp.client_secret || '') !== (nextIdp.client_secret || '');

  return {
    ...existing,
    name: input.name.trim(),
    workspace_admin: input.workspace_admin.trim(),
    project_creators: nextProjectCreators,
    idp: nextIdp,
    provisioning_status: requiresRepublish ? 'draft' : existing.provisioning_status,
    last_initialized_at: requiresRepublish ? null : existing.last_initialized_at,
    last_init_error: requiresRepublish ? null : existing.last_init_error,
    updated_at: new Date().toISOString(),
  };
}
