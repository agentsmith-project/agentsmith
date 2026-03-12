import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildWorkspaceTenantPreview } from './config';

export interface SystemWorkspaceIdpConfig {
  kind: 'keycloak';
  url: string;
  realm: string;
  client_id: string;
  client_secret?: string;
}

export interface SystemWorkspaceRecord {
  id: string;
  name: string;
  workspace_admin: string;
  idp: SystemWorkspaceIdpConfig;
  tenant: ReturnType<typeof buildWorkspaceTenantPreview>;
  created_at: string;
  updated_at: string;
}

export interface PublicSystemWorkspaceRecord extends Omit<SystemWorkspaceRecord, 'idp'> {
  idp: Omit<SystemWorkspaceIdpConfig, 'client_secret'> & {
    has_client_secret: boolean;
  };
}

export interface UpsertSystemWorkspaceInput {
  name: string;
  workspace_admin: string;
  idp_url: string;
  idp_realm: string;
  idp_client_id: string;
  idp_client_secret?: string;
}

function getRegistryPath(): string {
  return process.env.SYSTEM_WORKSPACE_REGISTRY_PATH?.trim() || join(process.cwd(), 'artifacts/system-workspaces.json');
}

async function ensureRegistryDir(pathname: string): Promise<void> {
  await mkdir(dirname(pathname), { recursive: true });
}

async function readRegistryFile(): Promise<SystemWorkspaceRecord[]> {
  const pathname = getRegistryPath();
  try {
    const raw = await readFile(pathname, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? (data as SystemWorkspaceRecord[]) : [];
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : '';
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeRegistryFile(records: SystemWorkspaceRecord[]): Promise<void> {
  const pathname = getRegistryPath();
  await ensureRegistryDir(pathname);
  await writeFile(pathname, `${JSON.stringify(records, null, 2)}\n`, 'utf-8');
}

function sanitizeRecord(record: SystemWorkspaceRecord): PublicSystemWorkspaceRecord {
  return {
    ...record,
    idp: {
      kind: record.idp.kind,
      url: record.idp.url,
      realm: record.idp.realm,
      client_id: record.idp.client_id,
      has_client_secret: Boolean(record.idp.client_secret),
    },
  };
}

export async function listSystemWorkspaces(): Promise<SystemWorkspaceRecord[]> {
  const records = await readRegistryFile();
  return records.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listPublicSystemWorkspaces(): Promise<PublicSystemWorkspaceRecord[]> {
  const records = await listSystemWorkspaces();
  return records.map(sanitizeRecord);
}

export async function getSystemWorkspace(id: string): Promise<SystemWorkspaceRecord | null> {
  const records = await readRegistryFile();
  return records.find((record) => record.id === id) ?? null;
}

export async function createSystemWorkspace(input: UpsertSystemWorkspaceInput): Promise<SystemWorkspaceRecord> {
  const records = await readRegistryFile();
  const tenant = buildWorkspaceTenantPreview(input.name);
  if (records.some((record) => record.id === tenant.workspace_id)) {
    throw Object.assign(new Error('workspace_exists'), { code: 'WORKSPACE_EXISTS' });
  }
  const now = new Date().toISOString();
  const record: SystemWorkspaceRecord = {
    id: tenant.workspace_id,
    name: input.name.trim(),
    workspace_admin: input.workspace_admin.trim(),
    idp: {
      kind: 'keycloak',
      url: input.idp_url.trim(),
      realm: input.idp_realm.trim(),
      client_id: input.idp_client_id.trim(),
      client_secret: input.idp_client_secret?.trim() || undefined,
    },
    tenant,
    created_at: now,
    updated_at: now,
  };
  await writeRegistryFile([...records, record]);
  return record;
}

export async function updateSystemWorkspace(
  id: string,
  input: UpsertSystemWorkspaceInput,
): Promise<SystemWorkspaceRecord> {
  const records = await readRegistryFile();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  const updated: SystemWorkspaceRecord = {
    ...existing,
    name: input.name.trim(),
    workspace_admin: input.workspace_admin.trim(),
    idp: {
      kind: 'keycloak',
      url: input.idp_url.trim(),
      realm: input.idp_realm.trim(),
      client_id: input.idp_client_id.trim(),
      client_secret: input.idp_client_secret?.trim() || existing.idp.client_secret,
    },
    updated_at: new Date().toISOString(),
  };
  await writeRegistryFile(records.map((record) => (record.id === id ? updated : record)));
  return updated;
}

export async function deleteSystemWorkspace(id: string): Promise<void> {
  const records = await readRegistryFile();
  const nextRecords = records.filter((record) => record.id !== id);
  if (nextRecords.length === records.length) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  await writeRegistryFile(nextRecords);
}
