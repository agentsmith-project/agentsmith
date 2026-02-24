import { randomUUID } from 'node:crypto';
import type { NodeApiDeps } from './node-api-deps.js';
import { recordAuditEvent, recordUsageFact } from './audit-usage-store.js';

type AuditActor =
  | { type: 'user' | 'agent' | 'plugin'; id: string }
  | { type: 'user' | 'agent' | 'plugin'; id: undefined | null };

function fallbackRequestId(requestId?: string | null): string {
  return requestId?.trim() || `req_${randomUUID().replace(/-/g, '')}`;
}

function fallbackActorId(actor: AuditActor): string {
  return actor.id?.trim() || 'unknown';
}

export async function writeProjectAuditEvent(
  deps: NodeApiDeps,
  input: {
    workspaceId: string;
    projectId: string;
    actor: AuditActor;
    action: string;
    result?: 'ok' | 'error';
    requestId?: string | null;
    resourceType?: string;
    resourceId?: string;
    endUserId?: string;
    errorCode?: string;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
    timestamp?: string;
  },
): Promise<void> {
  await recordAuditEvent(deps.docStore, {
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    actor_type: input.actor.type,
    actor_id: fallbackActorId(input.actor),
    action: input.action,
    result: input.result ?? 'ok',
    request_id: fallbackRequestId(input.requestId),
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    end_user_id: input.endUserId,
    error_code: input.errorCode,
    error_message: input.errorMessage,
    metadata_json: input.metadata ?? {},
    timestamp: input.timestamp,
  });
}

export async function writeProjectUsageFact(
  deps: NodeApiDeps,
  input: {
    workspaceId: string;
    projectId: string;
    resourceType: string;
    resourceId?: string;
    endUserId?: string;
    requestId?: string | null;
    requests?: number;
    durationMs?: number;
    bytesIn?: number;
    bytesOut?: number;
    tokensIn?: number;
    tokensOut?: number;
    tokensTotal?: number;
    result?: 'ok' | 'error';
    errorCode?: string;
    metadata?: Record<string, unknown>;
    timestamp?: string;
  },
): Promise<void> {
  await recordUsageFact(deps.docStore, {
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    end_user_id: input.endUserId,
    request_id: fallbackRequestId(input.requestId),
    requests: input.requests ?? 1,
    duration_ms: input.durationMs,
    bytes_in: input.bytesIn,
    bytes_out: input.bytesOut,
    tokens_in: input.tokensIn,
    tokens_out: input.tokensOut,
    tokens_total: input.tokensTotal,
    result: input.result ?? 'ok',
    error_code: input.errorCode,
    metadata_json: input.metadata,
    timestamp: input.timestamp,
  });
}
