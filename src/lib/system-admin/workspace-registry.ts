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
  project_creators: string[];
  idp: SystemWorkspaceIdpConfig;
  tenant: ReturnType<typeof buildWorkspaceTenantPreview>;
  provisioning_status: WorkspaceProvisioningStatus;
  last_initialized_at: string | null;
  last_init_error: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkspaceProvisioningStatus =
  | 'draft'
  | 'provisioning'
  | 'ready'
  | 'failed'
  | 'disabled';

export interface PublicSystemWorkspaceRecord extends Omit<SystemWorkspaceRecord, 'idp'> {
  idp: Omit<SystemWorkspaceIdpConfig, 'client_secret'> & {
    has_client_secret: boolean;
  };
}

export interface UpsertSystemWorkspaceInput {
  name: string;
  workspace_admin: string;
  project_creators?: string[];
  idp_url: string;
  idp_realm: string;
  idp_client_id: string;
  idp_client_secret?: string;
}

export interface PublishSystemWorkspaceResult {
  status: WorkspaceProvisioningStatus;
  initialized_at: string | null;
  init_error: string | null;
}

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
    return Array.isArray(data) ? data.map(normalizeRecord) : [];
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: string }).code) : '';
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
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

async function writeRegistryFile(records: SystemWorkspaceRecord[]): Promise<void> {
  const pathname = getRegistryPath();
  await ensureRegistryDir(pathname);
  await writeFile(pathname, `${JSON.stringify(records, null, 2)}\n`, 'utf-8');
}

function sanitizeRecord(record: SystemWorkspaceRecord): PublicSystemWorkspaceRecord {
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

export async function listSystemWorkspaces(): Promise<SystemWorkspaceRecord[]> {
  const records = await readRegistryFile();
  return records.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listPublicSystemWorkspaces(): Promise<PublicSystemWorkspaceRecord[]> {
  const records = await listSystemWorkspaces();
  return records.filter((record) => record.provisioning_status === 'ready').map(sanitizeRecord);
}

export async function getSystemWorkspace(id: string): Promise<SystemWorkspaceRecord | null> {
  const records = await readRegistryFile();
  return records.find((record) => record.id === id) ?? null;
}

export async function getPublicSystemWorkspace(id: string): Promise<SystemWorkspaceRecord | null> {
  const record = await getSystemWorkspace(id);
  if (!record || record.provisioning_status !== 'ready') {
    return null;
  }
  return record;
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
    project_creators: input.project_creators ? normalizeIdentifiers(input.project_creators) : existing.project_creators,
    idp: {
      kind: 'keycloak',
      url: input.idp_url.trim(),
      realm: input.idp_realm.trim(),
      client_id: input.idp_client_id.trim(),
      client_secret: input.idp_client_secret?.trim() || existing.idp.client_secret,
    },
    provisioning_status: existing.provisioning_status,
    last_initialized_at: existing.last_initialized_at,
    last_init_error: existing.last_init_error,
    updated_at: new Date().toISOString(),
  };
  await writeRegistryFile(records.map((record) => (record.id === id ? updated : record)));
  return updated;
}

function getProvisioningArtifactPath(id: string): string {
  const root = process.env.SYSTEM_WORKSPACE_PROVISIONING_PATH?.trim() || join(process.cwd(), 'artifacts/system-workspace-provisioning');
  return join(root, `${id}.json`);
}

async function initializeWorkspaceResources(record: SystemWorkspaceRecord): Promise<PublishSystemWorkspaceResult> {
  const provisioningArtifact = getProvisioningArtifactPath(record.id);
  const now = new Date().toISOString();

  if (!record.idp.url.trim() || !record.idp.realm.trim() || !record.idp.client_id.trim()) {
    return {
      status: 'failed',
      initialized_at: null,
      init_error: 'identity_provider_config_incomplete',
    };
  }

  if (!record.tenant.database_name.trim() || !record.tenant.collection_prefix.trim() || !record.tenant.key_prefix.trim()) {
    return {
      status: 'failed',
      initialized_at: null,
      init_error: 'tenant_configuration_incomplete',
    };
  }

  await ensureRegistryDir(provisioningArtifact);
  await writeFile(
    provisioningArtifact,
    `${JSON.stringify(
      {
        workspace_id: record.id,
        workspace_name: record.name,
        tenant: record.tenant,
        idp: {
          kind: record.idp.kind,
          url: record.idp.url,
          realm: record.idp.realm,
          client_id: record.idp.client_id,
        },
        initialized_at: now,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  return {
    status: 'ready',
    initialized_at: now,
    init_error: null,
  };
}

export async function publishSystemWorkspace(id: string): Promise<SystemWorkspaceRecord> {
  const records = await readRegistryFile();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }

  const provisioningRecord: SystemWorkspaceRecord = {
    ...existing,
    provisioning_status: 'provisioning',
    last_init_error: null,
    updated_at: new Date().toISOString(),
  };
  await writeRegistryFile(records.map((record) => (record.id === id ? provisioningRecord : record)));

  const result = await initializeWorkspaceResources(provisioningRecord);
  const finalized: SystemWorkspaceRecord = {
    ...provisioningRecord,
    provisioning_status: result.status,
    last_initialized_at: result.initialized_at,
    last_init_error: result.init_error,
    updated_at: new Date().toISOString(),
  };
  await writeRegistryFile(records.map((record) => (record.id === id ? finalized : record)));
  return finalized;
}

export async function disableSystemWorkspace(id: string): Promise<SystemWorkspaceRecord> {
  const records = await readRegistryFile();
  const existing = records.find((record) => record.id === id);
  if (!existing) {
    throw Object.assign(new Error('workspace_not_found'), { code: 'WORKSPACE_NOT_FOUND' });
  }
  const updated: SystemWorkspaceRecord = {
    ...existing,
    provisioning_status: 'disabled',
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
