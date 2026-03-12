import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceRecord } from './resource-models.js';

type RegistryRecord = {
  id: string;
  name: string;
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
