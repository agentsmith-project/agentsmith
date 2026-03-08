export type SharedOpsResultFilter = 'ok' | 'error';
export type SharedOpsErrorClassFilter = 'provider_retryable' | 'provider_non_retryable' | 'system_error';

export type SharedOpsFilterContext = {
  start_time: string;
  end_time: string;
  provider?: string;
  model?: string;
  request_id?: string;
  decision_id?: string;
  trace_ref?: string;
  trace_incident_id?: string;
  trace_escalation_id?: string;
  trace_run_id?: string;
  result?: SharedOpsResultFilter;
  error_class?: SharedOpsErrorClassFilter;
};

type SearchParamReader = {
  get: (key: string) => string | null;
};

export function parseSharedOpsFilterContext(searchParams: SearchParamReader): Partial<SharedOpsFilterContext> {
  const resultValue = searchParams.get('result');
  const errorClassValue = searchParams.get('error_class');
  const parsed: Partial<SharedOpsFilterContext> = {};
  const startTime = searchParams.get('start_time');
  const endTime = searchParams.get('end_time');
  const provider = searchParams.get('provider');
  const model = searchParams.get('model');
  const requestId = searchParams.get('request_id');
  const decisionId = searchParams.get('decision_id');
  const traceRef = searchParams.get('trace_ref');
  const traceIncidentId = searchParams.get('trace_incident_id');
  const traceEscalationId = searchParams.get('trace_escalation_id');
  const traceRunId = searchParams.get('trace_run_id');

  if (startTime) parsed.start_time = startTime;
  if (endTime) parsed.end_time = endTime;
  if (provider) parsed.provider = provider;
  if (model) parsed.model = model;
  if (requestId) parsed.request_id = requestId;
  if (decisionId) parsed.decision_id = decisionId;
  if (traceRef) parsed.trace_ref = traceRef;
  if (traceIncidentId) parsed.trace_incident_id = traceIncidentId;
  if (traceEscalationId) parsed.trace_escalation_id = traceEscalationId;
  if (traceRunId) parsed.trace_run_id = traceRunId;
  if (resultValue === 'ok' || resultValue === 'error') parsed.result = resultValue;
  if (
    errorClassValue === 'provider_retryable'
    || errorClassValue === 'provider_non_retryable'
    || errorClassValue === 'system_error'
  ) {
    parsed.error_class = errorClassValue;
  }

  return parsed;
}

export function buildSharedOpsFilterQuery(
  filters: Partial<SharedOpsFilterContext>,
  extras: Record<string, string | undefined> = {},
  prefix: '?' | '&' = '?',
): string {
  const query = new URLSearchParams();
  const entries = {
    start_time: filters.start_time,
    end_time: filters.end_time,
    provider: filters.provider,
    model: filters.model,
    request_id: filters.request_id,
    decision_id: filters.decision_id,
    trace_ref: filters.trace_ref,
    trace_incident_id: filters.trace_incident_id,
    trace_escalation_id: filters.trace_escalation_id,
    trace_run_id: filters.trace_run_id,
    result: filters.result,
    error_class: filters.error_class,
    ...extras,
  };

  Object.entries(entries).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });

  const serialized = query.toString();
  return serialized ? `${prefix}${serialized}` : '';
}
