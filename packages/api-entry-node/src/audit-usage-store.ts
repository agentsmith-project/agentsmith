import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { JsonDocStorePort } from '@mbos/ports';

export type AuditEventRecord = {
  id: string;
  timestamp: string;
  workspace_id: string;
  project_id: string;
  actor_type: 'user' | 'agent' | 'plugin';
  actor_id: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  end_user_id?: string;
  result: 'ok' | 'error';
  error_code?: string;
  error_message?: string;
  request_id: string;
  metadata_json: Record<string, unknown>;
};

export type UsageFactRecord = {
  id: string;
  timestamp: string;
  workspace_id: string;
  project_id: string;
  resource_type: string;
  resource_id?: string;
  end_user_id?: string;
  request_id?: string;
  requests: number;
  duration_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tokens_in?: number;
  tokens_out?: number;
  tokens_total?: number;
  result: 'ok' | 'error';
  error_code?: string;
  metadata_json?: Record<string, unknown>;
};

export type AuditQuery = {
  workspaceId: string;
  projectId: string;
  startTime: string;
  endTime: string;
  action?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  endUserId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  result?: string | null;
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;
};

export type UsageQuery = {
  workspaceId: string;
  projectId: string;
  startTime: string;
  endTime: string;
  resourceType?: string | null;
  resourceId?: string | null;
  endUserId?: string | null;
  groupBy: 'day' | 'hour';
  sortBy: 'time_bucket' | 'resource_type' | 'requests';
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;
};

export type UsageKpiQuery = {
  workspaceId: string;
  projectId: string;
  startTime: string;
  endTime: string;
  endUserId?: string | null;
};

export type UsageRecord = {
  id: string;
  time_bucket: string;
  workspace_id: string;
  project_id: string;
  resource_type: string;
  resource_id?: string;
  end_user_id?: string;
  requests: number;
  duration_p95_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tokens?: number;
};

export type UsageKpi = {
  requests_today: number;
  errors_today: number;
  tokens_today?: number;
  requests_yesterday?: number;
  errors_yesterday?: number;
  tokens_yesterday?: number;
};

export const AUDIT_EVENTS_COLLECTION = 'project_audit_events';
export const USAGE_FACTS_COLLECTION = 'project_usage_facts';

function parseIsoMillis(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function inRange(ts: string, startMs: number, endMs: number): boolean {
  const ms = parseIsoMillis(ts);
  return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
}

function formatBucket(iso: string, groupBy: 'day' | 'hour'): string {
  if (groupBy === 'day') return iso.slice(0, 10);
  return `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00`;
}

function percentile95(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function recordAuditEvent(
  docStore: JsonDocStorePort,
  input: Omit<AuditEventRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): Promise<AuditEventRecord> {
  const record: AuditEventRecord = {
    id: input.id ?? `aud_${randomUUID().replace(/-/g, '')}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    workspace_id: input.workspace_id,
    project_id: input.project_id,
    actor_type: input.actor_type,
    actor_id: input.actor_id,
    action: input.action,
    resource_type: nonEmptyString(input.resource_type),
    resource_id: nonEmptyString(input.resource_id),
    end_user_id: nonEmptyString(input.end_user_id),
    result: input.result,
    error_code: nonEmptyString(input.error_code),
    error_message: nonEmptyString(input.error_message),
    request_id: input.request_id,
    metadata_json: input.metadata_json ?? {},
  };
  await docStore.upsert(AUDIT_EVENTS_COLLECTION, record.id, record);
  return record;
}

export async function recordUsageFact(
  docStore: JsonDocStorePort,
  input: Omit<UsageFactRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): Promise<UsageFactRecord> {
  const record: UsageFactRecord = {
    id: input.id ?? `usg_${randomUUID().replace(/-/g, '')}`,
    timestamp: input.timestamp ?? new Date().toISOString(),
    workspace_id: input.workspace_id,
    project_id: input.project_id,
    resource_type: input.resource_type,
    resource_id: nonEmptyString(input.resource_id),
    end_user_id: nonEmptyString(input.end_user_id),
    request_id: nonEmptyString(input.request_id),
    requests: Number.isFinite(input.requests) && input.requests > 0 ? input.requests : 1,
    duration_ms: Number.isFinite(input.duration_ms) ? input.duration_ms : undefined,
    bytes_in: Number.isFinite(input.bytes_in) ? input.bytes_in : undefined,
    bytes_out: Number.isFinite(input.bytes_out) ? input.bytes_out : undefined,
    tokens_in: Number.isFinite(input.tokens_in) ? input.tokens_in : undefined,
    tokens_out: Number.isFinite(input.tokens_out) ? input.tokens_out : undefined,
    tokens_total: Number.isFinite(input.tokens_total) ? input.tokens_total : undefined,
    result: input.result,
    error_code: nonEmptyString(input.error_code),
    metadata_json: input.metadata_json && typeof input.metadata_json === 'object' ? input.metadata_json : undefined,
  };
  await docStore.upsert(USAGE_FACTS_COLLECTION, record.id, record);
  return record;
}

export async function listAuditEvents(
  docStore: JsonDocStorePort,
  query: AuditQuery,
): Promise<{ items: AuditEventRecord[]; total: number; page: number; page_size: number; has_more: boolean }> {
  const rows = (await docStore.list(AUDIT_EVENTS_COLLECTION, {
    workspace_id: query.workspaceId,
    project_id: query.projectId,
  })) as AuditEventRecord[];
  const startMs = parseIsoMillis(query.startTime);
  const endMs = parseIsoMillis(query.endTime);
  const filtered = rows.filter((row) => {
    if (!inRange(row.timestamp, startMs, endMs)) return false;
    if (query.action && row.action !== query.action) return false;
    if (query.actorType && row.actor_type !== query.actorType) return false;
    if (query.actorId && row.actor_id !== query.actorId) return false;
    if (query.endUserId && row.end_user_id !== query.endUserId) return false;
    if (query.resourceType && row.resource_type !== query.resourceType) return false;
    if (query.resourceId && row.resource_id !== query.resourceId) return false;
    if (query.result && row.result !== query.result) return false;
    return true;
  });
  filtered.sort((a, b) => {
    const diff = parseIsoMillis(a.timestamp) - parseIsoMillis(b.timestamp);
    return query.sortOrder === 'asc' ? diff : -diff;
  });
  const startIndex = (query.page - 1) * query.pageSize;
  const items = filtered.slice(startIndex, startIndex + query.pageSize);
  return {
    items,
    total: filtered.length,
    page: query.page,
    page_size: query.pageSize,
    has_more: startIndex + query.pageSize < filtered.length,
  };
}

export async function listUsageFacts(
  docStore: JsonDocStorePort,
  query: Pick<UsageQuery, 'workspaceId' | 'projectId' | 'startTime' | 'endTime' | 'resourceType' | 'resourceId' | 'endUserId'>,
): Promise<UsageFactRecord[]> {
  const rows = (await docStore.list(USAGE_FACTS_COLLECTION, {
    workspace_id: query.workspaceId,
    project_id: query.projectId,
  })) as UsageFactRecord[];
  const startMs = parseIsoMillis(query.startTime);
  const endMs = parseIsoMillis(query.endTime);
  return rows.filter((row) => {
    if (!inRange(row.timestamp, startMs, endMs)) return false;
    if (query.resourceType && row.resource_type !== query.resourceType) return false;
    if (query.resourceId && row.resource_id !== query.resourceId) return false;
    if (query.endUserId && row.end_user_id !== query.endUserId) return false;
    return true;
  });
}

export async function aggregateUsageRecords(
  docStore: JsonDocStorePort,
  query: UsageQuery,
): Promise<{ items: UsageRecord[]; total: number; page: number; page_size: number; has_more: boolean }> {
  const facts = await listUsageFacts(docStore, query);
  type BucketAgg = {
    idKey: string;
    time_bucket: string;
    workspace_id: string;
    project_id: string;
    resource_type: string;
    resource_id?: string;
    end_user_id?: string;
    requests: number;
    bytes_in: number;
    bytes_out: number;
    tokens: number;
    durations: number[];
  };
  const buckets = new Map<string, BucketAgg>();
  for (const fact of facts) {
    const timeBucket = formatBucket(fact.timestamp, query.groupBy);
    const bucketKey = [
      timeBucket,
      fact.resource_type,
      fact.resource_id ?? '',
      query.endUserId ? fact.end_user_id ?? '' : '',
    ].join('|');
    const existing = buckets.get(bucketKey) ?? {
      idKey: bucketKey,
      time_bucket: timeBucket,
      workspace_id: fact.workspace_id,
      project_id: fact.project_id,
      resource_type: fact.resource_type,
      resource_id: fact.resource_id,
      end_user_id: query.endUserId ? fact.end_user_id : undefined,
      requests: 0,
      bytes_in: 0,
      bytes_out: 0,
      tokens: 0,
      durations: [],
    };
    existing.requests += fact.requests ?? 1;
    existing.bytes_in += fact.bytes_in ?? 0;
    existing.bytes_out += fact.bytes_out ?? 0;
    existing.tokens += fact.tokens_total ?? 0;
    if (typeof fact.duration_ms === 'number') existing.durations.push(fact.duration_ms);
    buckets.set(bucketKey, existing);
  }

  const rows: UsageRecord[] = Array.from(buckets.values()).map((item) => ({
    id: `usage_${Buffer.from(item.idKey).toString('base64url')}`,
    time_bucket: item.time_bucket,
    workspace_id: item.workspace_id,
    project_id: item.project_id,
    resource_type: item.resource_type,
    resource_id: item.resource_id,
    end_user_id: item.end_user_id,
    requests: item.requests,
    duration_p95_ms: percentile95(item.durations),
    bytes_in: item.bytes_in || undefined,
    bytes_out: item.bytes_out || undefined,
    tokens: item.tokens || undefined,
  }));

  rows.sort((a, b) => {
    let cmp = 0;
    if (query.sortBy === 'requests') cmp = a.requests - b.requests;
    else if (query.sortBy === 'resource_type') cmp = a.resource_type.localeCompare(b.resource_type);
    else cmp = a.time_bucket.localeCompare(b.time_bucket);
    if (cmp === 0) cmp = a.id.localeCompare(b.id);
    return query.sortOrder === 'asc' ? cmp : -cmp;
  });

  const startIndex = (query.page - 1) * query.pageSize;
  const items = rows.slice(startIndex, startIndex + query.pageSize);
  return {
    items,
    total: rows.length,
    page: query.page,
    page_size: query.pageSize,
    has_more: startIndex + query.pageSize < rows.length,
  };
}

export async function getUsageKpi(
  docStore: JsonDocStorePort,
  query: UsageKpiQuery,
): Promise<UsageKpi> {
  const facts = await listUsageFacts(docStore, {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    startTime: query.startTime,
    endTime: query.endTime,
    endUserId: query.endUserId,
  });
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  let requestsToday = 0;
  let errorsToday = 0;
  let tokensToday = 0;
  let requestsYesterday = 0;
  let errorsYesterday = 0;
  let tokensYesterday = 0;
  for (const fact of facts) {
    const ms = parseIsoMillis(fact.timestamp);
    if (!Number.isFinite(ms)) continue;
    const reqs = fact.requests ?? 1;
    const tokens = fact.tokens_total ?? 0;
    if (ms >= todayStart.getTime() && ms < tomorrowStart.getTime()) {
      requestsToday += reqs;
      if (fact.result === 'error') errorsToday += reqs;
      tokensToday += tokens;
      continue;
    }
    if (ms >= yesterdayStart.getTime() && ms < todayStart.getTime()) {
      requestsYesterday += reqs;
      if (fact.result === 'error') errorsYesterday += reqs;
      tokensYesterday += tokens;
    }
  }
  return {
    requests_today: requestsToday,
    errors_today: errorsToday,
    tokens_today: tokensToday || undefined,
    requests_yesterday: requestsYesterday,
    errors_yesterday: errorsYesterday,
    tokens_yesterday: tokensYesterday || undefined,
  };
}
