import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureRegistryDir } from './storage';
import type { PublishSystemWorkspaceResult, SystemWorkspaceRecord } from './types';

function getProvisioningArtifactPath(id: string): string {
  const root =
    process.env.SYSTEM_WORKSPACE_PROVISIONING_PATH?.trim() || join(process.cwd(), 'artifacts/system-workspace-provisioning');
  return join(root, `${id}.json`);
}

export async function initializeWorkspaceResources(
  record: SystemWorkspaceRecord,
): Promise<PublishSystemWorkspaceResult> {
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
