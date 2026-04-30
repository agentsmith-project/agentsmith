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
  requestId?: string | null;
  decisionId?: string | null;
  traceRef?: string | null;
  traceIncidentId?: string | null;
  traceEscalationId?: string | null;
  traceRunId?: string | null;
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
  | 'workspaceId'
  | 'projectId'
  | 'startTime'
  | 'endTime'
  | 'resourceType'
  | 'resourceId'
  | 'endUserId'
  | 'provider'
  | 'model'
  | 'requestId'
  | 'decisionId'
  | 'traceRef'
  | 'traceIncidentId'
  | 'traceEscalationId'
  | 'traceRunId'
  | 'result'
  | 'errorClass'
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
  resource_type: 'endpoint' | 'file_library' | 'agent';
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
  window: 'minute' | '5h' | 'day';
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
  endpoints: EndpointLimitSummary[];
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
