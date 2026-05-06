#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"

PRODUCER_ID="agent-runner-lifecycle-local-evidence"
SCRIPT_ENTRYPOINT="scripts/agent-runner-lifecycle-evidence-gate.sh"
COMMAND_ENTRYPOINT="${AGENT_RUNNER_LIFECYCLE_EVIDENCE_COMMAND:-npm run test:agent-runners:lifecycle:evidence}"
EVIDENCE_MODE="local_focused_contract"
CAPABILITY_LINE="${AGENT_RUNNER_LIFECYCLE_EVIDENCE_CAPABILITY_LINE:-local_focused:no_backend_real:no_live_runner:no_sensitive_material}"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

RUN_ID="${AGENT_RUNNER_LIFECYCLE_EVIDENCE_RUN_ID:-${BACKEND_REAL_RUN_ID:-$(backend_real_generate_run_id agent-runner-lifecycle)}}"
RUN_DIR="$(backend_real_runs_root)/${RUN_ID}"
EVIDENCE_DIR="${AGENT_RUNNER_LIFECYCLE_EVIDENCE_DIR:-${RUN_DIR}/agent-runner-lifecycle}"
mkdir -p "${EVIDENCE_DIR}"

GIT_SHA="$(cd "${ROOT_DIR}" && git rev-parse HEAD 2>/dev/null || printf 'unknown')"
if [[ -n "$(cd "${ROOT_DIR}" && git status --short 2>/dev/null || true)" ]]; then
  GIT_DIRTY="true"
else
  GIT_DIRTY="false"
fi

printf '%s\n' "${CAPABILITY_LINE}" > "${EVIDENCE_DIR}/capability-line.txt"
gate_write_runtime_descriptor "${EVIDENCE_DIR}" "local_focused"

FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node - <<'NODE' \
  "${ROOT_DIR}" \
  "${EVIDENCE_DIR}" \
  "${RUN_ID}" \
  "${PRODUCER_ID}" \
  "${COMMAND_ENTRYPOINT}" \
  "${SCRIPT_ENTRYPOINT}" \
  "${GIT_SHA}" \
  "${GIT_DIRTY}" \
  "${STARTED_AT}" \
  "${FINISHED_AT}" \
  "${EVIDENCE_MODE}" \
  "${CAPABILITY_LINE}"
const fs = require('node:fs');
const path = require('node:path');

const [
  rootDir,
  evidenceDir,
  runId,
  producerId,
  commandEntrypoint,
  scriptEntrypoint,
  gitSha,
  gitDirty,
  startedAt,
  finishedAt,
  evidenceMode,
  capabilityLine,
] = process.argv.slice(2);

const reportSpecs = [
  {
    namespace: 'agent_runner.default_managed.read_only',
    file: 'agent_runner.default_managed.read_only.json',
    summary: 'Local contract report for System managed Project default read-only evidence.',
    checks: [
      {
        id: 'namespace_declared',
        result: 'pass',
        evidence_basis: 'local_contract_manifest',
        statement: 'The report namespace is isolated from Developer runner lifecycle evidence.',
      },
      {
        id: 'project_default_scope_declared',
        result: 'pass',
        evidence_basis: 'local_contract_manifest',
        statement: 'The report contract is for System managed Project default behavior only.',
      },
      {
        id: 'backend_real_not_executed',
        result: 'pass',
        evidence_basis: 'local_capability_line',
        statement: 'This focused producer does not claim live default resolver, task, run, or audit proof.',
      },
      {
        id: 'developer_connection_not_required',
        result: 'pass',
        evidence_basis: 'local_contract_manifest',
        statement: 'Default managed evidence remains separate from local Developer runner connection evidence.',
      },
    ],
  },
  {
    namespace: 'agent_runner.developer.key_lifecycle',
    file: 'agent_runner.developer.key_lifecycle.json',
    summary: 'Local contract report for Developer runner connection credential lifecycle evidence.',
    checks: [
      {
        id: 'namespace_declared',
        result: 'pass',
        evidence_basis: 'local_contract_manifest',
        statement: 'Developer runner credential lifecycle evidence is isolated from System managed default evidence.',
      },
      {
        id: 'credential_material_omitted',
        result: 'pass',
        evidence_basis: 'allowlist_payload',
        statement: 'The local report declares lifecycle check slots without writing credential material.',
      },
      {
        id: 'backend_real_not_executed',
        result: 'pass',
        evidence_basis: 'local_capability_line',
        statement: 'No live create, rotate, revoke, disconnect, or reconnect operation is claimed by this producer.',
      },
    ],
  },
  {
    namespace: 'agent_runner.developer.test_connection',
    file: 'agent_runner.developer.test_connection.json',
    summary: 'Local contract report for Developer runner Test connection evidence.',
    checks: [
      {
        id: 'namespace_declared',
        result: 'pass',
        evidence_basis: 'local_contract_manifest',
        statement: 'Test connection evidence has its own Developer runner namespace.',
      },
      {
        id: 'side_effect_boundary_declared',
        result: 'pass',
        evidence_basis: 'local_contract_manifest',
        statement: 'The report contract marks Test connection as side-effect bounded and not a task/run producer.',
      },
      {
        id: 'backend_real_not_executed',
        result: 'pass',
        evidence_basis: 'local_capability_line',
        statement: 'No live ping, challenge, timeout, freshness, or capability result is claimed by this producer.',
      },
    ],
  },
  {
    namespace: 'agent_runner.developer.test_task',
    file: 'agent_runner.developer.test_task.json',
    summary: 'Local contract report for Developer runner dedicated test-task evidence.',
    checks: [
      {
        id: 'namespace_declared',
        result: 'pass',
        evidence_basis: 'local_contract_manifest',
        statement: 'Dedicated Developer runner test-task evidence has its own namespace.',
      },
      {
        id: 'development_evidence_only',
        result: 'pass',
        evidence_basis: 'local_contract_manifest',
        statement: 'The report contract marks Developer runner test-task evidence as development testing evidence only.',
      },
      {
        id: 'backend_real_not_executed',
        result: 'pass',
        evidence_basis: 'local_capability_line',
        statement: 'No live runner_test task, run, selection metadata, or audit proof is claimed by this producer.',
      },
    ],
  },
];

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function artifactPath(file) {
  const absolute = path.join(evidenceDir, file);
  const relative = path.relative(rootDir, absolute);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return toPosix(relative);
  }
  return toPosix(absolute);
}

function writeJson(file, payload) {
  fs.writeFileSync(path.join(evidenceDir, file), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function relatedIds() {
  return {
    task_ids: [],
    run_ids: [],
    runner_ids: [],
    terminal_session_ids: [],
    diagnostic_ids: [],
  };
}

function redactionAssertion(scannedFiles) {
  return {
    result: 'pass',
    policy_id: 'allowlist-no-sensitive-material-v1',
    assertion: 'Generated payloads use an allowlist shape and omit connection secrets, connection key material, auth headers, raw diagnostic dumps, and process dumps.',
    sensitive_material_written: false,
    scanned_artifact_paths: scannedFiles.map(artifactPath),
  };
}

function baseReport(spec, scannedFiles) {
  return {
    schema_version: 'agent-runner-lifecycle-report.v1',
    producer_id: producerId,
    command_entrypoint: commandEntrypoint,
    script_entrypoint: scriptEntrypoint,
    git_sha: gitSha,
    git_dirty: gitDirty === 'true',
    evidence_mode: evidenceMode,
    capability_line: capabilityLine,
    environment_capability_line: capabilityLine,
    report_namespace: spec.namespace,
    namespace: spec.namespace,
    backend_real_executed: false,
    result: 'pass',
    started_at: startedAt,
    finished_at: finishedAt,
    summary: spec.summary,
    checks: spec.checks,
    related_ids: relatedIds(),
    artifact_paths: {
      root: artifactPath('.'),
      manifest: artifactPath('manifest.json'),
      report: artifactPath(spec.file),
      runtime_descriptor: artifactPath('runtime.json'),
      capability_line: artifactPath('capability-line.txt'),
    },
    redaction_assertion: redactionAssertion(scannedFiles),
    limitations: [
      'backend_real_executed=false: this producer does not start services, create tasks, connect runners, or inspect live audit rows.',
      'The report is a local focused manifest contract for later backend-real producers to reuse.',
      'Developer runner evidence from this producer is development testing evidence only, not managed release proof.',
    ],
  };
}

const generatedFiles = [
  'manifest.json',
  'agent_runner.default_managed.read_only.json',
  'agent_runner.developer.key_lifecycle.json',
  'agent_runner.developer.test_connection.json',
  'agent_runner.developer.test_task.json',
];

const reports = reportSpecs.map((spec) => baseReport(spec, generatedFiles));
for (let index = 0; index < reportSpecs.length; index += 1) {
  writeJson(reportSpecs[index].file, reports[index]);
}

const manifest = {
  schema_version: 'agent-runner-lifecycle-evidence-manifest.v1',
  producer: {
    id: producerId,
    command_entrypoint: commandEntrypoint,
    script_entrypoint: scriptEntrypoint,
  },
  git_sha: gitSha,
  git_dirty: gitDirty === 'true',
  run_id: runId,
  evidence_mode: evidenceMode,
  capability_line: capabilityLine,
  environment_capability_line: capabilityLine,
  backend_real_executed: false,
  started_at: startedAt,
  finished_at: finishedAt,
  result: 'pass',
  default_artifact_path_template: 'artifacts/backend-real/runs/<run-id>/agent-runner-lifecycle/',
  related_ids: relatedIds(),
  namespaces: reports.map((report) => ({
    namespace: report.namespace,
    report_namespace: report.report_namespace,
    result: report.result,
    backend_real_executed: report.backend_real_executed,
    report_path: report.artifact_paths.report,
  })),
  artifact_paths: {
    root: artifactPath('.'),
    manifest: artifactPath('manifest.json'),
    runtime_descriptor: artifactPath('runtime.json'),
    capability_line: artifactPath('capability-line.txt'),
    reports: reports.map((report) => report.artifact_paths.report),
  },
  redaction_assertion: redactionAssertion(generatedFiles),
  limitations: [
    'This local focused producer records manifest/report shape only.',
    'It must not be read as live System managed default resolver proof.',
    'It must not be read as live Developer runner connection, Test connection, or runner_test task proof.',
  ],
};

writeJson('manifest.json', manifest);

const forbiddenFieldName = /(?:^|_)(?:secret|token|password|authorization|bearer|private_key|api_key|access_token|refresh_token|raw_diagnostics|env_dump|connection_string)(?:$|_)/i;
const forbiddenStringValues = [
  /sk-[A-Za-z0-9_-]{8,}/,
  /Bearer\s+[A-Za-z0-9._-]+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |PRIVATE )?KEY-----/,
  /password=/i,
];

function scan(value, location, failures) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${location}[${index}]`, failures));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const keyLocation = `${location}.${key}`;
      if (forbiddenFieldName.test(key)) {
        failures.push(`${keyLocation} uses a sensitive-looking field name`);
      }
      scan(nested, keyLocation, failures);
    }
    return;
  }
  if (typeof value === 'string') {
    for (const pattern of forbiddenStringValues) {
      if (pattern.test(value)) {
        failures.push(`${location} contains a sensitive-looking value`);
      }
    }
  }
}

const scanFailures = [];
for (const file of generatedFiles) {
  const payload = JSON.parse(fs.readFileSync(path.join(evidenceDir, file), 'utf8'));
  scan(payload, file, scanFailures);
}

if (scanFailures.length > 0) {
  process.stderr.write(`[agent-runner-lifecycle-evidence] redaction assertion failed:\n${scanFailures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`[agent-runner-lifecycle-evidence] wrote ${artifactPath('manifest.json')}\n`);
for (const report of reports) {
  process.stdout.write(`[agent-runner-lifecycle-evidence] wrote ${report.artifact_paths.report}\n`);
}
NODE
