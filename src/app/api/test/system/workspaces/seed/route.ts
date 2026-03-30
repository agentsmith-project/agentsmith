import { NextResponse } from 'next/server';
import {
  deletePersistedSystemWorkspace,
  listPersistedSystemWorkspaces,
  upsertPersistedSystemWorkspace,
} from '@/lib/system-admin/workspace-registry/persistence';
import type { SystemWorkspaceRecord } from '@/lib/system-admin/workspace-registry';

type SeedRequestBody = {
  records?: unknown;
};

function isIdentitySnapshotArray(value: unknown): value is SystemWorkspaceRecord['project_creators'] {
  return Array.isArray(value) && value.every((item) => (
    typeof item === 'object' &&
    item !== null &&
    typeof item['user_id'] === 'string' &&
    typeof item['email'] === 'string' &&
    (item['name'] === null || item['name'] === undefined || typeof item['name'] === 'string')
  ));
}

function isSystemWorkspaceRecord(value: unknown): value is SystemWorkspaceRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const idp = record['idp'];
  const tenant = record['tenant'];
  if (typeof idp !== 'object' || idp === null || typeof tenant !== 'object' || tenant === null) {
    return false;
  }
  const idpRecord = idp as Record<string, unknown>;
  const tenantRecord = tenant as Record<string, unknown>;
  return typeof record['id'] === 'string'
    && typeof record['name'] === 'string'
    && typeof record['workspace_admin'] === 'string'
    && (record['workspace_admin_user_id'] === undefined || typeof record['workspace_admin_user_id'] === 'string')
    && (record['workspace_admin_name'] === undefined || record['workspace_admin_name'] === null || typeof record['workspace_admin_name'] === 'string')
    && (record['workspace_admin_binding_required'] === undefined || typeof record['workspace_admin_binding_required'] === 'boolean')
    && isIdentitySnapshotArray(record['project_creators'])
    && typeof idpRecord['kind'] === 'string'
    && typeof idpRecord['url'] === 'string'
    && typeof idpRecord['realm'] === 'string'
    && typeof idpRecord['client_id'] === 'string'
    && typeof tenantRecord['workspace_id'] === 'string'
    && typeof tenantRecord['workspace_name'] === 'string'
    && typeof tenantRecord['substrate_label'] === 'string'
    && typeof tenantRecord['database_name'] === 'string'
    && typeof tenantRecord['collection_prefix'] === 'string'
    && typeof tenantRecord['key_prefix'] === 'string'
    && typeof record['provisioning_status'] === 'string'
    && (record['last_initialized_at'] === null || typeof record['last_initialized_at'] === 'string')
    && (record['last_init_error'] === null || typeof record['last_init_error'] === 'string')
    && typeof record['created_at'] === 'string'
    && typeof record['updated_at'] === 'string';
}


export async function GET() {
  if (process.env.NEXT_PUBLIC_USE_MSW !== 'true' && process.env.AGENTSMITH_ENABLE_TEST_ROUTES !== 'true') {
    return NextResponse.json({ error_code: 'NOT_FOUND', error_message: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ items: await listPersistedSystemWorkspaces() });
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_USE_MSW !== 'true' && process.env.AGENTSMITH_ENABLE_TEST_ROUTES !== 'true') {
    return NextResponse.json({ error_code: 'NOT_FOUND', error_message: 'not_found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as SeedRequestBody | null;
  const records = body?.records;
  if (!Array.isArray(records) || !records.every((item) => isSystemWorkspaceRecord(item))) {
    return NextResponse.json({ error_code: 'VALIDATION_ERROR', error_message: 'invalid_workspace_records' }, { status: 422 });
  }

  const existing = await listPersistedSystemWorkspaces();
  await Promise.all(existing.map((record) => deletePersistedSystemWorkspace(record.id)));
  await Promise.all(records.map((record) => upsertPersistedSystemWorkspace(record)));
  return NextResponse.json({ ok: true, total: records.length });
}
