import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkspaceRecord } from './resource-models.js';

type RegistryRecord = {
  id: string;
  name: string;
  provisioning_status?: string;
  workspace_admin?: string;
  project_creators?: string[];
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
  project_creators?: string[];
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
        project_creators: Array.isArray(item.project_creators)
          ? Array.from(
              new Set(
                item.project_creators
                  .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                  .filter((entry) => entry.length > 0),
              ),
            )
          : [],
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

export function updateRegisteredWorkspaceProjectCreators(workspaceId: string, identifiers: string[]): RegisteredWorkspaceConfig {
  const records = readRegisteredWorkspaceConfigs();
  const target = records.find((record) => record.id === workspaceId);
  if (!target) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  const normalized = Array.from(
    new Set(
      identifiers
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0),
    ),
  );
  target.project_creators = normalized;
  target.updated_at = new Date().toISOString();
  writeRegisteredWorkspaceConfigs(records);
  return target;
}
