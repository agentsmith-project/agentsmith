import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type JsonObject = Record<string, unknown>;

const RUN_ID = 'agent-runner-lifecycle-local-test';
const REQUIRED_REPORTS = [
  ['agent_runner.default_managed.read_only', 'agent_runner.default_managed.read_only.json'],
  ['agent_runner.developer.key_lifecycle', 'agent_runner.developer.key_lifecycle.json'],
  ['agent_runner.developer.test_connection', 'agent_runner.developer.test_connection.json'],
  ['agent_runner.developer.test_task', 'agent_runner.developer.test_task.json'],
] as const;
const REQUIRED_FILES = ['manifest.json', ...REQUIRED_REPORTS.map(([, file]) => file)] as const;

function readJson(file: string): JsonObject {
  return JSON.parse(readFileSync(file, 'utf8')) as JsonObject;
}

function asRecord(value: unknown): JsonObject {
  expect(value).toBeTruthy();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

function stringValue(value: unknown): string {
  expect(typeof value).toBe('string');
  return value as string;
}

function booleanValue(value: unknown): boolean {
  expect(typeof value).toBe('boolean');
  return value as boolean;
}

function collectSensitiveFieldFailures(value: unknown, location: string, failures: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSensitiveFieldFailures(item, `${location}[${index}]`, failures));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [field, nested] of Object.entries(value)) {
      const nestedLocation = `${location}.${field}`;
      if (
        /(?:^|_)(?:secret|token|password|authorization|bearer|private_key|api_key|access_token|refresh_token|key_material|key_value|key_secret|raw_diagnostics|env_dump|connection_string)(?:$|_)/i.test(
          field,
        )
      ) {
        failures.push(nestedLocation);
      }
      collectSensitiveFieldFailures(nested, nestedLocation, failures);
    }
  }
}

function collectSensitiveValueFailures(value: unknown, location: string, failures: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSensitiveValueFailures(item, `${location}[${index}]`, failures));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [field, nested] of Object.entries(value)) {
      collectSensitiveValueFailures(nested, `${location}.${field}`, failures);
    }
    return;
  }
  if (typeof value !== 'string') {
    return;
  }
  if (
    /sk-[A-Za-z0-9_-]{8,}/.test(value)
    || /Bearer\s+[A-Za-z0-9._-]+/i.test(value)
    || /-----BEGIN (?:RSA |EC |OPENSSH |PRIVATE )?KEY-----/.test(value)
    || /password=/i.test(value)
  ) {
    failures.push(location);
  }
}

describe('agent runner lifecycle evidence producer', () => {
  it('writes the local focused manifest and required namespace reports without live backend-real claims', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'agent-runner-lifecycle-evidence-'));
    const runsDir = path.join(tempRoot, 'artifacts/backend-real/runs');

    try {
      const result = spawnSync('bash', ['scripts/agent-runner-lifecycle-evidence-gate.sh'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BACKEND_REAL_RUNS_DIR: runsDir,
          AGENT_RUNNER_LIFECYCLE_EVIDENCE_RUN_ID: RUN_ID,
          AGENT_RUNNER_LIFECYCLE_EVIDENCE_CAPABILITY_LINE: 'local_focused:test_no_backend_real',
        },
        encoding: 'utf8',
      });

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

      const evidenceDir = path.join(runsDir, RUN_ID, 'agent-runner-lifecycle');
      for (const file of REQUIRED_FILES) {
        expect(existsSync(path.join(evidenceDir, file)), file).toBe(true);
      }

      const manifest = readJson(path.join(evidenceDir, 'manifest.json'));
      expect(manifest.schema_version).toBe('agent-runner-lifecycle-evidence-manifest.v1');
      expect(manifest.run_id).toBe(RUN_ID);
      expect(manifest.evidence_mode).toBe('local_focused_contract');
      expect(manifest.capability_line).toBe('local_focused:test_no_backend_real');
      expect(manifest.environment_capability_line).toBe('local_focused:test_no_backend_real');
      expect(booleanValue(manifest.backend_real_executed)).toBe(false);
      expect(manifest.result).toBe('pass');
      expect(stringValue(manifest.git_sha).length).toBeGreaterThan(0);
      expect(manifest.default_artifact_path_template).toBe(
        'artifacts/backend-real/runs/<run-id>/agent-runner-lifecycle/',
      );

      const producer = asRecord(manifest.producer);
      expect(producer.id).toBe('agent-runner-lifecycle-local-evidence');
      expect(producer.command_entrypoint).toBe('npm run test:agent-runners:lifecycle:evidence');
      expect(producer.script_entrypoint).toBe('scripts/agent-runner-lifecycle-evidence-gate.sh');

      const manifestRelatedIds = asRecord(manifest.related_ids);
      for (const values of Object.values(manifestRelatedIds)) {
        expect(values).toEqual([]);
      }

      const namespaces = asArray(manifest.namespaces).map((entry) => asRecord(entry).namespace);
      expect(namespaces).toEqual(REQUIRED_REPORTS.map(([namespace]) => namespace));

      for (const [namespace, file] of REQUIRED_REPORTS) {
        const report = readJson(path.join(evidenceDir, file));
        expect(report.schema_version).toBe('agent-runner-lifecycle-report.v1');
        expect(report.producer_id).toBe('agent-runner-lifecycle-local-evidence');
        expect(report.report_namespace).toBe(namespace);
        expect(report.namespace).toBe(namespace);
        expect(report.evidence_mode).toBe('local_focused_contract');
        expect(report.capability_line).toBe('local_focused:test_no_backend_real');
        expect(booleanValue(report.backend_real_executed)).toBe(false);
        expect(report.result).toBe('pass');
        expect(asArray(report.checks).length).toBeGreaterThan(0);

        const relatedIds = asRecord(report.related_ids);
        for (const values of Object.values(relatedIds)) {
          expect(values).toEqual([]);
        }

        const redactionAssertion = asRecord(report.redaction_assertion);
        expect(redactionAssertion.result).toBe('pass');
        expect(redactionAssertion.sensitive_material_written).toBe(false);
      }

      const payloads = REQUIRED_FILES.map((file) => readJson(path.join(evidenceDir, file)));
      const fieldFailures: string[] = [];
      const valueFailures: string[] = [];
      payloads.forEach((payload, index) => {
        collectSensitiveFieldFailures(payload, REQUIRED_FILES[index], fieldFailures);
        collectSensitiveValueFailures(payload, REQUIRED_FILES[index], valueFailures);
      });
      expect(fieldFailures).toEqual([]);
      expect(valueFailures).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps the npm entrypoint and run-scoped helper conventions explicit', () => {
    const packageJson = readJson('package.json');
    const scripts = asRecord(packageJson.scripts);
    expect(scripts['test:agent-runners:lifecycle:evidence']).toBe(
      'bash scripts/agent-runner-lifecycle-evidence-gate.sh',
    );

    const script = readFileSync('scripts/agent-runner-lifecycle-evidence-gate.sh', 'utf8');
    expect(script).toContain('source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"');
    expect(script).toContain('source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"');
    expect(script).toContain('backend_real_generate_run_id');
    expect(script).toContain('artifacts/backend-real/runs/<run-id>/agent-runner-lifecycle/');
  });
});
