import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeWorkspaceFoundations } from '../../../../packages/api-entry-node/src/workspace-foundation-initializer';
import type { WorkspaceFoundationInitializationResult } from '@mbos/contracts';
import { ensureRegistryDir } from './storage';
import type { PublishSystemWorkspaceResult, SystemWorkspaceRecord } from './types';

function getProvisioningArtifactPath(id: string): string {
  const root =
    process.env.SYSTEM_WORKSPACE_PROVISIONING_PATH?.trim() || join(process.cwd(), 'artifacts/system-workspace-provisioning');
  return join(root, `${id}.json`);
}

function summarizeInitializationError(result: WorkspaceFoundationInitializationResult): string | null {
  const message = result.init_error?.trim();
  if (!message) return null;
  if (!result.failed_domain) return message;
  return `${result.failed_domain}: ${message}`;
}

type ProvisioningAttemptRecord = {
  attempt_number: number;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  status: PublishSystemWorkspaceResult['status'];
  initialized_at: string | null;
  init_error: string | null;
  failed_domain: string | null;
};

type ExistingProvisioningArtifact = {
  attempt_count?: unknown;
  attempts?: unknown;
};

async function readExistingProvisioningArtifact(pathname: string): Promise<{
  attemptCount: number;
  attempts: ProvisioningAttemptRecord[];
}> {
  try {
    const raw = await readFile(pathname, 'utf-8');
    const parsed = JSON.parse(raw) as ExistingProvisioningArtifact;
    const attemptCount = typeof parsed.attempt_count === 'number' && Number.isFinite(parsed.attempt_count)
      ? parsed.attempt_count
      : 0;
    const attempts = Array.isArray(parsed.attempts)
      ? parsed.attempts.filter((item): item is ProvisioningAttemptRecord => (
        typeof item === 'object' &&
        item !== null &&
        typeof item['attempt_number'] === 'number' &&
        typeof item['started_at'] === 'string' &&
        typeof item['completed_at'] === 'string' &&
        typeof item['duration_ms'] === 'number' &&
        typeof item['status'] === 'string'
      ))
      : [];
    return { attemptCount, attempts };
  } catch {
    return { attemptCount: 0, attempts: [] };
  }
}

async function writeProvisioningArtifact(args: {
  provisioningArtifact: string;
  record: SystemWorkspaceRecord;
  startedAt: string;
  generatedAt: string;
  result: PublishSystemWorkspaceResult;
  foundationResult: WorkspaceFoundationInitializationResult | null;
}): Promise<void> {
  const existing = await readExistingProvisioningArtifact(args.provisioningArtifact);
  const nextAttempt: ProvisioningAttemptRecord = {
    attempt_number: existing.attemptCount + 1,
    started_at: args.startedAt,
    completed_at: args.generatedAt,
    duration_ms: Math.max(0, new Date(args.generatedAt).getTime() - new Date(args.startedAt).getTime()),
    status: args.result.status,
    initialized_at: args.result.initialized_at,
    init_error: args.result.init_error,
    failed_domain: args.foundationResult?.failed_domain ?? null,
  };
  const attempts = [...existing.attempts, nextAttempt].slice(-10);
  await ensureRegistryDir(args.provisioningArtifact);
  await writeFile(
    args.provisioningArtifact,
    `${JSON.stringify(
      {
        workspace_id: args.record.id,
        workspace_name: args.record.name,
        workspace_admin: args.record.workspace_admin,
        project_creators: args.record.project_creators,
        tenant: args.record.tenant,
        idp: {
          kind: args.record.idp.kind,
          url: args.record.idp.url,
          realm: args.record.idp.realm,
          client_id: args.record.idp.client_id,
        },
        provisioning_result: args.result,
        foundation_result: args.foundationResult,
        attempt_count: nextAttempt.attempt_number,
        latest_attempt: nextAttempt,
        attempts,
        generated_at: args.generatedAt,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );
}

export async function initializeWorkspaceResources(
  record: SystemWorkspaceRecord,
): Promise<PublishSystemWorkspaceResult> {
  const provisioningArtifact = getProvisioningArtifactPath(record.id);
  const startedAt = new Date().toISOString();
  let result: PublishSystemWorkspaceResult;
  let foundationResult: WorkspaceFoundationInitializationResult | null = null;

  if (!record.idp.url.trim() || !record.idp.realm.trim() || !record.idp.client_id.trim()) {
    result = {
      status: 'failed',
      initialized_at: null,
      init_error: 'identity_provider_config_incomplete',
    };
    await writeProvisioningArtifact({
      provisioningArtifact,
      record,
      startedAt,
      generatedAt: new Date().toISOString(),
      result,
      foundationResult,
    });
    return result;
  }

  if (!record.tenant.database_name.trim() || !record.tenant.collection_prefix.trim() || !record.tenant.key_prefix.trim()) {
    result = {
      status: 'failed',
      initialized_at: null,
      init_error: 'tenant_configuration_incomplete',
    };
    await writeProvisioningArtifact({
      provisioningArtifact,
      record,
      startedAt,
      generatedAt: new Date().toISOString(),
      result,
      foundationResult,
    });
    return result;
  }

  foundationResult = await initializeWorkspaceFoundations({
    workspace_id: record.id,
    workspace_name: record.name,
    workspace_admin: record.workspace_admin,
    project_creators: record.project_creators,
    tenant: {
      substrate_label: record.tenant.substrate_label,
      database_name: record.tenant.database_name,
      collection_prefix: record.tenant.collection_prefix,
      key_prefix: record.tenant.key_prefix,
    },
    idp: {
      kind: record.idp.kind,
      url: record.idp.url,
      realm: record.idp.realm,
      client_id: record.idp.client_id,
    },
  });

  result = {
    status: foundationResult.status,
    initialized_at: foundationResult.initialized_at,
    init_error: summarizeInitializationError(foundationResult),
  };

  await writeProvisioningArtifact({
    provisioningArtifact,
    record,
    startedAt,
    generatedAt: new Date().toISOString(),
    result,
    foundationResult,
  });

  return result;
}
