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
  runtime?: {
    provider?: string;
    resolved_model?: string;
    error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
    fallback_hops?: number;
    pricing_version?: string | null;
    estimated_cost?: number | null;
    missing_price?: boolean;
    attempts?: Array<Record<string, unknown>>;
  };
  metadata_json?: Record<string, unknown>;
};

export type UsageKpi = {
  requests_today: number;
  errors_today: number;
  tokens_today?: number;
  requests_yesterday?: number;
  errors_yesterday?: number;
  tokens_yesterday?: number;
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

export type LimitsSummaryItem = {
  resource_id: string;
  resource_name: string;
  resource_type: 'endpoint' | 'source_library' | 'agent';
  quota_used: number;
  quota_limit: number;
  quota_unit: 'tokens' | 'requests' | 'bytes' | 'files';
  quota_reset_at: string;
  percentage_used: number;
};

export type LimitsOverview = {
  endpoints?: LimitsSummaryItem[];
  source_libraries?: LimitsSummaryItem[];
  agents?: LimitsSummaryItem[];
  total_quota_limit?: number;
  total_quota_used?: number;
};

export type RuntimeObservabilityResponse = {
  total_requests: number;
  total_errors: number;
  error_rate: number;
  fallback_hops_histogram: Record<string, number>;
  error_class_counts: Record<'provider_retryable' | 'provider_non_retryable' | 'system_error', number>;
  avg_estimated_cost: number;
  p95_estimated_cost: number;
  health_summary: {
    recovered_requests: number;
    terminal_error_requests: number;
    missing_price_facts: number;
    provider_count: number;
    model_count: number;
  };
  request_trend: Array<{
    time_bucket: string;
    requests: number;
    errors: number;
    recovered_requests: number;
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
  degradation_signals: Array<{
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
    fallback_rate: number;
    avg_estimated_cost: number;
    p95_estimated_cost: number;
    missing_price_facts: number;
  }>;
  model_breakdown: Array<{
    provider: string;
    model: string;
    requests: number;
    errors: number;
    error_rate: number;
    fallback_rate: number;
    avg_estimated_cost: number;
    p95_estimated_cost: number;
    missing_price_facts: number;
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

export type UsageExportResponse = {
  filename: string;
  contentType: 'text/csv; charset=utf-8' | 'application/json; charset=utf-8';
  body: string;
};

export type UsageReportScheduleCadence = 'daily' | 'weekly' | 'monthly';
export type UsageReportScheduleStatus = 'active' | 'paused';
export type UsageReportScheduleFormat = 'csv' | 'json';
export type UsageReportScheduleWindow = 'last_24h' | 'last_7d' | 'last_30d';
export type UsageReportScheduleDeliveryChannel = 'in_app' | 'webhook';
export type UsageReportDeliveryErrorClass =
  | 'empty_result'
  | 'delivery_channel_timeout'
  | 'delivery_channel_network'
  | 'delivery_channel_auth'
  | 'delivery_channel_4xx'
  | 'delivery_channel_5xx'
  | 'system_error';

export type UsageReportScheduleRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  cadence: UsageReportScheduleCadence;
  status: UsageReportScheduleStatus;
  format: UsageReportScheduleFormat;
  time_window: UsageReportScheduleWindow;
  delivery_channel: UsageReportScheduleDeliveryChannel;
  delivery_config?: {
    webhook_url?: string;
    credential_ref?: string;
    secret_header_name?: string;
    signature_header_name?: string;
    timeout_seconds?: number;
    retry_attempts?: number;
    retry_backoff_ms?: number;
  };
  filters?: {
    resource_type?: string;
    resource_id?: string;
    end_user_id?: string;
    provider?: string;
    model?: string;
    result?: 'ok' | 'error';
    error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
  };
  release_evidence_required: boolean;
  empty_result_policy: 'deliver' | 'fail';
  created_at: string;
  updated_at: string;
  next_run_at: string;
  last_run_at?: string;
  last_delivery_status?: 'idle' | 'success' | 'failed';
  last_delivery_at?: string;
  last_delivery_error?: string;
  recent_deliveries?: UsageReportDeliveryRecord[];
};

export type UsageReportScheduleDeliveryResult = {
  delivery_id: string;
  schedule_id: string;
  delivery_channel: UsageReportScheduleDeliveryChannel;
  generated_at: string;
  preview_filename: string;
  content_type: UsageExportResponse['contentType'];
  status: 'success' | 'failed';
  summary: {
    requests: number;
    errors: number;
    top_provider?: string;
    estimated_cost?: number;
  };
  error?: string;
  error_class?: UsageReportDeliveryErrorClass;
  delivery_metadata?: Record<string, unknown>;
};

export type UsageReportDeliveryRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  schedule_id: string;
  trigger: 'scheduled' | 'manual' | 'retry' | 'test';
  status: 'success' | 'failed';
  attempt_count: number;
  report_period_start: string;
  report_period_end: string;
  created_at: string;
  completed_at: string;
  preview_filename?: string;
  content_type?: UsageExportResponse['contentType'];
  summary: {
    requests: number;
    errors: number;
    top_provider?: string;
    estimated_cost?: number;
  };
  error?: string;
  error_class?: UsageReportDeliveryErrorClass;
  acknowledged_at?: string;
  acknowledged_by?: string;
  parent_delivery_id?: string;
  delivery_metadata?: Record<string, unknown>;
};

export type UsageReportEvidence = {
  source: 'artifact' | 'dry_run';
  generated_at: string;
  release_readiness: 'ready' | 'blocked';
  blockers: string[];
  warnings: string[];
  active_schedules: number;
  required_schedules: number;
  successful_deliveries_last_7d: number;
  failed_deliveries_last_7d: number;
  unacknowledged_required_deliveries: number;
  runner_health?: {
    enabled: boolean;
    interval_ms: number;
    running: boolean;
    run_count: number;
    last_status: 'idle' | 'success' | 'failed';
    last_started_at?: string;
    last_completed_at?: string;
    last_error?: string;
    last_result?: {
      generated_at: string;
      processed_schedules: number;
      successful_deliveries: number;
      failed_deliveries: number;
    };
  };
};

export type UsageReportRunnerProjectResult = {
  workspace_id: string;
  project_id: string;
  processed: number;
  deliveries: UsageReportScheduleDeliveryResult[];
};

export type UsageReportRunnerSweepResult = {
  generated_at: string;
  scanned_projects: number;
  processed_schedules: number;
  successful_deliveries: number;
  failed_deliveries: number;
  projects: UsageReportRunnerProjectResult[];
};

export type UsageReportDeliveryDispatchResult =
  | {
    ok: true;
    delivery_metadata?: Record<string, unknown>;
  }
  | {
    ok: false;
    error: string;
    error_class: UsageReportDeliveryErrorClass;
    delivery_metadata?: Record<string, unknown>;
  };

export const AUDIT_EVENTS_COLLECTION = 'project_audit_events';
export const USAGE_FACTS_COLLECTION = 'project_usage_facts';
export const USAGE_REPORT_SCHEDULES_COLLECTION = 'project_usage_report_schedules';
export const USAGE_REPORT_DELIVERIES_COLLECTION = 'project_usage_report_deliveries';

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

function classifyRuntimeErrorClass(errorCode?: string): 'provider_retryable' | 'provider_non_retryable' | 'system_error' {
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
  return classifyRuntimeErrorClass(fact.error_code);
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
    decision_id: extractDecisionIdFromMetadata(input.metadata_json),
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
  const runtimeAttempts = Array.isArray(metadata?.attempt_trace)
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
    runtime: {
      provider: nonEmptyString(metadata?.provider),
      resolved_model: nonEmptyString(metadata?.resolved_model),
      error_class: fact.result === 'error' ? classifyRuntimeErrorClass(fact.error_code) : undefined,
      fallback_hops: typeof metadata?.fallback_hops === 'number' ? metadata.fallback_hops : undefined,
      pricing_version: typeof metadata?.pricing_version === 'string' ? metadata.pricing_version : null,
      estimated_cost: typeof metadata?.estimated_cost === 'number' ? metadata.estimated_cost : null,
      missing_price: metadata?.missing_price === true,
      attempts: runtimeAttempts,
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
    const tokens = isRequestsOnlyUsageResourceType(fact.resource_type) ? 0 : (fact.tokens_total ?? 0);
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
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const tomorrowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

  const facts = await listUsageFacts(docStore, {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    startTime: todayStart,
    endTime: tomorrowStart,
  });

  const byResource = new Map<string, { resourceType: 'endpoint' | 'source_library' | 'agent'; resourceId: string; requests: number }>();
  for (const fact of facts) {
    if (fact.resource_type !== 'endpoint' && fact.resource_type !== 'source_library' && fact.resource_type !== 'agent') {
      continue;
    }
    const key = `${fact.resource_type}:${fact.resource_id ?? 'unknown'}`;
    const existing = byResource.get(key) ?? {
      resourceType: fact.resource_type,
      resourceId: fact.resource_id ?? 'unknown',
      requests: 0,
    };
    existing.requests += fact.requests ?? 1;
    byResource.set(key, existing);
  }

  const limitByResourceType: Record<'endpoint' | 'source_library' | 'agent', number> = {
    endpoint: 20000,
    source_library: 10000,
    agent: 12000,
  };
  const resetAt = tomorrowStart;

  const endpoints: LimitsSummaryItem[] = [];
  const sourceLibraries: LimitsSummaryItem[] = [];
  const agents: LimitsSummaryItem[] = [];

  for (const item of byResource.values()) {
    const limit = limitByResourceType[item.resourceType];
    const row: LimitsSummaryItem = {
      resource_id: item.resourceId,
      resource_name: item.resourceId,
      resource_type: item.resourceType,
      quota_used: item.requests,
      quota_limit: limit,
      quota_unit: 'requests',
      quota_reset_at: resetAt,
      percentage_used: Number(((item.requests / Math.max(1, limit)) * 100).toFixed(2)),
    };
    if (item.resourceType === 'endpoint') endpoints.push(row);
    if (item.resourceType === 'source_library') sourceLibraries.push(row);
    if (item.resourceType === 'agent') agents.push(row);
  }

  const totalLimitsUsed = [...endpoints, ...sourceLibraries, ...agents].reduce((sum, item) => sum + item.quota_used, 0);
  const totalLimitsCapacity = endpoints.length * limitByResourceType.endpoint
    + sourceLibraries.length * limitByResourceType.source_library
    + agents.length * limitByResourceType.agent;

  return {
    endpoints,
    source_libraries: sourceLibraries,
    agents,
    total_quota_used: totalLimitsUsed || undefined,
    total_quota_limit: totalLimitsCapacity || undefined,
  };
}

export async function getRuntimeObservability(
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
): Promise<RuntimeObservabilityResponse> {
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
  const errorClassCounts: RuntimeObservabilityResponse['error_class_counts'] = {
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
      recovered_requests: item.recoveredRequests,
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
  const degradationSignals: RuntimeObservabilityResponse['degradation_signals'] = [];
  if (latestTrend && baselineRequests > 0 && latestTrend.recovered_requests > Math.max(3, latestTrend.requests * 0.4)) {
    degradationSignals.push({
      id: `fallback-${latestTrend.time_bucket}`,
      severity: 'high',
      kind: 'fallback_spike',
      title: 'Fallback spike detected',
      message: `${latestTrend.recovered_requests} recovered requests in ${latestTrend.time_bucket}`,
    });
  }
  if (latestTrend && baselineErrors > 0 && latestTrend.errors > Math.max(2, baselineErrors * 1.5)) {
    degradationSignals.push({
      id: `errors-${latestTrend.time_bucket}`,
      severity: 'high',
      kind: 'error_rate_spike',
      title: 'Error spike detected',
      message: `${latestTrend.errors} errored requests in ${latestTrend.time_bucket}`,
    });
  }
  if (missingPriceFacts > 0) {
    degradationSignals.push({
      id: 'missing-price',
      severity: missingPriceFacts > 3 ? 'high' : 'medium',
      kind: 'missing_price',
      title: 'Missing price coverage',
      message: `${missingPriceFacts} runtime facts are missing price attribution`,
    });
  }
  const p95Latency = durations.length > 0 ? percentile95(durations) : undefined;
  const p99Latency = durations.length > 0 ? percentile(durations, 0.99) : undefined;
  if (latestTrend?.duration_p95_ms && p95Latency && latestTrend.duration_p95_ms > p95Latency * 1.25) {
    degradationSignals.push({
      id: `latency-${latestTrend.time_bucket}`,
      severity: 'medium',
      kind: 'latency_spike',
      title: 'Latency spike detected',
      message: `P95 latency elevated to ${Math.round(latestTrend.duration_p95_ms)}ms in ${latestTrend.time_bucket}`,
    });
  }

  return {
    total_requests: totalRequests,
    total_errors: totalErrors,
    error_rate: errorRate,
    fallback_hops_histogram: Object.fromEntries(fallbackHopsHistogram.entries()),
    error_class_counts: errorClassCounts,
    avg_estimated_cost: Number(avgCost.toFixed(8)),
    p95_estimated_cost: Number(p95Cost.toFixed(8)),
    health_summary: {
      recovered_requests: recoveredRequests,
      terminal_error_requests: totalErrors,
      missing_price_facts: missingPriceFacts,
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
    degradation_signals: degradationSignals,
    provider_breakdown: Array.from(providerBreakdown.values())
      .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider))
      .map((item) => ({
        provider: item.provider,
        requests: item.requests,
        errors: item.errors,
        error_rate: item.requests > 0 ? Number((item.errors / item.requests).toFixed(4)) : 0,
        fallback_rate: item.requests > 0 ? Number((item.fallbackRequests / item.requests).toFixed(4)) : 0,
        avg_estimated_cost: item.costs.length > 0
          ? Number((item.costs.reduce((sum, value) => sum + value, 0) / item.costs.length).toFixed(8))
          : 0,
        p95_estimated_cost: item.costs.length > 0 ? Number((percentile95(item.costs) ?? 0).toFixed(8)) : 0,
        missing_price_facts: item.missingPriceFacts,
      })),
    model_breakdown: Array.from(modelBreakdown.values())
      .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model))
      .map((item) => ({
        provider: item.provider,
        model: item.model,
        requests: item.requests,
        errors: item.errors,
        error_rate: item.requests > 0 ? Number((item.errors / item.requests).toFixed(4)) : 0,
        fallback_rate: item.requests > 0 ? Number((item.fallbackRequests / item.requests).toFixed(4)) : 0,
        avg_estimated_cost: item.costs.length > 0
          ? Number((item.costs.reduce((sum, value) => sum + value, 0) / item.costs.length).toFixed(8))
          : 0,
        p95_estimated_cost: item.costs.length > 0 ? Number((percentile95(item.costs) ?? 0).toFixed(8)) : 0,
        missing_price_facts: item.missingPriceFacts,
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

  const deliveries = (await docStore.list<UsageReportDeliveryRecord>(USAGE_REPORT_DELIVERIES_COLLECTION, {
    workspace_id: query.workspaceId,
    project_id: query.projectId,
  }))
    .filter((item) => inRange(item.completed_at, parseIsoMillis(query.startTime), parseIsoMillis(query.endTime)));

  const webhookDestAgg = new Map<string, {
    host: string;
    path?: string;
    protocol?: string;
    deliveries: number;
    successes: number;
    failures: number;
    latency: number[];
    timeout_failures: number;
    network_failures: number;
    auth_failures: number;
    client_failures: number;
    server_failures: number;
    last_status: 'success' | 'failed';
    last_delivery_at: string;
  }>();

  for (const delivery of deliveries) {
    const metadata = delivery.delivery_metadata;
    if (!metadata || metadata.dispatch_mode !== 'webhook') continue;
    const host = nonEmptyString(metadata.webhook_target_host) ?? 'unknown';
    const path = nonEmptyString(metadata.webhook_target_path);
    const protocol = nonEmptyString(metadata.webhook_target_protocol);
    const key = `${protocol ?? ''}|${host}|${path ?? ''}`;
    const item = webhookDestAgg.get(key) ?? {
      host,
      path,
      protocol,
      deliveries: 0,
      successes: 0,
      failures: 0,
      latency: [],
      timeout_failures: 0,
      network_failures: 0,
      auth_failures: 0,
      client_failures: 0,
      server_failures: 0,
      last_status: delivery.status,
      last_delivery_at: delivery.completed_at,
    };
    item.deliveries += 1;
    if (delivery.status === 'success') item.successes += 1;
    if (delivery.status === 'failed') item.failures += 1;
    if (typeof metadata.duration_ms === 'number' && Number.isFinite(metadata.duration_ms)) {
      item.latency.push(metadata.duration_ms);
    }
    switch (delivery.error_class) {
      case 'delivery_channel_timeout':
        item.timeout_failures += 1;
        break;
      case 'delivery_channel_network':
        item.network_failures += 1;
        break;
      case 'delivery_channel_auth':
        item.auth_failures += 1;
        break;
      case 'delivery_channel_4xx':
        item.client_failures += 1;
        break;
      case 'delivery_channel_5xx':
        item.server_failures += 1;
        break;
      default:
        break;
    }
    if (delivery.completed_at >= item.last_delivery_at) {
      item.last_delivery_at = delivery.completed_at;
      item.last_status = delivery.status;
    }
    webhookDestAgg.set(key, item);
  }

  const webhookDestinations = Array.from(webhookDestAgg.values())
    .map((item) => ({
      host: item.host,
      path: item.path,
      protocol: item.protocol,
      deliveries: item.deliveries,
      successes: item.successes,
      failures: item.failures,
      success_rate: item.deliveries > 0 ? item.successes / item.deliveries : 0,
      avg_latency_ms: item.latency.length > 0
        ? Number((item.latency.reduce((sum, value) => sum + value, 0) / item.latency.length).toFixed(2))
        : undefined,
      p95_latency_ms: percentile95(item.latency),
      timeout_failures: item.timeout_failures,
      network_failures: item.network_failures,
      auth_failures: item.auth_failures,
      client_failures: item.client_failures,
      server_failures: item.server_failures,
      last_status: item.last_status,
      last_delivery_at: item.last_delivery_at,
    }))
    .sort((a, b) => b.deliveries - a.deliveries || a.host.localeCompare(b.host));

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

function escapeCsvCell(value: unknown): string {
  const normalized = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function computeNextRunAt(cadence: UsageReportScheduleCadence, nowIso = new Date().toISOString()): string {
  const now = new Date(nowIso);
  if (cadence === 'daily') return addDays(now, 1).toISOString();
  if (cadence === 'weekly') return addDays(now, 7).toISOString();
  return addMonths(now, 1).toISOString();
}

function resolveTimeWindow(window: UsageReportScheduleWindow, nowIso = new Date().toISOString()) {
  const end = new Date(nowIso);
  const start = new Date(end);
  if (window === 'last_24h') start.setUTCDate(start.getUTCDate() - 1);
  if (window === 'last_7d') start.setUTCDate(start.getUTCDate() - 7);
  if (window === 'last_30d') start.setUTCDate(start.getUTCDate() - 30);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

export async function exportUsageData(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    startTime: string;
    endTime: string;
    format: 'csv' | 'json';
    resourceType?: string | null;
    resourceId?: string | null;
    endUserId?: string | null;
    provider?: string | null;
    model?: string | null;
    result?: 'ok' | 'error' | null;
    errorClass?: 'provider_retryable' | 'provider_non_retryable' | 'system_error' | null;
  },
): Promise<UsageExportResponse> {
  const baseFactsQuery = {
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
  };

  const usageFacts = await listUsageFactRecords(docStore, {
    ...baseFactsQuery,
    sortOrder: 'desc',
    page: 1,
    pageSize: 10_000,
  });

  const filenameBase = `usage-report-${query.projectId}-${query.startTime.slice(0, 10)}-${query.endTime.slice(0, 10)}`;

  if (query.format === 'csv') {
    const headers = [
      'timestamp',
      'request_id',
      'resource_type',
      'resource_id',
      'end_user_id',
      'provider',
      'resolved_model',
      'result',
      'error_code',
      'error_class',
      'fallback_hops',
      'pricing_version',
      'estimated_cost',
      'missing_price',
      'requests',
      'duration_ms',
      'tokens_in',
      'tokens_out',
      'tokens_total',
      'bytes_in',
      'bytes_out',
    ];
    const rows = usageFacts.items.map((item) => ([
      item.timestamp,
      item.request_id,
      item.resource_type,
      item.resource_id,
      item.end_user_id,
      item.runtime?.provider,
      item.runtime?.resolved_model,
      item.result,
      item.error_code,
      item.runtime?.error_class,
      item.runtime?.fallback_hops,
      item.runtime?.pricing_version,
      item.runtime?.estimated_cost,
      item.runtime?.missing_price,
      item.requests,
      item.duration_ms,
      item.tokens_in,
      item.tokens_out,
      item.tokens_total,
      item.bytes_in,
      item.bytes_out,
    ].map(escapeCsvCell).join(',')));

    return {
      filename: `${filenameBase}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: [headers.join(','), ...rows].join('\n'),
    };
  }

  const [kpi, records, runtimeObservability, operationsSummary] = await Promise.all([
    getUsageKpi(docStore, {
      workspaceId: query.workspaceId,
      projectId: query.projectId,
      startTime: query.startTime,
      endTime: query.endTime,
      endUserId: query.endUserId ?? null,
    }),
    aggregateUsageRecords(docStore, {
      ...baseFactsQuery,
      groupBy: 'day',
      sortBy: 'time_bucket',
      sortOrder: 'desc',
      page: 1,
      pageSize: 10_000,
    }),
    getRuntimeObservability(docStore, {
      workspaceId: query.workspaceId,
      projectId: query.projectId,
      startTime: query.startTime,
      endTime: query.endTime,
      provider: query.provider ?? null,
      model: query.model ?? null,
      result: query.result ?? null,
      errorClass: query.errorClass ?? null,
    }),
    getUsageOperationsSummary(docStore, baseFactsQuery),
  ]);

  return {
    filename: `${filenameBase}.json`,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({
      generated_at: new Date().toISOString(),
      workspace_id: query.workspaceId,
      project_id: query.projectId,
      filters: {
        start_time: query.startTime,
        end_time: query.endTime,
        resource_type: query.resourceType ?? null,
        resource_id: query.resourceId ?? null,
        end_user_id: query.endUserId ?? null,
        provider: query.provider ?? null,
        model: query.model ?? null,
        result: query.result ?? null,
        error_class: query.errorClass ?? null,
      },
      kpi,
      records: records.items,
      facts: usageFacts.items,
      runtime_observability: runtimeObservability,
      operations_summary: operationsSummary,
    }, null, 2),
  };
}

export async function listUsageReportSchedules(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
  },
): Promise<{ items: UsageReportScheduleRecord[] }> {
  const rows = await docStore.list<UsageReportScheduleRecord>(USAGE_REPORT_SCHEDULES_COLLECTION, {
    workspace_id: query.workspaceId,
    project_id: query.projectId,
  });
  const deliveries = await docStore.list<UsageReportDeliveryRecord>(USAGE_REPORT_DELIVERIES_COLLECTION, {
    workspace_id: query.workspaceId,
    project_id: query.projectId,
  });
  return {
    items: rows
      .map((row) => ({
        ...row,
        recent_deliveries: deliveries
          .filter((delivery) => delivery.schedule_id === row.id)
          .sort((a, b) => {
            const completedDiff = b.completed_at.localeCompare(a.completed_at);
            if (completedDiff !== 0) return completedDiff;
            return b.attempt_count - a.attempt_count;
          })
          .slice(0, 5),
      }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  };
}

export async function createUsageReportSchedule(
  docStore: JsonDocStorePort,
  payload: Omit<UsageReportScheduleRecord, 'id' | 'created_at' | 'updated_at' | 'next_run_at' | 'last_delivery_status' | 'recent_deliveries'>,
): Promise<UsageReportScheduleRecord> {
  const now = new Date().toISOString();
  const record: UsageReportScheduleRecord = {
    ...payload,
    id: `usage_report_schedule_${randomUUID().replace(/-/g, '')}`,
    created_at: now,
    updated_at: now,
    next_run_at: computeNextRunAt(payload.cadence, now),
    last_delivery_status: 'idle',
  };
  await docStore.upsert(USAGE_REPORT_SCHEDULES_COLLECTION, record.id, record);
  return record;
}

export async function updateUsageReportSchedule(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    scheduleId: string;
    patch: Partial<
      Pick<
        UsageReportScheduleRecord,
        'name' | 'cadence' | 'status' | 'format' | 'time_window' | 'delivery_channel' | 'filters' | 'release_evidence_required' | 'empty_result_policy' | 'delivery_config'
      >
    >;
  },
): Promise<UsageReportScheduleRecord | null> {
  const current = await docStore.get<UsageReportScheduleRecord>(USAGE_REPORT_SCHEDULES_COLLECTION, query.scheduleId);
  if (!current || current.workspace_id !== query.workspaceId || current.project_id !== query.projectId) {
    return null;
  }
  const now = new Date().toISOString();
  const cadence = query.patch.cadence ?? current.cadence;
  const nextRunAt = (query.patch.cadence || query.patch.status === 'active')
    ? computeNextRunAt(cadence, now)
    : current.next_run_at;
  const next: UsageReportScheduleRecord = {
    ...current,
    ...query.patch,
    updated_at: now,
    next_run_at: nextRunAt,
  };
  await docStore.upsert(USAGE_REPORT_SCHEDULES_COLLECTION, next.id, next);
  return next;
}

export async function deleteUsageReportSchedule(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    scheduleId: string;
  },
): Promise<boolean> {
  const current = await docStore.get<UsageReportScheduleRecord>(USAGE_REPORT_SCHEDULES_COLLECTION, query.scheduleId);
  if (!current || current.workspace_id !== query.workspaceId || current.project_id !== query.projectId) {
    return false;
  }
  await docStore.delete(USAGE_REPORT_SCHEDULES_COLLECTION, query.scheduleId);
  return true;
}

async function resolveSchedule(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    scheduleId: string;
  },
): Promise<UsageReportScheduleRecord | null> {
  const schedule = await docStore.get<UsageReportScheduleRecord>(USAGE_REPORT_SCHEDULES_COLLECTION, query.scheduleId);
  if (!schedule || schedule.workspace_id !== query.workspaceId || schedule.project_id !== query.projectId) {
    return null;
  }
  return schedule;
}

async function latestDeliveryAttemptCount(
  docStore: JsonDocStorePort,
  scheduleId: string,
  parentDeliveryId?: string,
): Promise<number> {
  const deliveries = await docStore.list<UsageReportDeliveryRecord>(USAGE_REPORT_DELIVERIES_COLLECTION, { schedule_id: scheduleId });
  const related = deliveries.filter((item) => item.parent_delivery_id === parentDeliveryId || item.id === parentDeliveryId);
  if (related.length === 0) return 1;
  return Math.max(...related.map((item) => item.attempt_count)) + 1;
}

export async function executeUsageReportScheduleDelivery(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    scheduleId: string;
    trigger: UsageReportDeliveryRecord['trigger'];
    parentDeliveryId?: string;
    deliveryDispatch?: (args: {
      workspaceId: string;
      projectId: string;
      schedule: UsageReportScheduleRecord;
      result: UsageReportScheduleDeliveryResult;
      trigger: UsageReportDeliveryRecord['trigger'];
      recipientUserId?: string;
      reportBody: string;
      reportContentType: string;
    }) => Promise<UsageReportDeliveryDispatchResult>;
    recipientUserId?: string;
  },
): Promise<UsageReportScheduleDeliveryResult | null> {
  const schedule = await resolveSchedule(docStore, query);
  if (!schedule) return null;
  const now = new Date().toISOString();
  const range = resolveTimeWindow(schedule.time_window, now);
  const facts = await listUsageFactRecords(docStore, {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    startTime: range.startTime,
    endTime: range.endTime,
    resourceType: schedule.filters?.resource_type ?? null,
    resourceId: schedule.filters?.resource_id ?? null,
    endUserId: schedule.filters?.end_user_id ?? null,
    provider: schedule.filters?.provider ?? null,
    model: schedule.filters?.model ?? null,
    result: schedule.filters?.result ?? null,
    errorClass: schedule.filters?.error_class ?? null,
    sortOrder: 'desc',
    page: 1,
    pageSize: 10_000,
  });
  const summarySource = await getUsageOperationsSummary(docStore, {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    startTime: range.startTime,
    endTime: range.endTime,
    resourceType: schedule.filters?.resource_type ?? null,
    resourceId: schedule.filters?.resource_id ?? null,
    endUserId: schedule.filters?.end_user_id ?? null,
    provider: schedule.filters?.provider ?? null,
    model: schedule.filters?.model ?? null,
    result: schedule.filters?.result ?? null,
    errorClass: schedule.filters?.error_class ?? null,
  });
  const estimatedCost = facts.items.reduce((sum, item) => sum + (item.runtime?.estimated_cost ?? 0), 0);
  const errors = facts.items.filter((item) => item.result === 'error').length;
  const summary = {
    requests: facts.items.length,
    errors,
    top_provider: summarySource.top_providers[0]?.provider,
    estimated_cost: Number(estimatedCost.toFixed(8)),
  };
  const attemptCount = await latestDeliveryAttemptCount(docStore, schedule.id, query.parentDeliveryId);
  const deliveryId = `usage_report_delivery_${randomUUID().replace(/-/g, '')}`;

  if (schedule.empty_result_policy === 'fail' && facts.items.length === 0) {
    const failedDelivery: UsageReportDeliveryRecord = {
      id: deliveryId,
      workspace_id: query.workspaceId,
      project_id: query.projectId,
      schedule_id: schedule.id,
      trigger: query.trigger,
      status: 'failed',
      attempt_count: attemptCount,
      report_period_start: range.startTime,
      report_period_end: range.endTime,
      created_at: now,
      completed_at: now,
      summary,
      error: 'usage_report_empty_result',
      error_class: 'empty_result',
      parent_delivery_id: query.parentDeliveryId,
    };
    await docStore.upsert(USAGE_REPORT_DELIVERIES_COLLECTION, failedDelivery.id, failedDelivery);
    await docStore.upsert<UsageReportScheduleRecord>(USAGE_REPORT_SCHEDULES_COLLECTION, schedule.id, {
      ...schedule,
      updated_at: now,
      last_run_at: now,
      last_delivery_at: now,
      last_delivery_status: 'failed',
      last_delivery_error: failedDelivery.error,
      next_run_at: schedule.status === 'active' ? computeNextRunAt(schedule.cadence, now) : schedule.next_run_at,
    });
    return {
      delivery_id: failedDelivery.id,
      schedule_id: schedule.id,
      delivery_channel: schedule.delivery_channel,
      generated_at: now,
      preview_filename: '',
      content_type: schedule.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      status: 'failed',
      summary,
      error: failedDelivery.error,
      error_class: 'empty_result',
    };
  }

  const exportResult = await exportUsageData(docStore, {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    startTime: range.startTime,
    endTime: range.endTime,
    format: schedule.format,
    resourceType: schedule.filters?.resource_type ?? null,
    resourceId: schedule.filters?.resource_id ?? null,
    endUserId: schedule.filters?.end_user_id ?? null,
    provider: schedule.filters?.provider ?? null,
    model: schedule.filters?.model ?? null,
    result: schedule.filters?.result ?? null,
    errorClass: schedule.filters?.error_class ?? null,
  });
  const baseResult: UsageReportScheduleDeliveryResult = {
    delivery_id: deliveryId,
    schedule_id: schedule.id,
    delivery_channel: schedule.delivery_channel,
    generated_at: now,
    preview_filename: exportResult.filename,
    content_type: exportResult.contentType,
    status: 'success',
    summary,
  };

  const dispatchResult = query.deliveryDispatch
    ? await query.deliveryDispatch({
      workspaceId: query.workspaceId,
      projectId: query.projectId,
      schedule,
      result: baseResult,
      trigger: query.trigger,
      recipientUserId: query.recipientUserId,
      reportBody: exportResult.body,
      reportContentType: exportResult.contentType,
    })
    : { ok: true as const };

  const delivery: UsageReportDeliveryRecord = {
    id: deliveryId,
    workspace_id: query.workspaceId,
    project_id: query.projectId,
    schedule_id: schedule.id,
    trigger: query.trigger,
    status: dispatchResult.ok ? 'success' : 'failed',
    attempt_count: attemptCount,
    report_period_start: range.startTime,
    report_period_end: range.endTime,
    created_at: now,
    completed_at: now,
    preview_filename: exportResult.filename,
    content_type: exportResult.contentType,
    summary,
    error: dispatchResult.ok ? undefined : dispatchResult.error,
    error_class: dispatchResult.ok ? undefined : dispatchResult.error_class,
    parent_delivery_id: query.parentDeliveryId,
    delivery_metadata: dispatchResult.delivery_metadata,
  };
  await docStore.upsert(USAGE_REPORT_DELIVERIES_COLLECTION, delivery.id, delivery);
  const result: UsageReportScheduleDeliveryResult = {
    ...baseResult,
    summary,
    status: dispatchResult.ok ? 'success' : 'failed',
    error: dispatchResult.ok ? undefined : dispatchResult.error,
    error_class: dispatchResult.ok ? undefined : dispatchResult.error_class,
    delivery_metadata: dispatchResult.delivery_metadata,
  };
  await docStore.upsert<UsageReportScheduleRecord>(USAGE_REPORT_SCHEDULES_COLLECTION, schedule.id, {
    ...schedule,
    updated_at: now,
    last_run_at: now,
    last_delivery_at: now,
    last_delivery_status: dispatchResult.ok ? 'success' : 'failed',
    last_delivery_error: dispatchResult.ok ? undefined : dispatchResult.error,
    next_run_at: schedule.status === 'active' ? computeNextRunAt(schedule.cadence, now) : schedule.next_run_at,
  });
  return result;
}

export async function testUsageReportScheduleDelivery(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    scheduleId: string;
    deliveryDispatch?: Parameters<typeof executeUsageReportScheduleDelivery>[1]['deliveryDispatch'];
    recipientUserId?: string;
  },
): Promise<UsageReportScheduleDeliveryResult | null> {
  return executeUsageReportScheduleDelivery(docStore, { ...query, trigger: 'test' });
}

export async function runUsageReportScheduleNow(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    scheduleId: string;
    deliveryDispatch?: Parameters<typeof executeUsageReportScheduleDelivery>[1]['deliveryDispatch'];
    recipientUserId?: string;
  },
): Promise<UsageReportScheduleDeliveryResult | null> {
  return executeUsageReportScheduleDelivery(docStore, { ...query, trigger: 'manual' });
}

export async function retryUsageReportDelivery(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    scheduleId: string;
    deliveryId: string;
    deliveryDispatch?: Parameters<typeof executeUsageReportScheduleDelivery>[1]['deliveryDispatch'];
    recipientUserId?: string;
  },
): Promise<UsageReportScheduleDeliveryResult | null> {
  const existing = await docStore.get<UsageReportDeliveryRecord>(USAGE_REPORT_DELIVERIES_COLLECTION, query.deliveryId);
  if (!existing || existing.workspace_id !== query.workspaceId || existing.project_id !== query.projectId || existing.schedule_id !== query.scheduleId) {
    return null;
  }
  return executeUsageReportScheduleDelivery(docStore, {
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    scheduleId: query.scheduleId,
    trigger: 'retry',
    parentDeliveryId: existing.parent_delivery_id ?? existing.id,
    deliveryDispatch: query.deliveryDispatch,
    recipientUserId: query.recipientUserId,
  });
}

export async function acknowledgeUsageReportDelivery(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    scheduleId: string;
    deliveryId: string;
    acknowledgedBy: string;
  },
): Promise<UsageReportDeliveryRecord | null> {
  const existing = await docStore.get<UsageReportDeliveryRecord>(USAGE_REPORT_DELIVERIES_COLLECTION, query.deliveryId);
  if (!existing || existing.workspace_id !== query.workspaceId || existing.project_id !== query.projectId || existing.schedule_id !== query.scheduleId) {
    return null;
  }
  const next: UsageReportDeliveryRecord = {
    ...existing,
    acknowledged_at: new Date().toISOString(),
    acknowledged_by: query.acknowledgedBy,
  };
  await docStore.upsert(USAGE_REPORT_DELIVERIES_COLLECTION, next.id, next);
  return next;
}

export async function runDueUsageReportSchedules(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    now?: string;
    deliveryDispatch?: Parameters<typeof executeUsageReportScheduleDelivery>[1]['deliveryDispatch'];
  },
): Promise<{ processed: number; deliveries: UsageReportScheduleDeliveryResult[] }> {
  const listed = await listUsageReportSchedules(docStore, query);
  const now = query.now ?? new Date().toISOString();
  const due = listed.items.filter((item) => item.status === 'active' && item.next_run_at <= now);
  const deliveries: UsageReportScheduleDeliveryResult[] = [];
  for (const schedule of due) {
    const result = await executeUsageReportScheduleDelivery(docStore, {
      workspaceId: query.workspaceId,
      projectId: query.projectId,
      scheduleId: schedule.id,
      trigger: 'scheduled',
      deliveryDispatch: query.deliveryDispatch,
    });
    if (result) deliveries.push(result);
  }
  return { processed: due.length, deliveries };
}

export async function runDueUsageReportSchedulesAcrossProjects(
  docStore: JsonDocStorePort,
  query?: {
    now?: string;
    deliveryDispatch?: Parameters<typeof executeUsageReportScheduleDelivery>[1]['deliveryDispatch'];
  },
): Promise<UsageReportRunnerSweepResult> {
  const now = query?.now ?? new Date().toISOString();
  const rows = await docStore.list<UsageReportScheduleRecord>(USAGE_REPORT_SCHEDULES_COLLECTION);
  const projectKeys = new Map<string, { workspaceId: string; projectId: string }>();
  for (const row of rows) {
    if (!row.workspace_id || !row.project_id) continue;
    const key = `${row.workspace_id}:${row.project_id}`;
    if (!projectKeys.has(key)) {
      projectKeys.set(key, {
        workspaceId: row.workspace_id,
        projectId: row.project_id,
      });
    }
  }

  const projects: UsageReportRunnerProjectResult[] = [];
  for (const project of projectKeys.values()) {
    const result = await runDueUsageReportSchedules(docStore, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      now,
      deliveryDispatch: query?.deliveryDispatch,
    });
    if (result.processed > 0 || result.deliveries.length > 0) {
      projects.push({
        workspace_id: project.workspaceId,
        project_id: project.projectId,
        processed: result.processed,
        deliveries: result.deliveries,
      });
    }
  }

  const allDeliveries = projects.flatMap((item) => item.deliveries);
  return {
    generated_at: now,
    scanned_projects: projectKeys.size,
    processed_schedules: projects.reduce((sum, item) => sum + item.processed, 0),
    successful_deliveries: allDeliveries.filter((item) => item.status === 'success').length,
    failed_deliveries: allDeliveries.filter((item) => item.status === 'failed').length,
    projects,
  };
}

export async function getUsageReportEvidence(
  docStore: JsonDocStorePort,
  query: {
    workspaceId: string;
    projectId: string;
    now?: string;
    runnerHealth?: UsageReportEvidence['runner_health'];
  },
): Promise<UsageReportEvidence> {
  const listed = await listUsageReportSchedules(docStore, query);
  const now = query.now ?? new Date().toISOString();
  const recentCutoff = new Date(new Date(now).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const activeSchedules = listed.items.filter((item) => item.status === 'active');
  const requiredSchedules = activeSchedules.filter((item) => item.release_evidence_required);
  const blockers: string[] = [];
  let successful = 0;
  let failed = 0;
  let unacknowledgedRequired = 0;

  for (const schedule of requiredSchedules) {
    const latest = schedule.recent_deliveries?.[0];
    if (!latest) {
      blockers.push(`usage_report_schedule_missing_delivery:${schedule.name}`);
      continue;
    }
    if (latest.completed_at >= recentCutoff && latest.status === 'success') successful += 1;
    if (latest.completed_at >= recentCutoff && latest.status === 'failed') failed += 1;
    if (latest.status === 'failed') {
      blockers.push(`usage_report_schedule_latest_delivery_failed:${schedule.name}`);
    }
    if (!latest.acknowledged_at) {
      blockers.push(`usage_report_schedule_unacknowledged:${schedule.name}`);
      unacknowledgedRequired += 1;
    }
  }

  const warnings: string[] = [];
  if (activeSchedules.length === 0) warnings.push('usage_report_no_active_schedules');
  for (const schedule of activeSchedules) {
    if (schedule.delivery_channel === 'webhook'
      && schedule.delivery_config?.credential_ref
      && !schedule.delivery_config.signature_header_name) {
      warnings.push(`usage_report_schedule_webhook_signature_missing:${schedule.name}`);
    }
  }
  if (query.runnerHealth) {
    if (!query.runnerHealth.enabled) {
      warnings.push('usage_report_runner_disabled');
      if (requiredSchedules.length > 0) blockers.push('usage_report_runner_disabled');
    } else if (query.runnerHealth.last_status === 'failed') {
      warnings.push('usage_report_runner_last_run_failed');
      if (requiredSchedules.length > 0) blockers.push('usage_report_runner_last_run_failed');
    } else if (activeSchedules.length > 0 && !query.runnerHealth.last_completed_at) {
      warnings.push('usage_report_runner_not_yet_executed');
      if (requiredSchedules.length > 0) blockers.push('usage_report_runner_not_yet_executed');
    }
  }

  return {
    source: 'artifact',
    generated_at: now,
    release_readiness: blockers.length > 0 ? 'blocked' : 'ready',
    blockers,
    warnings,
    active_schedules: activeSchedules.length,
    required_schedules: requiredSchedules.length,
    successful_deliveries_last_7d: successful,
    failed_deliveries_last_7d: failed,
    unacknowledged_required_deliveries: unacknowledgedRequired,
    runner_health: query.runnerHealth,
  };
}
