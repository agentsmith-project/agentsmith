import type { UsageFactRecord, UsageRecord } from '@/lib/api/types';

type UsageFilters = {
  startTime?: string | null;
  endTime?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  endUserId?: string | null;
  provider?: string | null;
  model?: string | null;
  result?: 'ok' | 'error' | null;
  errorClass?: 'provider_retryable' | 'provider_non_retryable' | 'system_error' | null;
};

declare global {
  // Shared in the MSW runtime so handler modules see the same in-memory facts.
  var __MBOS_MSW_RUNTIME_USAGE_FACTS__: UsageFactRecord[] | undefined;
}

function runtimeUsageFactsStore(): UsageFactRecord[] {
  if (!globalThis.__MBOS_MSW_RUNTIME_USAGE_FACTS__) {
    globalThis.__MBOS_MSW_RUNTIME_USAGE_FACTS__ = [];
  }
  return globalThis.__MBOS_MSW_RUNTIME_USAGE_FACTS__;
}

function toMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function toBucket(timestamp: string, groupBy: 'day' | 'hour'): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  if (groupBy === 'day') return `${year}-${month}-${day}`;
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:00`;
}

function withinRange(item: UsageFactRecord, filters: UsageFilters): boolean {
  const timestampMs = toMs(item.timestamp);
  const startMs = toMs(filters.startTime);
  const endMs = toMs(filters.endTime);
  if (timestampMs === null) return false;
  if (startMs !== null && timestampMs < startMs) return false;
  if (endMs !== null && timestampMs > endMs) return false;
  if (filters.resourceType && item.resource_type !== filters.resourceType) return false;
  if (filters.resourceId && item.resource_id !== filters.resourceId) return false;
  if (filters.endUserId && item.end_user_id !== filters.endUserId) return false;
  if (filters.provider && item.runtime?.provider !== filters.provider) return false;
  if (filters.model && item.runtime?.resolved_model !== filters.model) return false;
  if (filters.result && item.result !== filters.result) return false;
  if (filters.errorClass && item.runtime?.error_class !== filters.errorClass) return false;
  return true;
}

export function recordRuntimeUsageFact(fact: UsageFactRecord) {
  runtimeUsageFactsStore().unshift(fact);
}

export function listRuntimeUsageFacts(filters: UsageFilters = {}): UsageFactRecord[] {
  return runtimeUsageFactsStore()
    .filter((item) => withinRange(item, filters))
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function buildRuntimeUsageRecords(params: {
  groupBy: 'day' | 'hour';
  filters?: UsageFilters;
}): UsageRecord[] {
  const facts = listRuntimeUsageFacts(params.filters);
  const grouped = new Map<string, UsageRecord>();

  for (const fact of facts) {
    const timeBucket = toBucket(fact.timestamp, params.groupBy);
    const key = [
      timeBucket,
      fact.resource_type,
      fact.resource_id ?? '',
      fact.end_user_id ?? '',
    ].join('|');

    const current = grouped.get(key) ?? {
      id: `usage_runtime_${key}`,
      time_bucket: timeBucket,
      workspace_id: fact.workspace_id,
      project_id: fact.project_id,
      resource_type: fact.resource_type,
      resource_id: fact.resource_id,
      end_user_id: fact.end_user_id,
      requests: 0,
      duration_p95_ms: 0,
      bytes_in: 0,
      bytes_out: 0,
      tokens: 0,
    };

    current.requests += fact.requests ?? 0;
    current.duration_p95_ms = Math.max(current.duration_p95_ms ?? 0, fact.duration_ms ?? 0);
    current.bytes_in = (current.bytes_in ?? 0) + (fact.bytes_in ?? 0);
    current.bytes_out = (current.bytes_out ?? 0) + (fact.bytes_out ?? 0);
    current.tokens = (current.tokens ?? 0) + (fact.tokens_total ?? 0);
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const bucketDiff = b.time_bucket.localeCompare(a.time_bucket);
    if (bucketDiff !== 0) return bucketDiff;
    return (b.requests ?? 0) - (a.requests ?? 0);
  });
}
