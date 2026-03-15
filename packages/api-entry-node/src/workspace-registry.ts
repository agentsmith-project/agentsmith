import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkspaceRecord } from './resource-models.js';

export type WorkspaceIdentitySnapshot = {
  user_id: string;
  email: string;
  name: string | null;
};

type RegistryRecord = {
  id: string;
  name: string;
  provisioning_status?: string;
  workspace_admin?: string;
  workspace_admin_user_id?: string;
  workspace_admin_name?: string | null;
  project_creators?: Array<string | WorkspaceIdentitySnapshot>;
  idp?: {
    kind?: string;
    url?: string;
    realm?: string;
    client_id?: string;
    client_secret?: string;
  };
  tenant?: {
    substrate_label?: string;
    database_name?: string;
    collection_prefix?: string;
    key_prefix?: string;
  };
  last_initialized_at?: string | null;
  last_init_error?: string | null;
  created_at?: string;
  updated_at?: string;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(moduleDir, '..');
const repoRoot = resolve(moduleDir, '../../..');

export function resolveRegisteredWorkspaceRegistryPath(): string {
  const explicit = process.env.SYSTEM_WORKSPACE_REGISTRY_PATH?.trim();
  if (explicit) {
    return explicit;
  }

  const repoRegistryPath = join(repoRoot, 'artifacts/system-workspaces.json');
  if (existsSync(repoRegistryPath)) {
    return repoRegistryPath;
  }

  const cwdRegistryPath = join(process.cwd(), 'artifacts/system-workspaces.json');
  if (existsSync(cwdRegistryPath)) {
    return cwdRegistryPath;
  }

  return join(packageRoot, 'artifacts/system-workspaces.json');
}

export function readRegisteredWorkspaces(): WorkspaceRecord[] {
  try {
    const raw = readFileSync(resolveRegisteredWorkspaceRegistryPath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is RegistryRecord => typeof item === 'object' && item !== null)
      .filter((item) => {
        const status = typeof item.provisioning_status === 'string' ? item.provisioning_status.trim() : '';
        return !status || status === 'ready';
      })
      .map((item) => ({
        id: String(item.id ?? '').trim(),
        name: String(item.name ?? '').trim(),
        created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString(),
        updated_at: typeof item.updated_at === 'string' ? item.updated_at : new Date().toISOString(),
      }))
      .filter((item) => item.id && item.name);
  } catch {
    return [];
  }
}

export type RegisteredWorkspaceConfig = RegistryRecord & {
  id: string;
  name: string;
  provisioning_status?: string;
  workspace_admin?: string;
  workspace_admin_user_id?: string;
  workspace_admin_name?: string | null;
  project_creators?: WorkspaceIdentitySnapshot[];
  idp?: {
    kind?: string;
    url?: string;
    realm?: string;
    client_id?: string;
    client_secret?: string;
  };
  tenant?: {
    substrate_label?: string;
    database_name?: string;
    collection_prefix?: string;
    key_prefix?: string;
  };
  created_at: string;
  updated_at: string;
};

function normalizeLegacyIdentity(identifier: string): WorkspaceIdentitySnapshot {
  const trimmed = identifier.trim();
  return {
    user_id: trimmed,
    email: trimmed.includes('@') ? trimmed : `${trimmed}@workspace.local`,
    name: trimmed,
  };
}

function normalizeIdentitySnapshots(items: unknown): WorkspaceIdentitySnapshot[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return Array.from(
    new Map(
      items
        .map((item) => {
          if (typeof item === 'string') {
            const trimmed = item.trim();
            return trimmed ? normalizeLegacyIdentity(trimmed) : null;
          }
          if (typeof item !== 'object' || item === null) {
            return null;
          }
          const raw = item as Record<string, unknown>;
          const userId = typeof raw.user_id === 'string' ? raw.user_id.trim() : '';
          const email = typeof raw.email === 'string' ? raw.email.trim() : '';
          if (!userId || !email) {
            return null;
          }
          return {
            user_id: userId,
            email,
            name: typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : null,
          };
        })
        .filter((item): item is WorkspaceIdentitySnapshot => item !== null)
        .map((item) => [item.user_id.trim().toLowerCase(), item]),
    ).values(),
  );
}

function readRegisteredWorkspaceConfigs(): RegisteredWorkspaceConfig[] {
  try {
    const raw = readFileSync(resolveRegisteredWorkspaceRegistryPath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const now = new Date().toISOString();
    return parsed
      .filter((item): item is RegistryRecord => typeof item === 'object' && item !== null)
      .map((item) => ({
        id: String(item.id ?? '').trim(),
        name: String(item.name ?? '').trim(),
        provisioning_status:
          typeof item.provisioning_status === 'string' ? item.provisioning_status.trim() : undefined,
        workspace_admin: typeof item.workspace_admin === 'string' ? item.workspace_admin.trim() : undefined,
        workspace_admin_user_id:
          typeof item.workspace_admin_user_id === 'string' ? item.workspace_admin_user_id.trim() : undefined,
        workspace_admin_name:
          typeof item.workspace_admin_name === 'string' && item.workspace_admin_name.trim().length > 0
            ? item.workspace_admin_name.trim()
            : null,
        project_creators: normalizeIdentitySnapshots(item.project_creators),
        idp:
          typeof item.idp === 'object' && item.idp !== null
            ? {
                kind: typeof item.idp.kind === 'string' ? item.idp.kind.trim() : undefined,
                url: typeof item.idp.url === 'string' ? item.idp.url.trim() : undefined,
                realm: typeof item.idp.realm === 'string' ? item.idp.realm.trim() : undefined,
                client_id: typeof item.idp.client_id === 'string' ? item.idp.client_id.trim() : undefined,
                client_secret:
                  typeof item.idp.client_secret === 'string' ? item.idp.client_secret.trim() : undefined,
              }
            : undefined,
        tenant:
          typeof item.tenant === 'object' && item.tenant !== null
            ? {
                substrate_label:
                  typeof item.tenant.substrate_label === 'string' ? item.tenant.substrate_label.trim() : undefined,
                database_name:
                  typeof item.tenant.database_name === 'string' ? item.tenant.database_name.trim() : undefined,
                collection_prefix:
                  typeof item.tenant.collection_prefix === 'string'
                    ? item.tenant.collection_prefix.trim()
                    : undefined,
                key_prefix:
                  typeof item.tenant.key_prefix === 'string' ? item.tenant.key_prefix.trim() : undefined,
              }
            : undefined,
        last_initialized_at:
          typeof item.last_initialized_at === 'string' || item.last_initialized_at === null
            ? item.last_initialized_at
            : undefined,
        last_init_error:
          typeof item.last_init_error === 'string' || item.last_init_error === null
            ? item.last_init_error
            : undefined,
        created_at: typeof item.created_at === 'string' ? item.created_at : now,
        updated_at: typeof item.updated_at === 'string' ? item.updated_at : now,
      }))
      .filter((item) => item.id && item.name);
  } catch {
    return [];
  }
}

function writeRegisteredWorkspaceConfigs(records: RegisteredWorkspaceConfig[]): void {
  const pathname = resolveRegisteredWorkspaceRegistryPath();
  mkdirSync(dirname(pathname), { recursive: true });
  writeFileSync(pathname, `${JSON.stringify(records, null, 2)}\n`, 'utf-8');
}

export function getRegisteredWorkspaceConfig(workspaceId: string): RegisteredWorkspaceConfig | null {
  return readRegisteredWorkspaceConfigs().find((record) => record.id === workspaceId) ?? null;
}

export type RegisteredWorkspaceTenantConfig = NonNullable<RegisteredWorkspaceConfig['tenant']>;

export function getRegisteredWorkspaceTenantConfig(workspaceId: string): RegisteredWorkspaceTenantConfig | null {
  const record = getRegisteredWorkspaceConfig(workspaceId);
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
  };
}

export function updateRegisteredWorkspaceProjectCreators(
  workspaceId: string,
  projectCreators: WorkspaceIdentitySnapshot[],
): RegisteredWorkspaceConfig {
  const records = readRegisteredWorkspaceConfigs();
  const target = records.find((record) => record.id === workspaceId);
  if (!target) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  target.project_creators = normalizeIdentitySnapshots(projectCreators);
  target.updated_at = new Date().toISOString();
  writeRegisteredWorkspaceConfigs(records);
  return target;
}
