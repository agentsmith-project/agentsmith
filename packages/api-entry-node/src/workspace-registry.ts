import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WorkspaceRecord } from './resource-models.js';

type RegistryRecord = {
  id: string;
  name: string;
  workspace_admin?: string;
  project_creators?: string[];
  tenant?: {
    substrate_label?: string;
    database_name?: string;
    collection_prefix?: string;
    key_prefix?: string;
  };
  created_at?: string;
  updated_at?: string;
};

function getRegistryPath(): string {
  return process.env.SYSTEM_WORKSPACE_REGISTRY_PATH?.trim() || join(process.cwd(), 'artifacts/system-workspaces.json');
}

export function readRegisteredWorkspaces(): WorkspaceRecord[] {
  try {
    const raw = readFileSync(getRegistryPath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is RegistryRecord => typeof item === 'object' && item !== null)
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
  workspace_admin?: string;
  project_creators?: string[];
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
    const raw = readFileSync(getRegistryPath(), 'utf-8');
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
        created_at: typeof item.created_at === 'string' ? item.created_at : now,
        updated_at: typeof item.updated_at === 'string' ? item.updated_at : now,
      }))
      .filter((item) => item.id && item.name);
  } catch {
    return [];
  }
}

function writeRegisteredWorkspaceConfigs(records: RegisteredWorkspaceConfig[]): void {
  const pathname = getRegistryPath();
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
