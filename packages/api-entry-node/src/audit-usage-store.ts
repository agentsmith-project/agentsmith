import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { JsonDocStorePort } from '@mbos/ports';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';

export type AuditEventRecord = {
  id: string;
  timestamp: string;
  workspace_id: string;
  project_id: string;
  actor_type: 'user' | 'agent' | 'plugin' | string;
  actor_id: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  end_user_id?: string;
  result: 'ok' | 'error';
  error_code?: string;
  error_message?: string;
  request_id: string;
  decision_id?: string;
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
  decision_id?: string;
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
  provider?: string | null;
  model?: string | null;
  result?: 'ok' | 'error' | null;
  errorClass?: 'provider_retryable' | 'provider_non_retryable' | 'system_error' | null;
  groupBy: 'day' | 'hour' | 'minute';
  sortBy: 'time_bucket' | 'resource_type' | 'requests';
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;
};

export type UsageFactsQuery = Pick<
  UsageQuery,
  'workspaceId' | 'projectId' | 'startTime' | 'endTime' | 'resourceType' | 'resourceId' | 'endUserId' | 'provider' | 'model' | 'result' | 'errorClass'
> & {
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;
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

export type UsageFactListItem = {
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
  decision_id?: string;
  request_details?: {
    provider?: string;
    resolved_model?: string;
    error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
    fallback_hops?: number;
    pricing_source?: string | null;
    estimated_cost?: number | null;
    missing_price?: boolean;
    attempts?: Array<Record<string, unknown>>;
  };
  metadata_json?: Record<string, unknown>;
};

export type UsageTimeseriesPoint = {
  time_bucket: string;
  requests: number;
  errors: number;
  tokens?: number;
  estimated_cost?: number;
  duration_p95_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
};

export type UsageResourceBreakdownItem = {
  resource_id: string;
  resource_name: string;
  resource_type: 'endpoint' | 'source_library' | 'agent';
  requests: number;
  tokens?: number;
  estimated_cost: number;
  percentage_of_total: number;
};

export type UsageTimeseriesResponse = {
  data_points: UsageTimeseriesPoint[];
  resource_breakdown?: UsageResourceBreakdownItem[];
  time_range: {
    start: string;
    end: string;
    granularity?: 'hour' | 'day' | 'week' | 'month';
  };
  total_cost?: number;
};

export type LimitRuleSnapshot = {
  kind: 'rate_limit' | 'spending_limit';
  window: 'minute' | '5h' | 'day' | 'current';
  metric: 'requests' | 'usd';
  policy_key: string;
  used: number;
  max: number;
  remaining: number;
  usage_pct: number;
  reset_at: string;
};

export type EndpointLimitSummary = {
  endpoint_id: string;
  endpoint_name: string;
  limits: LimitRuleSnapshot[];
};

export type LimitsOverview = {
  endpoints?: EndpointLimitSummary[];
};

export type UsageRecordsSummaryResponse = {
  total_requests: number;
  total_errors: number;
  error_rate: number;
  reroute_hops_histogram: Record<string, number>;
  error_class_counts: Record<'provider_retryable' | 'provider_non_retryable' | 'system_error', number>;
  avg_estimated_cost: number;
  p95_estimated_cost: number;
  records_health: {
    rerouted_requests: number;
    terminal_error_requests: number;
    missing_price_records: number;
    provider_count: number;
    model_count: number;
  };
  request_trend: Array<{
    time_bucket: string;
    requests: number;
    errors: number;
    rerouted_requests: number;
    avg_estimated_cost: number;
    duration_p95_ms?: number;
  }>;
  latency_distribution_ms: {
    p50?: number;
    p95?: number;
    p99?: number;
  };
  cost_distribution_usd: {
    p50?: number;
    p95?: number;
    p99?: number;
  };
  issue_signals: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high';
    kind: 'fallback_spike' | 'error_rate_spike' | 'missing_price' | 'latency_spike';
    title: string;
    message: string;
  }>;
  provider_breakdown: Array<{
    provider: string;
    requests: number;
    errors: number;
    error_rate: number;
    reroute_rate: number;
    avg_estimated_cost: number;
    p95_estimated_cost: number;
    missing_price_records: number;
  }>;
  model_breakdown: Array<{
    provider: string;
    model: string;
    requests: number;
    errors: number;
    error_rate: number;
    reroute_rate: number;
    avg_estimated_cost: number;
    p95_estimated_cost: number;
    missing_price_records: number;
  }>;
  time_range: {
    start: string;
    end: string;
  };
};

export type UsageOperationsSummaryResponse = {
  top_providers: Array<{
    provider: string;
    requests: number;
    errors: number;
    estimated_cost: number;
  }>;
  top_models: Array<{
    provider: string;
    model: string;
    requests: number;
    errors: number;
    estimated_cost: number;
  }>;
  top_end_users: Array<{
    end_user_id: string;
    requests: number;
    errors: number;
    estimated_cost: number;
  }>;
  anomaly_peaks: Array<{
    id: string;
    time_bucket: string;
    metric: 'requests' | 'errors' | 'cost';
    value: number;
    baseline: number;
    severity: 'medium' | 'high';
  }>;
  recent_requests: Array<{
    id: string;
    timestamp: string;
    request_id?: string;
    provider?: string;
    model?: string;
    end_user_id?: string;
    result: 'ok' | 'error';
    error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
    estimated_cost?: number;
  }>;
  webhook_destinations: Array<{
    host: string;
    path?: string;
    protocol?: string;
    deliveries: number;
    successes: number;
    failures: number;
    success_rate: number;
    avg_latency_ms?: number;
    p95_latency_ms?: number;
    timeout_failures: number;
    network_failures: number;
    auth_failures: number;
    client_failures: number;
    server_failures: number;
    last_status: 'success' | 'failed';
    last_delivery_at: string;
  }>;
};

export const AUDIT_EVENTS_COLLECTION = 'project_audit_events';
export const USAGE_FACTS_COLLECTION = 'project_usage_facts';

function auditEventsCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(AUDIT_EVENTS_COLLECTION, workspaceId);
}

function usageFactsCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(USAGE_FACTS_COLLECTION, workspaceId);
}

function isRequestsOnlyUsageResourceType(resourceType: string): boolean {
  return resourceType === 'agent';
}

function parseIsoMillis(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function inRange(ts: string, startMs: number, endMs: number): boolean {
  const ms = parseIsoMillis(ts);
  return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
}

function formatBucket(iso: string, groupBy: 'day' | 'hour' | 'minute'): string {
  if (groupBy === 'day') return iso.slice(0, 10);
  if (groupBy === 'minute') return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  return `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00`;
}

function percentile95(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

function percentile(values: number[], ratio: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[idx];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function extractDecisionIdFromMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  return nonEmptyString((metadata as Record<string, unknown>).decision_id);
}

function estimateFactCost(fact: UsageFactRecord): number {
  const raw = fact.metadata_json?.cost_usd ?? fact.metadata_json?.estimated_cost ?? 0;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function classifyProviderErrorClass(errorCode?: string): 'provider_retryable' | 'provider_non_retryable' | 'system_error' {
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

function getFactProvider(fact: UsageFactRecord): string | undefined {
  return nonEmptyString(fact.metadata_json?.provider);
}

function getFactModel(fact: UsageFactRecord): string | undefined {
  return nonEmptyString(fact.metadata_json?.resolved_model);
}

function getFactErrorClass(fact: UsageFactRecord): 'provider_retryable' | 'provider_non_retryable' | 'system_error' | undefined {
  if (fact.result !== 'error') return undefined;
  return classifyProviderErrorClass(fact.error_code);
}

function getFactFallbackHops(fact: UsageFactRecord): number {
  const fallbackHopsRaw = fact.metadata_json?.fallback_hops;
  return typeof fallbackHopsRaw === 'number' && Number.isFinite(fallbackHopsRaw)
    ? Math.max(0, Math.floor(fallbackHopsRaw))
    : 0;
}

function isFactMissingPrice(fact: UsageFactRecord): boolean {
  return fact.metadata_json?.missing_price === true;
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
    decision_id: extractDecisionIdFromMetadata(input.metadata_json),
    metadata_json: input.metadata_json ?? {},
  };
  await docStore.upsert(auditEventsCollection(record.workspace_id), record.id, record);
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
    decision_id: extractDecisionIdFromMetadata(input.metadata_json),
    metadata_json: input.metadata_json && typeof input.metadata_json === 'object' ? input.metadata_json : undefined,
  };
  await docStore.upsert(usageFactsCollection(record.workspace_id), record.id, record);
  return record;
}

export async function listAuditEvents(
  docStore: JsonDocStorePort,
  query: AuditQuery,
): Promise<{ items: AuditEventRecord[]; total: number; page: number; page_size: number; has_more: boolean }> {
  const rows = (await docStore.list(auditEventsCollection(query.workspaceId), {
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
  }).map((row) => ({
    ...row,
    decision_id: row.decision_id ?? extractDecisionIdFromMetadata(row.metadata_json),
  }));
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
  query: Pick<UsageQuery, 'workspaceId' | 'projectId' | 'startTime' | 'endTime' | 'resourceType' | 'resourceId' | 'endUserId' | 'provider' | 'model' | 'result' | 'errorClass'>,
): Promise<UsageFactRecord[]> {
  const rows = (await docStore.list(usageFactsCollection(query.workspaceId), {
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
    if (query.provider && getFactProvider(row) !== query.provider) return false;
    if (query.model && getFactModel(row) !== query.model) return false;
    if (query.result && row.result !== query.result) return false;
    if (query.errorClass && getFactErrorClass(row) !== query.errorClass) return false;
    return true;
  }).map((row) => ({
    ...row,
    decision_id: row.decision_id ?? extractDecisionIdFromMetadata(row.metadata_json),
  }));
}

function mapFactToListItem(fact: UsageFactRecord): UsageFactListItem {
  const metadata = fact.metadata_json && typeof fact.metadata_json === 'object' ? fact.metadata_json : undefined;
  const requestAttempts = Array.isArray(metadata?.attempt_trace)
    ? metadata.attempt_trace.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>
    : undefined;
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
    decision_id: fact.decision_id ?? extractDecisionIdFromMetadata(metadata),
    request_details: {
      provider: nonEmptyString(metadata?.provider),
      resolved_model: nonEmptyString(metadata?.resolved_model),
      error_class: fact.result === 'error' ? classifyProviderErrorClass(fact.error_code) : undefined,
      fallback_hops: typeof metadata?.fallback_hops === 'number' ? metadata.fallback_hops : undefined,
      pricing_source: typeof metadata?.pricing_source === 'string' ? metadata.pricing_source : null,
      estimated_cost: typeof metadata?.estimated_cost === 'number' ? metadata.estimated_cost : null,
      missing_price: metadata?.missing_price === true,
      attempts: requestAttempts,
    },
    metadata_json: metadata,
  };
}

export async function listUsageFactRecords(
  docStore: JsonDocStorePort,
  query: UsageFactsQuery,
): Promise<{ items: UsageFactListItem[]; total: number; page: number; page_size: number; has_more: boolean }> {
  const facts = await listUsageFacts(docStore, query);
  facts.sort((a, b) => {
    const diff = parseIsoMillis(a.timestamp) - parseIsoMillis(b.timestamp);
    if (diff !== 0) return query.sortOrder === 'asc' ? diff : -diff;
    return query.sortOrder === 'asc' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
  });
  const startIndex = (query.page - 1) * query.pageSize;
  const items = facts.slice(startIndex, startIndex + query.pageSize).map(mapFactToListItem);
  return {
    items,
    total: facts.length,
    page: query.page,
    page_size: query.pageSize,
    has_more: startIndex + query.pageSize < facts.length,
  };
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
    if (!isRequestsOnlyUsageResourceType(fact.resource_type)) {
      existing.tokens += fact.tokens_total ?? 0;
    }
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
    tokens: isRequestsOnlyUsageResourceType(item.resource_type) ? undefined : (item.tokens || undefined),
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

export async function getUsageTimeseries(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    startTime: string;
    endTime: string;
    granularity?: 'hour' | 'day' | 'week' | 'month';
    metric?: 'tokens' | 'requests' | 'cost' | 'bytes';
    resourceType?: 'endpoint' | 'source_library' | 'agent' | null;
  },
): Promise<UsageTimeseriesResponse> {
  const normalizedGranularity = query.granularity === 'hour' ? 'hour' : 'day';
  const facts = await listUsageFacts(docStore, {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    startTime: query.startTime,
    endTime: query.endTime,
    resourceType: query.resourceType ?? null,
  });

  const buckets = new Map<string, {
    requests: number;
    errors: number;
    tokens: number;
    cost: number;
    bytesIn: number;
    bytesOut: number;
    durations: number[];
  }>();

  const breakdown = new Map<string, UsageResourceBreakdownItem>();

  for (const fact of facts) {
    const timeBucket = formatBucket(fact.timestamp, normalizedGranularity);
    const bucket = buckets.get(timeBucket) ?? {
      requests: 0,
      errors: 0,
      tokens: 0,
      cost: 0,
      bytesIn: 0,
      bytesOut: 0,
      durations: [],
    };
    const reqs = fact.requests ?? 1;
    const tokens = isRequestsOnlyUsageResourceType(fact.resource_type) ? 0 : (fact.tokens_total ?? 0);
    const cost = estimateFactCost(fact);
    bucket.requests += reqs;
    if (fact.result === 'error') bucket.errors += reqs;
    bucket.tokens += tokens;
    bucket.cost += cost;
    bucket.bytesIn += fact.bytes_in ?? 0;
    bucket.bytesOut += fact.bytes_out ?? 0;
    if (typeof fact.duration_ms === 'number') bucket.durations.push(fact.duration_ms);
    buckets.set(timeBucket, bucket);

    if (
      fact.resource_type === 'endpoint'
      || fact.resource_type === 'source_library'
      || fact.resource_type === 'agent'
    ) {
      const key = `${fact.resource_type}:${fact.resource_id ?? 'unknown'}`;
      const existing = breakdown.get(key) ?? {
        resource_id: fact.resource_id ?? 'unknown',
        resource_name: fact.resource_id ?? 'unknown',
        resource_type: fact.resource_type,
        requests: 0,
        tokens: fact.resource_type === 'agent' ? undefined : 0,
        estimated_cost: 0,
        percentage_of_total: 0,
      };
      existing.requests += reqs;
      if (existing.tokens !== undefined) {
        existing.tokens += tokens;
      }
      existing.estimated_cost += cost;
      breakdown.set(key, existing);
    }
  }

  const dataPoints: UsageTimeseriesPoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timeBucket, agg]) => ({
      time_bucket: timeBucket,
      requests: agg.requests,
      errors: agg.errors,
      tokens: agg.tokens || undefined,
      estimated_cost: agg.cost || undefined,
      duration_p95_ms: percentile95(agg.durations),
      bytes_in: agg.bytesIn || undefined,
      bytes_out: agg.bytesOut || undefined,
    }));

  const resourceBreakdown = Array.from(breakdown.values())
    .sort((a, b) => b.requests - a.requests);
  const totalCost = resourceBreakdown.reduce((sum, item) => sum + item.estimated_cost, 0);
  for (const item of resourceBreakdown) {
    item.percentage_of_total = totalCost > 0 ? Number(((item.estimated_cost / totalCost) * 100).toFixed(2)) : 0;
  }

  return {
    data_points: dataPoints,
    resource_breakdown: resourceBreakdown,
    time_range: {
      start: query.startTime,
      end: query.endTime,
      granularity: query.granularity ?? 'day',
    },
    total_cost: totalCost || undefined,
  };
}

export async function getLimitsSummary(
  docStore: JsonDocStorePort,
  query: { workspaceId: string; projectId: string },
): Promise<LimitsOverview> {
  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const minuteStart = new Date(nowMs - 60_000).toISOString();
  const fiveHoursStart = new Date(nowMs - (5 * 60 * 60 * 1000)).toISOString();
  const minuteStartMs = parseIsoMillis(minuteStart);
  const fiveHoursStartMs = parseIsoMillis(fiveHoursStart);
  const todayStartMs = parseIsoMillis(todayStart);
  const queryStart = todayStart < fiveHoursStart ? todayStart : fiveHoursStart;
  const dayResetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  const minuteResetAt = new Date(Math.floor(nowMs / 60_000) * 60_000 + 60_000).toISOString();
  const fiveHoursResetAt = new Date(Math.floor(nowMs / (5 * 60 * 60 * 1000)) * (5 * 60 * 60 * 1000) + (5 * 60 * 60 * 1000)).toISOString();
  const currentResetAt = nowIso;

  const facts = await listUsageFacts(docStore, {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    startTime: queryStart,
    endTime: nowIso,
  });

  const byEndpoint = new Map<string, {
    endpointId: string;
    requestsMinute: number;
    requests5h: number;
    requestsDay: number;
    usdMinute: number;
    usd5h: number;
    usdDay: number;
    usdCurrent: number;
  }>();
  for (const fact of facts) {
    if (fact.resource_type !== 'endpoint') {
      continue;
    }
    const endpointId = fact.resource_id ?? 'unknown';
    const existing = byEndpoint.get(endpointId) ?? {
      endpointId,
      requestsMinute: 0,
      requests5h: 0,
      requestsDay: 0,
      usdMinute: 0,
      usd5h: 0,
      usdDay: 0,
      usdCurrent: 0,
    };
    const timestampMs = parseIsoMillis(fact.timestamp);
    const requests = fact.requests ?? 1;
    const usd = estimateFactCost(fact);
    if (Number.isFinite(timestampMs) && timestampMs >= minuteStartMs) {
      existing.requestsMinute += requests;
      existing.usdMinute += usd;
    }
    if (Number.isFinite(timestampMs) && timestampMs >= fiveHoursStartMs) {
      existing.requests5h += requests;
      existing.usd5h += usd;
    }
    if (Number.isFinite(timestampMs) && timestampMs >= todayStartMs) {
      existing.requestsDay += requests;
      existing.usdDay += usd;
    }
    existing.usdCurrent += usd;
    byEndpoint.set(endpointId, existing);
  }

  const rateLimitMax = {
    minute: 120,
    fiveHours: 6_000,
    day: 20_000,
  };
  const spendingLimitMax = {
    minute: 5,
    fiveHours: 100,
    day: 400,
    current: 1_000,
  };

  const toRule = (args: {
    kind: LimitRuleSnapshot['kind'];
    window: LimitRuleSnapshot['window'];
    metric: LimitRuleSnapshot['metric'];
    policyKey: string;
    used: number;
    max: number;
    resetAt: string;
  }): LimitRuleSnapshot => {
    const max = Math.max(0, args.max);
    const used = Math.max(0, Number(args.used.toFixed(8)));
    const remaining = Number(Math.max(0, max - used).toFixed(8));
    const usagePct = max > 0 ? Number(Math.min(100, (used / max) * 100).toFixed(2)) : 0;
    return {
      kind: args.kind,
      window: args.window,
      metric: args.metric,
      policy_key: args.policyKey,
      used,
      max,
      remaining,
      usage_pct: usagePct,
      reset_at: args.resetAt,
    };
  };

  const endpoints: EndpointLimitSummary[] = [];
  for (const item of byEndpoint.values()) {
    endpoints.push({
      endpoint_id: item.endpointId,
      endpoint_name: item.endpointId,
      limits: [
        toRule({
          kind: 'rate_limit',
          window: 'minute',
          metric: 'requests',
          policyKey: 'endpoint.requests_per_minute',
          used: item.requestsMinute,
          max: rateLimitMax.minute,
          resetAt: minuteResetAt,
        }),
        toRule({
          kind: 'rate_limit',
          window: '5h',
          metric: 'requests',
          policyKey: 'endpoint.requests_per_5_hours',
          used: item.requests5h,
          max: rateLimitMax.fiveHours,
          resetAt: fiveHoursResetAt,
        }),
        toRule({
          kind: 'rate_limit',
          window: 'day',
          metric: 'requests',
          policyKey: 'endpoint.requests_per_day',
          used: item.requestsDay,
          max: rateLimitMax.day,
          resetAt: dayResetAt,
        }),
        toRule({
          kind: 'spending_limit',
          window: 'minute',
          metric: 'usd',
          policyKey: 'endpoint.spending_usd_per_minute',
          used: item.usdMinute,
          max: spendingLimitMax.minute,
          resetAt: minuteResetAt,
        }),
        toRule({
          kind: 'spending_limit',
          window: '5h',
          metric: 'usd',
          policyKey: 'endpoint.spending_usd_per_5_hours',
          used: item.usd5h,
          max: spendingLimitMax.fiveHours,
          resetAt: fiveHoursResetAt,
        }),
        toRule({
          kind: 'spending_limit',
          window: 'day',
          metric: 'usd',
          policyKey: 'endpoint.spending_usd_per_day',
          used: item.usdDay,
          max: spendingLimitMax.day,
          resetAt: dayResetAt,
        }),
        toRule({
          kind: 'spending_limit',
          window: 'current',
          metric: 'usd',
          policyKey: 'endpoint.spending_usd_current_cycle',
          used: item.usdCurrent,
          max: spendingLimitMax.current,
          resetAt: currentResetAt,
        }),
      ],
    });
  }

  endpoints.sort((a, b) => a.endpoint_id.localeCompare(b.endpoint_id));
  return {
    endpoints,
  };
}

export async function getUsageRecordsSummary(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    startTime: string;
    endTime: string;
    provider?: string | null;
    model?: string | null;
    result?: 'ok' | 'error' | null;
    errorClass?: 'provider_retryable' | 'provider_non_retryable' | 'system_error' | null;
  },
): Promise<UsageRecordsSummaryResponse> {
  const facts = await listUsageFacts(docStore, {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    startTime: query.startTime,
    endTime: query.endTime,
    resourceType: 'endpoint',
    provider: query.provider ?? null,
    model: query.model ?? null,
    result: query.result ?? null,
    errorClass: query.errorClass ?? null,
  });

  const fallbackHopsHistogram = new Map<string, number>();
  const errorClassCounts: UsageRecordsSummaryResponse['error_class_counts'] = {
    provider_retryable: 0,
    provider_non_retryable: 0,
    system_error: 0,
  };
  const providerBreakdown = new Map<string, {
    provider: string;
    requests: number;
    errors: number;
    fallbackRequests: number;
    costs: number[];
    missingPriceFacts: number;
  }>();
  const modelBreakdown = new Map<string, {
    provider: string;
    model: string;
    requests: number;
    errors: number;
    fallbackRequests: number;
    costs: number[];
    missingPriceFacts: number;
  }>();
  const estimatedCosts: number[] = [];
  const durations: number[] = [];
  const trendBuckets = new Map<string, {
    requests: number;
    errors: number;
    recoveredRequests: number;
    costs: number[];
    durations: number[];
  }>();
  let totalRequests = 0;
  let totalErrors = 0;
  let recoveredRequests = 0;
  let missingPriceFacts = 0;

  for (const fact of facts) {
    const reqs = fact.requests ?? 1;
    const provider = getFactProvider(fact);
    const model = getFactModel(fact);
    const fallbackHops = getFactFallbackHops(fact);
    const estimatedCost = estimateFactCost(fact);
    const errorClass = getFactErrorClass(fact);
    const missingPrice = isFactMissingPrice(fact);
    totalRequests += reqs;
    if (fact.result === 'error') {
      totalErrors += reqs;
      if (errorClass) errorClassCounts[errorClass] += reqs;
    }
    if (fallbackHops > 0) {
      recoveredRequests += reqs;
    }
    fallbackHopsHistogram.set(
      String(fallbackHops),
      (fallbackHopsHistogram.get(String(fallbackHops)) ?? 0) + reqs,
    );
    if (estimatedCost > 0) {
      estimatedCosts.push(estimatedCost);
    }
    if (typeof fact.duration_ms === 'number') {
      durations.push(fact.duration_ms);
    }
    if (missingPrice) {
      missingPriceFacts += reqs;
    }
    const trendBucketKey = formatBucket(fact.timestamp, 'hour');
    const trendBucket = trendBuckets.get(trendBucketKey) ?? {
      requests: 0,
      errors: 0,
      recoveredRequests: 0,
      costs: [],
      durations: [],
    };
    trendBucket.requests += reqs;
    if (fact.result === 'error') trendBucket.errors += reqs;
    if (fallbackHops > 0) trendBucket.recoveredRequests += reqs;
    if (estimatedCost > 0) trendBucket.costs.push(estimatedCost);
    if (typeof fact.duration_ms === 'number') trendBucket.durations.push(fact.duration_ms);
    trendBuckets.set(trendBucketKey, trendBucket);

    if (provider) {
      const providerAgg = providerBreakdown.get(provider) ?? {
        provider,
        requests: 0,
        errors: 0,
        fallbackRequests: 0,
        costs: [],
        missingPriceFacts: 0,
      };
      providerAgg.requests += reqs;
      if (fact.result === 'error') providerAgg.errors += reqs;
      if (fallbackHops > 0) providerAgg.fallbackRequests += reqs;
      if (estimatedCost > 0) providerAgg.costs.push(estimatedCost);
      if (missingPrice) providerAgg.missingPriceFacts += reqs;
      providerBreakdown.set(provider, providerAgg);
    }

    if (provider && model) {
      const modelKey = `${provider}:${model}`;
      const modelAgg = modelBreakdown.get(modelKey) ?? {
        provider,
        model,
        requests: 0,
        errors: 0,
        fallbackRequests: 0,
        costs: [],
        missingPriceFacts: 0,
      };
      modelAgg.requests += reqs;
      if (fact.result === 'error') modelAgg.errors += reqs;
      if (fallbackHops > 0) modelAgg.fallbackRequests += reqs;
      if (estimatedCost > 0) modelAgg.costs.push(estimatedCost);
      if (missingPrice) modelAgg.missingPriceFacts += reqs;
      modelBreakdown.set(modelKey, modelAgg);
    }
  }

  const p95Cost = estimatedCosts.length > 0 ? (percentile95(estimatedCosts) ?? 0) : 0;
  const totalCost = estimatedCosts.reduce((sum, value) => sum + value, 0);
  const avgCost = estimatedCosts.length > 0 ? totalCost / estimatedCosts.length : 0;
  const errorRate = totalRequests > 0 ? Number((totalErrors / totalRequests).toFixed(4)) : 0;
  const requestTrend = Array.from(trendBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timeBucket, item]) => ({
      time_bucket: timeBucket,
      requests: item.requests,
      errors: item.errors,
      rerouted_requests: item.recoveredRequests,
      avg_estimated_cost: item.costs.length > 0
        ? Number((item.costs.reduce((sum, value) => sum + value, 0) / item.costs.length).toFixed(8))
        : 0,
      duration_p95_ms: item.durations.length > 0 ? percentile95(item.durations) : undefined,
    }));
  const baselineRequests = requestTrend.length > 0
    ? requestTrend.reduce((sum, item) => sum + item.requests, 0) / requestTrend.length
    : 0;
  const baselineErrors = requestTrend.length > 0
    ? requestTrend.reduce((sum, item) => sum + item.errors, 0) / requestTrend.length
    : 0;
  const latestTrend = requestTrend[requestTrend.length - 1];
  const issueSignals: UsageRecordsSummaryResponse['issue_signals'] = [];
  if (latestTrend && baselineRequests > 0 && latestTrend.rerouted_requests > Math.max(3, latestTrend.requests * 0.4)) {
    issueSignals.push({
      id: `fallback-${latestTrend.time_bucket}`,
      severity: 'high',
      kind: 'fallback_spike',
      title: 'Reroute activity increased',
      message: `${latestTrend.rerouted_requests} rerouted requests in ${latestTrend.time_bucket}`,
    });
  }
  if (latestTrend && baselineErrors > 0 && latestTrend.errors > Math.max(2, baselineErrors * 1.5)) {
    issueSignals.push({
      id: `errors-${latestTrend.time_bucket}`,
      severity: 'high',
      kind: 'error_rate_spike',
      title: 'Request errors increased',
      message: `${latestTrend.errors} failed requests in ${latestTrend.time_bucket}`,
    });
  }
  if (missingPriceFacts > 0) {
    issueSignals.push({
      id: 'missing-price',
      severity: missingPriceFacts > 3 ? 'high' : 'medium',
      kind: 'missing_price',
      title: 'Price data is incomplete',
      message: `${missingPriceFacts} records are missing price attribution`,
    });
  }
  const p95Latency = durations.length > 0 ? percentile95(durations) : undefined;
  const p99Latency = durations.length > 0 ? percentile(durations, 0.99) : undefined;
  if (latestTrend?.duration_p95_ms && p95Latency && latestTrend.duration_p95_ms > p95Latency * 1.25) {
    issueSignals.push({
      id: `latency-${latestTrend.time_bucket}`,
      severity: 'medium',
      kind: 'latency_spike',
      title: 'Latency increased',
      message: `P95 latency reached ${Math.round(latestTrend.duration_p95_ms)}ms in ${latestTrend.time_bucket}`,
    });
  }

  return {
    total_requests: totalRequests,
    total_errors: totalErrors,
    error_rate: errorRate,
    reroute_hops_histogram: Object.fromEntries(fallbackHopsHistogram.entries()),
    error_class_counts: errorClassCounts,
    avg_estimated_cost: Number(avgCost.toFixed(8)),
    p95_estimated_cost: Number(p95Cost.toFixed(8)),
    records_health: {
      rerouted_requests: recoveredRequests,
      terminal_error_requests: totalErrors,
      missing_price_records: missingPriceFacts,
      provider_count: providerBreakdown.size,
      model_count: modelBreakdown.size,
    },
    request_trend: requestTrend,
    latency_distribution_ms: {
      p50: percentile(durations, 0.5),
      p95: p95Latency,
      p99: p99Latency,
    },
    cost_distribution_usd: {
      p50: percentile(estimatedCosts, 0.5),
      p95: percentile(estimatedCosts, 0.95),
      p99: percentile(estimatedCosts, 0.99),
    },
    issue_signals: issueSignals,
    provider_breakdown: Array.from(providerBreakdown.values())
      .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider))
      .map((item) => ({
        provider: item.provider,
        requests: item.requests,
        errors: item.errors,
        error_rate: item.requests > 0 ? Number((item.errors / item.requests).toFixed(4)) : 0,
        reroute_rate: item.requests > 0 ? Number((item.fallbackRequests / item.requests).toFixed(4)) : 0,
        avg_estimated_cost: item.costs.length > 0
          ? Number((item.costs.reduce((sum, value) => sum + value, 0) / item.costs.length).toFixed(8))
          : 0,
        p95_estimated_cost: item.costs.length > 0 ? Number((percentile95(item.costs) ?? 0).toFixed(8)) : 0,
        missing_price_records: item.missingPriceFacts,
      })),
    model_breakdown: Array.from(modelBreakdown.values())
      .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model))
      .map((item) => ({
        provider: item.provider,
        model: item.model,
        requests: item.requests,
        errors: item.errors,
        error_rate: item.requests > 0 ? Number((item.errors / item.requests).toFixed(4)) : 0,
        reroute_rate: item.requests > 0 ? Number((item.fallbackRequests / item.requests).toFixed(4)) : 0,
        avg_estimated_cost: item.costs.length > 0
          ? Number((item.costs.reduce((sum, value) => sum + value, 0) / item.costs.length).toFixed(8))
          : 0,
        p95_estimated_cost: item.costs.length > 0 ? Number((percentile95(item.costs) ?? 0).toFixed(8)) : 0,
        missing_price_records: item.missingPriceFacts,
      })),
    time_range: {
      start: query.startTime,
      end: query.endTime,
    },
  };
}

export async function getUsageOperationsSummary(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    startTime: string;
    endTime: string;
    resourceType?: string | null;
    resourceId?: string | null;
    endUserId?: string | null;
    provider?: string | null;
    model?: string | null;
    result?: 'ok' | 'error' | null;
    errorClass?: 'provider_retryable' | 'provider_non_retryable' | 'system_error' | null;
  },
): Promise<UsageOperationsSummaryResponse> {
  const facts = await listUsageFacts(docStore, {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    startTime: query.startTime,
    endTime: query.endTime,
    resourceType: query.resourceType ?? null,
    resourceId: query.resourceId ?? null,
    endUserId: query.endUserId ?? null,
    provider: query.provider ?? null,
    model: query.model ?? null,
    result: query.result ?? null,
    errorClass: query.errorClass ?? null,
  });

  const providerAgg = new Map<string, { provider: string; requests: number; errors: number; estimated_cost: number }>();
  const modelAgg = new Map<string, { provider: string; model: string; requests: number; errors: number; estimated_cost: number }>();
  const endUserAgg = new Map<string, { end_user_id: string; requests: number; errors: number; estimated_cost: number }>();
  const trendBuckets = new Map<string, { requests: number; errors: number; cost: number }>();

  for (const fact of facts) {
    const reqs = fact.requests ?? 1;
    const cost = estimateFactCost(fact);
    const provider = getFactProvider(fact);
    const model = getFactModel(fact);
    const endUserId = nonEmptyString(fact.end_user_id);
    const bucketKey = formatBucket(fact.timestamp, 'hour');
    const trend = trendBuckets.get(bucketKey) ?? { requests: 0, errors: 0, cost: 0 };
    trend.requests += reqs;
    if (fact.result === 'error') trend.errors += reqs;
    trend.cost += cost;
    trendBuckets.set(bucketKey, trend);

    if (provider) {
      const item = providerAgg.get(provider) ?? { provider, requests: 0, errors: 0, estimated_cost: 0 };
      item.requests += reqs;
      if (fact.result === 'error') item.errors += reqs;
      item.estimated_cost += cost;
      providerAgg.set(provider, item);
    }
    if (provider && model) {
      const key = `${provider}:${model}`;
      const item = modelAgg.get(key) ?? { provider, model, requests: 0, errors: 0, estimated_cost: 0 };
      item.requests += reqs;
      if (fact.result === 'error') item.errors += reqs;
      item.estimated_cost += cost;
      modelAgg.set(key, item);
    }
    if (endUserId) {
      const item = endUserAgg.get(endUserId) ?? { end_user_id: endUserId, requests: 0, errors: 0, estimated_cost: 0 };
      item.requests += reqs;
      if (fact.result === 'error') item.errors += reqs;
      item.estimated_cost += cost;
      endUserAgg.set(endUserId, item);
    }
  }

  const trendItems = Array.from(trendBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time_bucket, item]) => ({ time_bucket, ...item }));
  const baselineRequests = trendItems.length > 0 ? trendItems.reduce((sum, item) => sum + item.requests, 0) / trendItems.length : 0;
  const baselineErrors = trendItems.length > 0 ? trendItems.reduce((sum, item) => sum + item.errors, 0) / trendItems.length : 0;
  const baselineCost = trendItems.length > 0 ? trendItems.reduce((sum, item) => sum + item.cost, 0) / trendItems.length : 0;
  const anomalyPeaks: UsageOperationsSummaryResponse['anomaly_peaks'] = [];
  for (const item of trendItems.slice(-12)) {
    if (baselineRequests > 0 && item.requests > baselineRequests * 1.5) {
      anomalyPeaks.push({
        id: `requests-${item.time_bucket}`,
        time_bucket: item.time_bucket,
        metric: 'requests',
        value: item.requests,
        baseline: Number(baselineRequests.toFixed(2)),
        severity: item.requests > baselineRequests * 2 ? 'high' : 'medium',
      });
    }
    if (baselineErrors > 0 && item.errors > baselineErrors * 1.5) {
      anomalyPeaks.push({
        id: `errors-${item.time_bucket}`,
        time_bucket: item.time_bucket,
        metric: 'errors',
        value: item.errors,
        baseline: Number(baselineErrors.toFixed(2)),
        severity: item.errors > baselineErrors * 2 ? 'high' : 'medium',
      });
    }
    if (baselineCost > 0 && item.cost > baselineCost * 1.5) {
      anomalyPeaks.push({
        id: `cost-${item.time_bucket}`,
        time_bucket: item.time_bucket,
        metric: 'cost',
        value: Number(item.cost.toFixed(8)),
        baseline: Number(baselineCost.toFixed(8)),
        severity: item.cost > baselineCost * 2 ? 'high' : 'medium',
      });
    }
  }

  const recentRequests = facts
    .slice()
    .sort((a, b) => parseIsoMillis(b.timestamp) - parseIsoMillis(a.timestamp))
    .slice(0, 12)
    .map((fact) => ({
      id: fact.id,
      timestamp: fact.timestamp,
      request_id: fact.request_id,
      provider: getFactProvider(fact),
      model: getFactModel(fact),
      end_user_id: fact.end_user_id,
      result: fact.result,
      error_class: getFactErrorClass(fact),
      estimated_cost: estimateFactCost(fact) || undefined,
    }));

  const webhookDestinations: UsageOperationsSummaryResponse['webhook_destinations'] = [];

  return {
    top_providers: Array.from(providerAgg.values())
      .sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests)
      .slice(0, 5),
    top_models: Array.from(modelAgg.values())
      .sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests)
      .slice(0, 5),
    top_end_users: Array.from(endUserAgg.values())
      .sort((a, b) => b.estimated_cost - a.estimated_cost || b.requests - a.requests)
      .slice(0, 5),
    anomaly_peaks: anomalyPeaks.slice(0, 6),
    recent_requests: recentRequests,
    webhook_destinations: webhookDestinations,
  };
}
