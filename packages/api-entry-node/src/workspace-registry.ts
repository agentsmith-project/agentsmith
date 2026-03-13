import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WorkspaceRecord } from './resource-models.js';

type RegistryRecord = {
  id: string;
  name: string;
  workspace_admin?: string;
  project_creators?: string[];
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
