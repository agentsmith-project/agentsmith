import type { PaginationParams } from './common';

export interface AuditEvent {
  id: string;
  timestamp: string;
  workspace_id: string;
  project_id: string;
  actor_type: 'user' | 'runner' | 'plugin' | string;
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
  trace_ref?: string;
  trace_incident_id?: string;
  trace_escalation_id?: string;
  trace_run_id?: string;
  metadata_json: Record<string, unknown>;
}

export interface UsageRecord {
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
}

export interface UsageFactRequestDetails {
  provider?: string;
  resolved_model?: string;
  error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
  fallback_hops?: number;
  pricing_source?: string | null;
  estimated_cost?: number | null;
  missing_price?: boolean;
  attempts?: Array<Record<string, unknown>>;
}

export interface UsageFactRecord {
  id: string;
  timestamp: string;
  workspace_id: string;
  project_id: string;
  resource_type: string;
  resource_id?: string;
  end_user_id?: string;
  request_id?: string;
  decision_id?: string;
  requests: number;
  duration_ms?: number;
  bytes_in?: number;
  bytes_out?: number;
  tokens_in?: number;
  tokens_out?: number;
  tokens_total?: number;
  result: 'ok' | 'error';
  error_code?: string;
  request_details?: UsageFactRequestDetails;
  metadata_json?: Record<string, unknown>;
}

export interface AuditListParams extends PaginationParams {
  start_time: string;
  end_time: string;
  action?: string;
  actor_type?: 'user' | 'runner' | 'plugin';
  actor_id?: string;
  end_user_id?: string;
  resource_type?: string;
  resource_id?: string;
  request_id?: string;
  decision_id?: string;
  trace_ref?: string;
  trace_incident_id?: string;
  trace_escalation_id?: string;
  trace_run_id?: string;
  result?: 'ok' | 'error';
  sort_by?: 'timestamp';
  sort_order?: 'asc' | 'desc';
}

export interface UsageListParams extends PaginationParams {
  start_time: string;
  end_time: string;
  resource_type?: string;
  resource_id?: string;
  end_user_id?: string;
  provider?: string;
  model?: string;
  request_id?: string;
  decision_id?: string;
  trace_ref?: string;
  trace_incident_id?: string;
  trace_escalation_id?: string;
  trace_run_id?: string;
  result?: 'ok' | 'error';
  error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
  group_by?: 'day' | 'hour' | 'minute';
  sort_by?: 'time_bucket' | 'resource_type' | 'requests';
  sort_order?: 'asc' | 'desc';
}
