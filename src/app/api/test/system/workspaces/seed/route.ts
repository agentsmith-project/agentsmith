import { NextResponse } from 'next/server';
import { writeRegistryFile } from '@/lib/system-admin/workspace-registry/storage';
import type { SystemWorkspaceRecord } from '@/lib/system-admin/workspace-registry';

type SeedState = 'empty' | 'with_workspace' | 'with_disabled_workspace' | 'with_failed_workspace';

function buildWorkspace(state: Exclude<SeedState, 'empty'>): SystemWorkspaceRecord {
  const base: SystemWorkspaceRecord = {
    id: 'ws_seeded',
    name: 'Seeded Workspace',
    workspace_admin: 'seed-admin@example.com',
    workspace_admin_user_id: 'kc-seed-admin',
    workspace_admin_name: 'Seed Admin',
    project_creators: [],
    idp: {
      kind: 'keycloak',
      url: 'https://seed.example.com',
      realm: 'seed',
      client_id: 'seed-client',
    },
    tenant: {
      workspace_id: 'ws_seeded',
      workspace_name: 'Seeded Workspace',
      substrate_label: 'primary',
      database_name: 'agentsmith_ws_ws_seeded',
      collection_prefix: 'ws_ws_seeded_',
      key_prefix: 'ws:ws_seeded:',
    },
    provisioning_status: 'ready',
    last_initialized_at: '2026-03-15T00:00:00.000Z',
    last_init_error: null,
    created_at: '2026-03-15T00:00:00.000Z',
    updated_at: '2026-03-15T00:00:00.000Z',
  };

  if (state === 'with_disabled_workspace') {
    return { ...base, provisioning_status: 'disabled' };
  }

  if (state === 'with_failed_workspace') {
    return {
      ...base,
      provisioning_status: 'failed',
      last_initialized_at: null,
      last_init_error: 'identity_provider_config_incomplete',
    };
  }

  return base;
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_USE_MSW !== 'true') {
    return NextResponse.json({ error_code: 'NOT_FOUND', error_message: 'not_found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { state?: SeedState } | null;
  const state = body?.state;
  if (state !== 'empty' && state !== 'with_workspace' && state !== 'with_disabled_workspace' && state !== 'with_failed_workspace') {
    return NextResponse.json({ error_code: 'VALIDATION_ERROR', error_message: 'invalid_seed_state' }, { status: 422 });
  }

  const records = state === 'empty' ? [] : [buildWorkspace(state)];
  await writeRegistryFile(records);
  return NextResponse.json({ ok: true, total: records.length });
}
