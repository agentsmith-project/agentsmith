import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function runtimeReadinessPolicyPath() {
  try {
    const policyUrl = new URL('./runtime-readiness-policy.json', import.meta.url);
    if (policyUrl.protocol === 'file:') {
      return fileURLToPath(policyUrl);
    }
  } catch {
    // Fall through to the repo-root path used by Vitest's transformed module URLs.
  }
  return path.resolve(process.cwd(), 'scripts/governance/runtime-readiness-policy.json');
}

export const RUNTIME_READINESS_POLICY = JSON.parse(
  fs.readFileSync(runtimeReadinessPolicyPath(), 'utf8'),
);

function runtimeReadinessPolicyEvidence() {
  return {
    schema_version: RUNTIME_READINESS_POLICY.schema_version,
    theme: RUNTIME_READINESS_POLICY.theme,
    backoff: RUNTIME_READINESS_POLICY.backoff,
    interval_ms: RUNTIME_READINESS_POLICY.interval_ms,
    evidence_focus: RUNTIME_READINESS_POLICY.evidence_focus,
    state_convergence: RUNTIME_READINESS_POLICY.state_convergence,
  };
}

function readIfFile(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? fs.readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

function normalizeKey(key) {
  return key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`).toLowerCase();
}

function readFields(line) {
  const fields = {};
  const pattern = /\b(request_id|requestId|correlation_id|correlationId|workload_id|workloadId|phase|status|http_status|httpStatus|status_code|statusCode|error_code|errorCode|code|asbcp_code|asbcpCode|pod_name|podName|retryable|operation|operation_id|operationId|call|readiness_reason|readinessReason|readiness_message|readinessMessage|retry_after|retryAfter)=("[^"]*"|'[^']*'|[^\s,;]+)/gu;
  for (const match of line.matchAll(pattern)) {
    const rawValue = match[2] ?? '';
    fields[normalizeKey(match[1] ?? '')] = rawValue.replace(/^["']|["']$/g, '');
  }
  if (fields.correlation_id && !fields.request_id) {
    fields.request_id = fields.correlation_id;
  }
  if (fields.code && !fields.error_code) {
    fields.error_code = fields.code;
  }
  if (fields.operation_id && !fields.operation) {
    fields.operation = fields.operation_id;
  }
  if (fields.operation && !fields.call) {
    fields.call = fields.operation;
  }
  if (/asbcp_network_error/u.test(line) && !fields.error_code) {
    fields.error_code = 'asbcp_network_error';
  }
  if (/agent_runner_runtime_unavailable/u.test(line) && !fields.error_code) {
    fields.error_code = 'agent_runner_runtime_unavailable';
  }
  if (/ASBCP readyz preflight failed/u.test(line) && !fields.call) {
    fields.call = 'asbcp_readyz_preflight';
  }
  if (/create_terminal_session_failed/u.test(line) && !fields.call) {
    fields.call = 'create_terminal_session';
  }
  if (/AGENT_SANDBOX_STARTUP_TIMEOUT/u.test(line) && !fields.error_code) {
    fields.error_code = 'AGENT_SANDBOX_STARTUP_TIMEOUT';
  }
  if (/AGENT_SANDBOX_UNAVAILABLE/u.test(line) && !fields.error_code) {
    fields.error_code = 'AGENT_SANDBOX_UNAVAILABLE';
  }
  if (/AGENT_SANDBOX_RELEASE_INCOMPLETE/u.test(line) && !fields.error_code) {
    fields.error_code = 'AGENT_SANDBOX_RELEASE_INCOMPLETE';
  }
  if (/FailedScheduling/u.test(line) && !fields.error_code) {
    fields.error_code = 'FailedScheduling';
  }
  if (/(pod_unschedulable|Unschedulable)/u.test(line) && !fields.error_code) {
    fields.error_code = 'pod_unschedulable';
  }
  if (/workspace_pvc_unbound/u.test(line) && !fields.error_code) {
    fields.error_code = 'workspace_pvc_unbound';
  }
  if (/Insufficient cpu/u.test(line) && !fields.readiness_reason) {
    fields.readiness_reason = 'Insufficient cpu';
  }
  if (/FailedScheduling/u.test(line) && !fields.call) {
    fields.call = 'schedule_pod';
  }
  return fields;
}

function classifySource(line) {
  if (/FailedScheduling|Insufficient cpu|pod_unschedulable|Unschedulable|workspace_pvc_unbound/u.test(line)) {
    return 'k8s_event';
  }
  if (/asbcp_workload_status|ASBCP|create\/status/u.test(line)) {
    return 'asbcp_create_status';
  }
  if (/workspacebinding\/|AFSCP mount reference unavailable before release/u.test(line)) {
    return 'asbcp_create_status';
  }
  if (/\bAPI\b|\bapi\b/u.test(line)) {
    return 'api';
  }
  if (/agent_runner_runtime_unavailable|create_terminal_session_failed/u.test(line)) {
    return 'api';
  }
  if (/pod[ _-]?manager|create_or_ensure_pod|get_pod_status|delete_pod/u.test(line)) {
    return 'pod_manager';
  }
  return null;
}

function readCall(line, source) {
  const calls = [
    'create_or_ensure_pod',
    'get_pod_status',
    'delete_pod',
    'createWorkloadMountBinding',
    'getWorkloadMountBinding',
    'releaseWorkloadMountBinding',
    'revokeWorkloadMountBinding',
    'delete_workspace_binding',
    'createExport',
    'revokeExport',
    'getOperation',
    'updateWorkloadMountBindingStatus',
  ];
  const found = calls.find((call) => line.includes(call));
  if (found) {
    return found;
  }
  if (source === 'asbcp_create_status' && /create\/status/u.test(line)) {
    return 'create/status';
  }
  if (source === 'asbcp_create_status' && /asbcp_workload_status/u.test(line)) {
    return 'workload_status';
  }
  if (source === 'asbcp_create_status' && /workspacebinding\/|AFSCP mount reference unavailable before release/u.test(line)) {
    return 'releaseWorkloadMountBinding';
  }
  return undefined;
}

function readJsonPayload(line) {
  const start = line.indexOf('{');
  if (start < 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(line.slice(start));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function stringValue(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function lastStringValue(value) {
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const candidate = stringValue(value[index]);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }
  return stringValue(value);
}

function statusCodeValue(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    const normalized = stringValue(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function statusTextValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function podManagerSummaryRequestId(podManagerSummary, podManager, diagnostic) {
  return stringValue(podManagerSummary.latest_request_id)
    ?? stringValue(podManagerSummary.latestRequestId)
    ?? stringValue(podManagerSummary.request_id)
    ?? stringValue(podManagerSummary.requestId)
    ?? lastStringValue(podManagerSummary.request_ids)
    ?? lastStringValue(podManagerSummary.requestIds)
    ?? lastStringValue(podManager?.request_ids)
    ?? lastStringValue(podManager?.requestIds)
    ?? stringValue(diagnostic.request_id)
    ?? stringValue(diagnostic.requestId);
}

function podManagerWorkloadId(podManager, diagnostic, api) {
  return stringValue(podManager?.workload_id)
    ?? stringValue(podManager?.workloadId)
    ?? stringValue(diagnostic?.workload_id)
    ?? stringValue(diagnostic?.workloadId)
    ?? stringValue(api?.workload_id)
    ?? stringValue(api?.workloadId);
}

function podManagerSummaryPhase(podManagerSummary) {
  return stringValue(podManagerSummary?.latest_phase)
    ?? stringValue(podManagerSummary?.latestPhase)
    ?? stringValue(podManagerSummary?.phase);
}

function podManagerSummaryErrorCode(podManagerSummary) {
  return stringValue(podManagerSummary?.latest_error_code)
    ?? stringValue(podManagerSummary?.latestErrorCode)
    ?? stringValue(podManagerSummary?.error_code)
    ?? stringValue(podManagerSummary?.errorCode);
}

function runtimeReadinessErrorCode(...values) {
  for (const value of values) {
    const normalized = stringValue(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function addSignal(signals, seen, input) {
  const signal = {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = stringValue(value);
    if (normalized !== undefined) {
      signal[key] = normalized;
    }
  }
  const errorCode = signal.error_code ?? signal.code ?? signal.asbcp_code;
  if (
    (
      errorCode === 'AGENT_SANDBOX_UNAVAILABLE'
      || errorCode === 'AGENT_SANDBOX_STARTUP_TIMEOUT'
      || errorCode === 'AGENT_SANDBOX_RATE_LIMITED'
      || errorCode === 'AGENT_SANDBOX_RELEASE_INCOMPLETE'
      || errorCode === 'FailedScheduling'
      || errorCode === 'pod_unschedulable'
      || errorCode === 'workspace_pvc_unbound'
      || errorCode === 'agent_runner_runtime_unavailable'
      || errorCode === 'asbcp_network_error'
    )
    && (
      signal.source === 'api'
      || signal.source === 'pod_manager'
      || signal.source === 'asbcp_create_status'
      || signal.source === 'k8s_event'
    )
    && !signal.phase
  ) {
    signal.phase = 'unknown';
  }
  if (!signal.source) {
    return;
  }
  if (Object.keys(signal).every((key) => key === 'source' || key === 'source_log' || key === 'line_number')) {
    return;
  }
  const key = JSON.stringify(signal);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  signals.push(signal);
}

function appendAfscpRequestJsonSignal(line, sourceLog, lineNumber, signals, seen) {
  const parsed = readJsonPayload(line);
  if (!parsed || typeof parsed !== 'object' || parsed.event !== 'afscp.request') {
    return false;
  }
  const operation = stringValue(parsed.operation_id)
    ?? stringValue(parsed.operationId)
    ?? stringValue(parsed.operation);
  if (!operation) {
    return false;
  }
  addSignal(signals, seen, {
    source: 'api',
    source_log: sourceLog,
    line_number: lineNumber,
    call: operation,
    operation,
    request_id: parsed.correlation_id ?? parsed.correlationId ?? parsed.request_id ?? parsed.requestId,
    status_code: parsed.status ?? parsed.status_code ?? parsed.statusCode,
    http_status: parsed.http_status ?? parsed.httpStatus,
  });
  return true;
}

function buildDerivedOwnerSummary(input) {
  const status = typeof input.diagnostic.status === 'string'
    ? input.diagnostic.status
    : statusTextValue(input.api.status, input.summaryStatus);
  const statusCode = typeof input.diagnostic.status === 'number'
    ? input.diagnostic.status
    : statusCodeValue(
      input.diagnostic.status_code,
      input.diagnostic.statusCode,
      input.api.status_code,
      input.api.statusCode,
      input.summaryStatusCode,
    );
  const phase = input.diagnostic.phase ?? input.api.phase ?? input.summaryPhase ?? (
    input.summaryErrorCode ? 'unknown' : undefined
  );
  return {
    source: input.source,
    source_log: input.sourceLog,
    line_number: input.lineNumber,
    call: input.call,
    operation: input.call,
    outcome: input.summaryErrorCode ? 'error' : undefined,
    request_id: input.requestId,
    workload_id: input.workloadId,
    phase,
    status,
    status_code: statusCode,
    http_status: input.diagnostic.http_status ?? input.diagnostic.httpStatus ?? input.api.http_status ?? input.api.httpStatus,
    error_code: input.summaryErrorCode,
    mapped_error_code: input.diagnostic.mapped_error_code ?? input.diagnostic.mappedErrorCode,
    retryable: input.diagnostic.retryable ?? input.api.retryable,
    readiness_reason: input.diagnostic.readiness_reason ?? input.diagnostic.readinessReason ?? input.api.readiness_reason ?? input.api.readinessReason,
    readiness_message: input.diagnostic.readiness_message ?? input.diagnostic.readinessMessage ?? input.api.readiness_message ?? input.api.readinessMessage,
    retry_after: input.diagnostic.retry_after ?? input.diagnostic.retryAfter ?? input.api.retry_after ?? input.api.retryAfter,
    evidence: 'derived_from_runtime_failure_diagnostic',
  };
}

function appendDerivedRuntimeFailureOwnerSummaries(input) {
  if (!input.call || !input.requestId || !input.workloadId || !input.summaryErrorCode) {
    return;
  }
  if (!hasRuntimeSummaryStatus(input)) {
    return;
  }
  if (input.hasPodManagerEvidence || input.hasAsbcpEvidence) {
    return;
  }
  addSignal(input.signals, input.seen, buildDerivedOwnerSummary({
    ...input,
    source: 'pod_manager',
  }));
  addSignal(input.signals, input.seen, buildDerivedOwnerSummary({
    ...input,
    source: 'asbcp_create_status',
  }));
}

function hasRuntimeSummaryStatus(input) {
  return input.summaryStatus !== undefined
    || input.summaryStatusCode !== undefined
    || input.diagnostic.status !== undefined
    || input.diagnostic.status_code !== undefined
    || input.diagnostic.statusCode !== undefined
    || input.diagnostic.http_status !== undefined
    || input.diagnostic.httpStatus !== undefined
    || input.api.status !== undefined
    || input.api.status_code !== undefined
    || input.api.statusCode !== undefined
    || input.api.http_status !== undefined
    || input.api.httpStatus !== undefined;
}

function appendRuntimeReadinessJsonSignals(line, sourceLog, lineNumber, signals, seen) {
  const parsed = readJsonPayload(line);
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }
  const diagnostic = objectValue(parsed.diagnostic) ?? {};
  const api = objectValue(parsed.api) ?? objectValue(parsed.API) ?? {};
  const sandboxDiagnostics = objectValue(diagnostic.sandbox_diagnostics)
    ?? objectValue(diagnostic.sandboxDiagnostics);
  const podManager = objectValue(diagnostic.pod_manager)
    ?? objectValue(diagnostic.podManager)
    ?? objectValue(parsed.pod_manager)
    ?? objectValue(parsed.podManager)
    ?? sandboxDiagnostics
    ?? {};
  if (
    Object.keys(diagnostic).length === 0
    && Object.keys(api).length === 0
    && Object.keys(podManager).length === 0
  ) {
    return false;
  }
  const podManagerSummary = objectValue(podManager.pod_manager_summary)
    ?? objectValue(podManager.podManagerSummary);
  const summaryRequestId = podManagerSummary
    ? podManagerSummaryRequestId(podManagerSummary, podManager, diagnostic)
    : undefined;
  const summaryWorkloadId = podManagerWorkloadId(podManager, diagnostic, api);
  const summaryPhase = podManagerSummaryPhase(podManagerSummary);
  const summaryErrorCode = runtimeReadinessErrorCode(
    diagnostic.error_code,
    diagnostic.errorCode,
    diagnostic.code,
    api.error_code,
    api.errorCode,
    api.code,
    podManagerSummaryErrorCode(podManagerSummary),
  );
  const summaryStatus = statusTextValue(
    podManagerSummary?.latest_status,
    podManagerSummary?.latestStatus,
    podManagerSummary?.status,
    summaryPhase,
  );
  const summaryStatusCode = statusCodeValue(
    podManagerSummary?.latest_status_code,
    podManagerSummary?.latestStatusCode,
    podManagerSummary?.status_code,
    podManagerSummary?.statusCode,
  );
  const summaryCall = diagnostic.operation
    ?? api.operation
    ?? podManagerSummary?.latest_operation
    ?? podManagerSummary?.latestOperation;
  addSignal(signals, seen, {
    source: 'api',
    source_log: sourceLog,
    line_number: lineNumber,
    call: summaryCall,
    operation: summaryCall,
    request_id: diagnostic.request_id ?? diagnostic.requestId ?? api.request_id ?? api.requestId ?? summaryRequestId,
    workload_id: diagnostic.workload_id ?? diagnostic.workloadId ?? api.workload_id ?? api.workloadId ?? summaryWorkloadId,
    phase: diagnostic.phase ?? api.phase ?? summaryPhase,
    status: typeof diagnostic.status === 'string' ? diagnostic.status : statusTextValue(api.status, summaryStatus),
    status_code: typeof diagnostic.status === 'number'
      ? diagnostic.status
      : statusCodeValue(diagnostic.status_code, diagnostic.statusCode, api.status_code, api.statusCode, summaryStatusCode),
    http_status: diagnostic.http_status ?? diagnostic.httpStatus ?? api.http_status ?? api.httpStatus,
    error_code: summaryErrorCode,
    mapped_error_code: diagnostic.mapped_error_code ?? diagnostic.mappedErrorCode,
    retryable: diagnostic.retryable ?? api.retryable,
    readiness_reason: diagnostic.readiness_reason ?? diagnostic.readinessReason ?? api.readiness_reason ?? api.readinessReason,
    readiness_message: diagnostic.readiness_message ?? diagnostic.readinessMessage ?? api.readiness_message ?? api.readinessMessage,
    retry_after: diagnostic.retry_after ?? diagnostic.retryAfter ?? api.retry_after ?? api.retryAfter,
  });

  const apiTrace = Array.isArray(diagnostic.api_trace)
    ? diagnostic.api_trace
    : (Array.isArray(podManager?.api_trace) ? podManager.api_trace : []);
  for (const entry of apiTrace) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    addSignal(signals, seen, {
      source: 'api',
      source_log: sourceLog,
      line_number: lineNumber,
      call: entry.operation,
      outcome: entry.outcome,
      request_id: entry.request_id ?? entry.requestId ?? (entry.outcome === 'error' ? summaryRequestId : undefined),
      workload_id: entry.workload_id ?? entry.workloadId ?? summaryWorkloadId,
      phase: entry.phase ?? (entry.outcome === 'error' ? summaryPhase : undefined),
      status: typeof entry.status === 'string' ? entry.status : (entry.outcome === 'error' ? summaryStatus : undefined),
      status_code: statusCodeValue(entry.status_code, entry.statusCode, typeof entry.status === 'number' ? entry.status : undefined, entry.outcome === 'error' ? summaryStatusCode : undefined),
      http_status: entry.http_status ?? entry.httpStatus,
      error_code: entry.error_code ?? entry.errorCode ?? entry.code ?? (entry.outcome === 'error' ? summaryErrorCode : undefined),
      asbcp_code: entry.asbcp_code ?? entry.asbcpCode,
      retryable: entry.retryable,
      readiness_reason: entry.readiness_reason ?? entry.readinessReason,
      readiness_message: entry.readiness_message ?? entry.readinessMessage,
      retry_after: entry.retry_after ?? entry.retryAfter,
    });
  }

  if (podManagerSummary && typeof podManagerSummary === 'object') {
    addSignal(signals, seen, {
      source: 'pod_manager',
      source_log: sourceLog,
      line_number: lineNumber,
      call: podManagerSummary.latest_operation ?? podManagerSummary.latestOperation,
      outcome: podManagerSummary.latest_outcome ?? podManagerSummary.latestOutcome,
      request_id: podManagerSummaryRequestId(podManagerSummary, podManager, diagnostic),
      workload_id: podManagerSummary.workload_id ?? podManagerSummary.workloadId ?? summaryWorkloadId,
      phase: podManagerSummary.latest_phase ?? podManagerSummary.latestPhase ?? summaryPhase,
      status: statusTextValue(podManagerSummary.latest_status, podManagerSummary.latestStatus, podManagerSummary.status, summaryStatus),
      status_code: statusCodeValue(podManagerSummary.latest_status_code, podManagerSummary.latestStatusCode),
      http_status: podManagerSummary.latest_http_status ?? podManagerSummary.latestHttpStatus,
      error_code: podManagerSummary.latest_error_code ?? podManagerSummary.latestErrorCode ?? summaryErrorCode,
      asbcp_code: podManagerSummary.latest_asbcp_code ?? podManagerSummary.latestAsbcpCode,
      readiness_reason: podManagerSummary.latest_readiness_reason ?? podManagerSummary.latestReadinessReason,
      readiness_message: podManagerSummary.latest_readiness_message ?? podManagerSummary.latestReadinessMessage,
      retry_after: podManagerSummary.latest_retry_after ?? podManagerSummary.latestRetryAfter,
    });
  }

  const asbcpCallSummaries = Array.isArray(podManager?.asbcp_call_summaries)
    ? podManager.asbcp_call_summaries
    : (Array.isArray(podManager?.asbcpCallSummaries) ? podManager.asbcpCallSummaries : []);
  for (const entry of asbcpCallSummaries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    addSignal(signals, seen, {
      source: 'asbcp_create_status',
      source_log: sourceLog,
      line_number: lineNumber,
      call: entry.operation,
      outcome: entry.outcome,
      request_id: entry.request_id ?? entry.requestId ?? (entry.outcome === 'error' ? summaryRequestId : undefined),
      workload_id: entry.workload_id ?? entry.workloadId ?? summaryWorkloadId,
      phase: entry.phase ?? (entry.outcome === 'error' ? summaryPhase : undefined),
      status: typeof entry.status === 'string' ? entry.status : (entry.outcome === 'error' ? summaryStatus : undefined),
      status_code: statusCodeValue(entry.status_code, entry.statusCode, typeof entry.status === 'number' ? entry.status : undefined, entry.outcome === 'error' ? summaryStatusCode : undefined),
      http_status: entry.http_status ?? entry.httpStatus,
      error_code: entry.error_code ?? entry.errorCode ?? entry.code ?? (entry.outcome === 'error' ? summaryErrorCode : undefined),
      asbcp_code: entry.asbcp_code ?? entry.asbcpCode,
      retryable: entry.retryable,
      readiness_reason: entry.readiness_reason ?? entry.readinessReason,
      readiness_message: entry.readiness_message ?? entry.readinessMessage,
      retry_after: entry.retry_after ?? entry.retryAfter,
    });
  }

  const steps = Array.isArray(podManager?.steps) ? podManager.steps : [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') {
      continue;
    }
    addSignal(signals, seen, {
      source: 'pod_manager',
      source_log: sourceLog,
      line_number: lineNumber,
      call: step.operation,
      outcome: step.outcome,
      request_id: step.request_id ?? step.requestId ?? (step.outcome === 'error' ? summaryRequestId : undefined),
      workload_id: step.workload_id ?? step.workloadId ?? summaryWorkloadId,
      phase: step.phase ?? (step.outcome === 'error' ? summaryPhase : undefined),
      status: typeof step.status === 'string' ? step.status : undefined,
      status_code: statusCodeValue(typeof step.status === 'number' ? step.status : undefined, step.status_code, step.statusCode, step.outcome === 'error' ? summaryStatusCode : undefined),
      http_status: step.http_status ?? step.httpStatus,
      error_code: step.error_code ?? step.errorCode ?? step.code ?? (step.outcome === 'error' ? summaryErrorCode : undefined),
      asbcp_code: step.asbcp_code ?? step.asbcpCode,
      retryable: step.retryable,
      readiness_reason: step.readiness_reason ?? step.readinessReason,
      readiness_message: step.readiness_message ?? step.readinessMessage,
      retry_after: step.retry_after ?? step.retryAfter,
    });
  }
  appendDerivedRuntimeFailureOwnerSummaries({
    signals,
    seen,
    sourceLog,
    lineNumber,
    call: summaryCall,
    requestId: diagnostic.request_id ?? diagnostic.requestId ?? api.request_id ?? api.requestId ?? summaryRequestId,
    workloadId: diagnostic.workload_id ?? diagnostic.workloadId ?? api.workload_id ?? api.workloadId ?? summaryWorkloadId,
    diagnostic,
    api,
    summaryPhase,
    summaryStatus,
    summaryStatusCode,
    summaryErrorCode,
    hasPodManagerEvidence: Boolean(podManagerSummary) || steps.length > 0,
    hasAsbcpEvidence: asbcpCallSummaries.length > 0,
  });
  return true;
}

export function parseRuntimeReadinessSignals(files) {
  const signals = [];
  const seen = new Set();
  for (const file of files) {
    const content = file.content ?? readIfFile(file.path);
    if (!content) {
      continue;
    }
    const sourceLog = path.basename(file.path);
    for (const [index, line] of content.split(/\r?\n/u).entries()) {
      if (!/AGENT_SANDBOX_STARTUP_TIMEOUT|AGENT_SANDBOX_UNAVAILABLE|AGENT_SANDBOX_RATE_LIMITED|AGENT_SANDBOX_RELEASE_INCOMPLETE|AGENT_UPSTREAM_ERROR|FailedScheduling|Insufficient cpu|pod_unschedulable|Unschedulable|workspace_pvc_unbound|readiness_reason|readinessReason|readiness_message|readinessMessage|retry_after|retryAfter|agent_runner_runtime_unavailable|asbcp_network_error|runtime_pending_readiness|request_id|requestId|correlation_id|correlationId|workload_id|workloadId|phase|status=|"status"\s*:|http_status|httpStatus|status_code|statusCode|error_code|errorCode|code=|operation=|operation_id|operationId|call=|asbcp_code|asbcpCode|pod[ _-]?manager|ASBCP|asbcp_workload_status|createWorkloadMountBinding|getWorkloadMountBinding|releaseWorkloadMountBinding|revokeWorkloadMountBinding|updateWorkloadMountBindingStatus|delete_workspace_binding|workspacebinding\/|create_or_ensure_pod|get_pod_status|create_terminal_session_failed|pending|releasing|offline|not_found/u.test(line)) {
        continue;
      }
      if (appendRuntimeReadinessJsonSignals(line, sourceLog, index + 1, signals, seen)) {
        continue;
      }
      if (appendAfscpRequestJsonSignal(line, sourceLog, index + 1, signals, seen)) {
        continue;
      }
      const source = classifySource(line);
      if (!source) {
        continue;
      }
      const fields = readFields(line);
      const signal = {
        source,
        source_log: sourceLog,
        line_number: index + 1,
        ...fields,
      };
      const call = readCall(line, source);
      if (call) {
        signal.call = call;
      }
      addSignal(signals, seen, signal);
    }
  }
  return signals.slice(-80);
}

export function parseK8sPodsFromText(content) {
  if (!content) {
    return [];
  }
  const pods = [];
  let current = {};
  for (const line of content.split(/\r?\n/u)) {
    if (line === '---') {
      if (current.pod || current.phase) {
        pods.push(current);
      }
      current = {};
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key === 'pod' || key === 'phase' || key === 'conditions' || key === 'containers' || key === 'init_containers') {
      current[key] = value;
    }
  }
  if (current.pod || current.phase) {
    pods.push(current);
  }
  return pods;
}

const SUMMARY_FIELDS = [
  'source',
  'source_log',
  'line_number',
  'call',
  'outcome',
  'request_id',
  'workload_id',
  'phase',
  'status',
  'status_code',
  'http_status',
  'error_code',
  'asbcp_code',
  'mapped_error_code',
  'retryable',
  'readiness_reason',
  'readiness_message',
  'retry_after',
];

function compactRuntimeSignal(signal) {
  const summary = {};
  for (const field of SUMMARY_FIELDS) {
    const value = stringValue(signal[field]);
    if (value !== undefined) {
      summary[field] = value;
    }
  }
  return summary;
}

function latestRuntimeSignalSummary(signals, predicate) {
  for (let index = signals.length - 1; index >= 0; index -= 1) {
    const signal = signals[index];
    if (predicate(signal)) {
      return compactRuntimeSignal(signal);
    }
  }
  return undefined;
}

function runtimeSignalErrorCode(signal) {
  return stringValue(signal.error_code)
    ?? stringValue(signal.code)
    ?? stringValue(signal.asbcp_code)
    ?? stringValue(signal.mapped_error_code);
}

export function buildRuntimeReadinessDetails({
  generatedAt = new Date().toISOString(),
  podStatusText = '',
  logFiles,
}) {
  const signals = parseRuntimeReadinessSignals(logFiles);
  const report = {
    schema_version: 'agentsmith.runtime-readiness-details/v1',
    theme: RUNTIME_READINESS_POLICY.theme,
    generated_at: generatedAt,
    convergence_policy: runtimeReadinessPolicyEvidence(),
    classification_rules: RUNTIME_READINESS_POLICY.classification_rules,
    signals,
    call_summaries: signals,
    k8s_pods: parseK8sPodsFromText(podStatusText),
  };
  const failure = latestRuntimeSignalSummary(signals, (signal) => Boolean(runtimeSignalErrorCode(signal)));
  const api = latestRuntimeSignalSummary(signals, (signal) => signal.source === 'api' && Boolean(runtimeSignalErrorCode(signal)));
  const podManagerSummary = latestRuntimeSignalSummary(
    signals,
    (signal) => signal.source === 'pod_manager' && Boolean(runtimeSignalErrorCode(signal)),
  );
  if (failure) {
    report.failure = failure;
  }
  if (api) {
    report.api = api;
  }
  if (podManagerSummary) {
    report.pod_manager_summary = podManagerSummary;
  }
  return report;
}

export function writeRuntimeReadinessDetails(outputFile, podStatusFile, candidateFiles) {
  const report = buildRuntimeReadinessDetails({
    podStatusText: readIfFile(podStatusFile),
    logFiles: candidateFiles.map((file) => ({ path: file })),
  });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [outputFile, podStatusFile, ...candidateFiles] = process.argv.slice(2);
  if (!outputFile || !podStatusFile) {
    process.stderr.write('usage: node scripts/governance/runtime-readiness-details.mjs <output-file> <pod-status-file> [log-file...]\n');
    process.exit(2);
  }
  writeRuntimeReadinessDetails(outputFile, podStatusFile, candidateFiles);
}
