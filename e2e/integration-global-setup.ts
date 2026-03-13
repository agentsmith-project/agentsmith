import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type WorkspaceRegistryRecord = {
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
  };
  tenant?: {
    substrate_label?: string;
    database_name?: string;
    collection_prefix?: string;
    key_prefix?: string;
  };
  created_at?: string;
  updated_at?: string;
};

function getRegistryPaths(): string[] {
  const explicit = process.env.SYSTEM_WORKSPACE_REGISTRY_PATH?.trim();
  if (explicit) {
    return [explicit];
  }
  return [
    join(process.cwd(), 'artifacts/system-workspaces.json'),
    join(process.cwd(), 'packages/api-entry-node/artifacts/system-workspaces.json'),
  ];
}

function seedRegistryFile(registryPath: string): void {
  mkdirSync(dirname(registryPath), { recursive: true });
  const now = new Date().toISOString();

  let records: WorkspaceRegistryRecord[] = [];
  if (existsSync(registryPath)) {
    try {
      const parsed = JSON.parse(readFileSync(registryPath, 'utf-8')) as unknown;
      if (Array.isArray(parsed)) {
        records = parsed.filter(
          (item): item is WorkspaceRegistryRecord => typeof item === 'object' && item !== null,
        );
      }
    } catch {
      records = [];
    }
  }

  const existing = records.find((record) => record.id === 'ws_default');
  const seeded: WorkspaceRegistryRecord = {
    id: 'ws_default',
    name: 'Default Workspace',
    provisioning_status: 'ready',
    workspace_admin: 'dev-admin@example.com',
    project_creators: Array.from(
      new Set([
        'dev-admin',
        'dev-admin@example.com',
        'integration-user',
        'integration-user@example.com',
        ...(existing?.project_creators ?? []),
      ]),
    ),
    idp: {
      kind: 'keycloak',
      url: process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080',
      realm: process.env.KEYCLOAK_REALM ?? 'mbos',
      client_id: process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith',
    },
    tenant: {
      substrate_label: 'default',
      database_name: 'agentsmith_ws_default',
      collection_prefix: 'ws_default_',
      key_prefix: 'ws_default:',
    },
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  const next = existing
    ? records.map((record) => (record.id === seeded.id ? { ...record, ...seeded } : record))
    : [seeded, ...records];

  writeFileSync(registryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
}

export default async function globalSetup(): Promise<void> {
  for (const registryPath of getRegistryPaths()) {
    seedRegistryFile(registryPath);
  }
}
