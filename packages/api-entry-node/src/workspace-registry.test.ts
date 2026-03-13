import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRegisteredWorkspaces } from './workspace-registry.js';

describe('readRegisteredWorkspaces', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-api-workspace-registry-'));
    process.env.SYSTEM_WORKSPACE_REGISTRY_PATH = join(dir, 'system-workspaces.json');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns ready registered workspaces and skips disabled ones', () => {
    writeFileSync(
      process.env.SYSTEM_WORKSPACE_REGISTRY_PATH!,
      `${JSON.stringify([
        {
          id: 'ws_ready',
          name: 'Ready Workspace',
          provisioning_status: 'ready',
          created_at: '2026-03-12T00:00:00.000Z',
          updated_at: '2026-03-12T00:00:00.000Z',
        },
        {
          id: 'ws_disabled',
          name: 'Disabled Workspace',
          provisioning_status: 'disabled',
          created_at: '2026-03-11T00:00:00.000Z',
          updated_at: '2026-03-11T00:00:00.000Z',
        },
        {
          id: 'ws_legacy',
          name: 'Legacy Workspace',
          created_at: '2026-03-10T00:00:00.000Z',
          updated_at: '2026-03-10T00:00:00.000Z',
        },
      ], null, 2)}\n`,
      'utf-8',
    );

    expect(readRegisteredWorkspaces()).toEqual([
      {
        id: 'ws_ready',
        name: 'Ready Workspace',
        created_at: '2026-03-12T00:00:00.000Z',
        updated_at: '2026-03-12T00:00:00.000Z',
      },
      {
        id: 'ws_legacy',
        name: 'Legacy Workspace',
        created_at: '2026-03-10T00:00:00.000Z',
        updated_at: '2026-03-10T00:00:00.000Z',
      },
    ]);
  });
});
