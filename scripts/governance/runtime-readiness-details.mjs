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
  const pattern = /\b(request_id|requestId|workload_id|workloadId|phase|status|http_status|httpStatus|status_code|statusCode|error_code|errorCode|code|asbcp_code|asbcpCode|pod_name|podName|retryable|operation|call)=("[^"]*"|'[^']*'|[^\s,;]+)/gu;
  for (const match of line.matchAll(pattern)) {
    const rawValue = match[2] ?? '';
    fields[normalizeKey(match[1] ?? '')] = rawValue.replace(/^["']|["']$/g, '');
  }
  if (fields.code && !fields.error_code) {
    fields.error_code = fields.code;
  }
  if (fields.operation && !fields.call) {
    fields.call = fields.operation;
  }
  return fields;
}

function classifySource(line) {
  if (/asbcp_workload_status|ASBCP|create\/status/u.test(line)) {
    return 'asbcp_create_status';
  }
  if (/\bAPI\b|\bapi\b/u.test(line)) {
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

function addSignal(signals, seen, input) {
  const signal = {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = stringValue(value);
    if (normalized !== undefined) {
      signal[key] = normalized;
    }
  }
  if (!signal.source) {
    return;
  }
  const key = JSON.stringify(signal);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  signals.push(signal);
}

function appendRuntimeReadinessJsonSignals(line, sourceLog, lineNumber, signals, seen) {
  const parsed = readJsonPayload(line);
  const diagnostic = parsed?.diagnostic;
  if (!diagnostic || typeof diagnostic !== 'object') {
    return false;
  }
  addSignal(signals, seen, {
    source: 'api',
    source_log: sourceLog,
    line_number: lineNumber,
    request_id: diagnostic.request_id ?? diagnostic.requestId,
    workload_id: diagnostic.workload_id ?? diagnostic.workloadId,
    phase: diagnostic.phase,
    status: typeof diagnostic.status === 'string' ? diagnostic.status : undefined,
    status_code: typeof diagnostic.status === 'number' ? diagnostic.status : diagnostic.status_code ?? diagnostic.statusCode,
    error_code: diagnostic.error_code ?? diagnostic.errorCode,
    mapped_error_code: diagnostic.mapped_error_code ?? diagnostic.mappedErrorCode,
    operation: diagnostic.operation,
    call: diagnostic.operation,
    retryable: diagnostic.retryable,
  });

  const podManager = diagnostic.pod_manager ?? diagnostic.podManager;
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
      request_id: entry.request_id ?? entry.requestId,
      workload_id: entry.workload_id ?? entry.workloadId ?? podManager?.workload_id ?? podManager?.workloadId ?? diagnostic.workload_id ?? diagnostic.workloadId,
      phase: entry.phase,
      status: typeof entry.status === 'string' ? entry.status : undefined,
      status_code: typeof entry.status_code === 'number' ? entry.status_code : (typeof entry.statusCode === 'number' ? entry.statusCode : (typeof entry.status === 'number' ? entry.status : undefined)),
      http_status: entry.http_status ?? entry.httpStatus,
      error_code: entry.error_code ?? entry.errorCode ?? entry.code,
      asbcp_code: entry.asbcp_code ?? entry.asbcpCode,
      retryable: entry.retryable,
    });
  }

  const podManagerSummary = podManager?.pod_manager_summary ?? podManager?.podManagerSummary;
  if (podManagerSummary && typeof podManagerSummary === 'object') {
    addSignal(signals, seen, {
      source: 'pod_manager',
      source_log: sourceLog,
      line_number: lineNumber,
      call: podManagerSummary.latest_operation ?? podManagerSummary.latestOperation,
      outcome: podManagerSummary.latest_outcome ?? podManagerSummary.latestOutcome,
      workload_id: podManagerSummary.workload_id ?? podManagerSummary.workloadId ?? podManager?.workload_id ?? podManager?.workloadId ?? diagnostic.workload_id ?? diagnostic.workloadId,
      phase: podManagerSummary.latest_phase ?? podManagerSummary.latestPhase,
      status_code: podManagerSummary.latest_status_code ?? podManagerSummary.latestStatusCode,
      http_status: podManagerSummary.latest_http_status ?? podManagerSummary.latestHttpStatus,
      error_code: podManagerSummary.latest_error_code ?? podManagerSummary.latestErrorCode,
      asbcp_code: podManagerSummary.latest_asbcp_code ?? podManagerSummary.latestAsbcpCode,
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
      request_id: entry.request_id ?? entry.requestId,
      workload_id: entry.workload_id ?? entry.workloadId ?? podManager?.workload_id ?? podManager?.workloadId ?? diagnostic.workload_id ?? diagnostic.workloadId,
      phase: entry.phase,
      status: typeof entry.status === 'string' ? entry.status : undefined,
      status_code: typeof entry.status_code === 'number' ? entry.status_code : (typeof entry.statusCode === 'number' ? entry.statusCode : (typeof entry.status === 'number' ? entry.status : undefined)),
      http_status: entry.http_status ?? entry.httpStatus,
      error_code: entry.error_code ?? entry.errorCode ?? entry.code,
      asbcp_code: entry.asbcp_code ?? entry.asbcpCode,
      retryable: entry.retryable,
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
      request_id: step.request_id ?? step.requestId,
      workload_id: step.workload_id ?? step.workloadId ?? podManager?.workload_id ?? podManager?.workloadId ?? diagnostic.workload_id ?? diagnostic.workloadId,
      phase: step.phase,
      status: typeof step.status === 'string' ? step.status : undefined,
      status_code: typeof step.status === 'number' ? step.status : step.status_code ?? step.statusCode,
      error_code: step.error_code ?? step.errorCode ?? step.code,
      asbcp_code: step.asbcp_code ?? step.asbcpCode,
      retryable: step.retryable,
    });
  }
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
      if (!/AGENT_SANDBOX_UNAVAILABLE|AGENT_SANDBOX_RATE_LIMITED|runtime_pending_readiness|request_id|requestId|workload_id|workloadId|phase|status=|http_status|httpStatus|status_code|statusCode|error_code|errorCode|code=|operation=|call=|asbcp_code|asbcpCode|pod[ _-]?manager|ASBCP|asbcp_workload_status|create_or_ensure_pod|get_pod_status|pending|releasing|offline|not_found/u.test(line)) {
        continue;
      }
      if (appendRuntimeReadinessJsonSignals(line, sourceLog, index + 1, signals, seen)) {
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

export function buildRuntimeReadinessDetails({
  generatedAt = new Date().toISOString(),
  podStatusText = '',
  logFiles,
}) {
  const signals = parseRuntimeReadinessSignals(logFiles);
  return {
    schema_version: 'agentsmith.runtime-readiness-details/v1',
    theme: RUNTIME_READINESS_POLICY.theme,
    generated_at: generatedAt,
    convergence_policy: runtimeReadinessPolicyEvidence(),
    classification_rules: RUNTIME_READINESS_POLICY.classification_rules,
    signals,
    call_summaries: signals,
    k8s_pods: parseK8sPodsFromText(podStatusText),
  };
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
