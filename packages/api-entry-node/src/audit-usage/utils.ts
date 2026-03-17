import type { JsonDocStorePort } from '@mbos/ports';
import { resolveWorkspaceScopedCollection } from '../workspace-tenant-collections.js';
import type { AuditEventRecord, UsageFactListItem, UsageFactRecord } from './types.js';

export const AUDIT_EVENTS_COLLECTION = 'project_audit_events';
export const USAGE_FACTS_COLLECTION = 'project_usage_facts';

export function auditEventsCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(AUDIT_EVENTS_COLLECTION, workspaceId);
}

export function usageFactsCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(USAGE_FACTS_COLLECTION, workspaceId);
}

export function isRequestsOnlyUsageResourceType(resourceType: string): boolean {
  return resourceType === 'agent';
}

export function parseIsoMillis(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

export function inRange(ts: string, startMs: number, endMs: number): boolean {
  const ms = parseIsoMillis(ts);
  return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
}

export function formatBucket(iso: string, groupBy: 'day' | 'hour' | 'minute'): string {
  if (groupBy === 'day') return iso.slice(0, 10);
  if (groupBy === 'minute') return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  return `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00`;
}

export function percentile95(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

export function percentile(values: number[], ratio: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[idx];
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function extractDecisionIdFromMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  return nonEmptyString((metadata as Record<string, unknown>).decision_id);
}

export function estimateFactCost(fact: UsageFactRecord): number {
  const raw = fact.metadata_json?.cost_usd ?? fact.metadata_json?.estimated_cost ?? 0;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function classifyProviderErrorClass(errorCode?: string): 'provider_retryable' | 'provider_non_retryable' | 'system_error' {
  if (!errorCode) return 'system_error';
  const normalized = errorCode.toUpperCase();
  if (!normalized.startsWith('UPSTREAM_')) return 'system_error';
  const statusRaw = normalized.replace('UPSTREAM_', '');
  const status = Number.parseInt(statusRaw, 10);
  if (!Number.isFinite(status)) return 'system_error';
  if (status === 429 || status >= 500) return 'provider_retryable';
  if (status >= 400) return 'provider_non_retryable';
  return 'system_error';
}

export function getFactProvider(fact: UsageFactRecord): string | undefined {
  return nonEmptyString(fact.metadata_json?.provider);
}

export function getFactModel(fact: UsageFactRecord): string | undefined {
  return nonEmptyString(fact.metadata_json?.resolved_model);
}

export function getFactErrorClass(fact: UsageFactRecord): 'provider_retryable' | 'provider_non_retryable' | 'system_error' | undefined {
  if (fact.result !== 'error') return undefined;
  return classifyProviderErrorClass(fact.error_code);
}

export function getFactFallbackHops(fact: UsageFactRecord): number {
  const fallbackHopsRaw = fact.metadata_json?.fallback_hops;
  return typeof fallbackHopsRaw === 'number' && Number.isFinite(fallbackHopsRaw)
    ? Math.max(0, Math.floor(fallbackHopsRaw))
    : 0;
}

export function isFactMissingPrice(fact: UsageFactRecord): boolean {
  return fact.metadata_json?.missing_price === true;
}

export async function listDocs<T extends { timestamp: string }>(
  docStore: JsonDocStorePort,
  collection: string,
): Promise<T[]> {
  return (await docStore.list<T>(collection)).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function mapFactToListItem(fact: UsageFactRecord): UsageFactListItem {
  return {
    id: fact.id,
    timestamp: fact.timestamp,
    workspace_id: fact.workspace_id,
    project_id: fact.project_id,
    resource_type: fact.resource_type,
    resource_id: fact.resource_id,
    end_user_id: fact.end_user_id,
    request_id: fact.request_id,
    requests: fact.requests,
    duration_ms: fact.duration_ms,
    bytes_in: fact.bytes_in,
    bytes_out: fact.bytes_out,
    tokens_in: fact.tokens_in,
    tokens_out: fact.tokens_out,
    tokens_total: fact.tokens_total,
    result: fact.result,
    error_code: fact.error_code,
    decision_id: fact.decision_id,
    request_details: {
      provider: getFactProvider(fact),
      resolved_model: getFactModel(fact),
      error_class: getFactErrorClass(fact),
      fallback_hops: getFactFallbackHops(fact),
      pricing_source: nonEmptyString(fact.metadata_json?.pricing_source) ?? null,
      estimated_cost: estimateFactCost(fact),
      missing_price: isFactMissingPrice(fact),
      attempts: Array.isArray(fact.metadata_json?.attempts)
        ? fact.metadata_json.attempts.filter(
            (item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item),
          )
        : undefined,
    },
    metadata_json: fact.metadata_json,
  };
}

export function appendDecisionId(record: AuditEventRecord): AuditEventRecord {
  return {
    ...record,
    decision_id: record.decision_id ?? extractDecisionIdFromMetadata(record.metadata_json),
  };
}
