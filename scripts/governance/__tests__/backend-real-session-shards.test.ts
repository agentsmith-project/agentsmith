import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

type SessionFixture = {
  apiEnvLog: string;
  apiStartLog: string;
  binDir: string;
  runRoot: string;
  scriptPath: string;
  stateRoot: string;
  tempRoot: string;
  webEnvLog: string;
  webStartLog: string;
};

const CHAT_BACKEND_REAL_SESSION_NAME = 'chat-backend-real-runner';

const CHAT_BACKEND_REAL_SHARDS = [
  {
    shardId: 'chat-runner-stream',
    specFile: 'e2e/integration-chat-llm-runner.spec.ts',
    grep: 'streams multi-turn chat through the real local chat runner and persists replies',
  },
  {
    shardId: 'chat-runner-continuity',
    specFile: 'e2e/integration-chat-llm-runner.spec.ts',
    grep: 'preserves conversation continuity across refresh with story-bound trace evidence',
  },
  {
    shardId: 'chat-runner-workspace-reclaim',
    specFile: 'e2e/integration-chat-llm-runner.spec.ts',
    grep: 'warns and recreates the session workspace when the local chat workspace has been reclaimed',
  },
  {
    shardId: 'chat-stop-escalation',
    specFile: 'e2e/integration-chat.spec.ts',
    grep: 'stop escalation resyncs authoritative thread truth after refresh and keeps composer ready',
  },
] as const;

const FORBIDDEN_RESULT_FIELDS = [
  'verdict',
  'release_decision',
  'releaseDecision',
  'claim_id',
  'claimId',
  'evidence_claim_id',
] as const;

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), 'utf8')) as unknown;
}

function sessionEvidencePath(fixture: SessionFixture, ...segments: string[]): string {
  return path.join(fixture.runRoot, 'integration', 'real-session', ...segments);
}

function writeExecutable(filePath: string, content: string): void {
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function expectNoForbiddenResultFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      expectNoForbiddenResultFields(item);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const key of Object.keys(value)) {
    expect(FORBIDDEN_RESULT_FIELDS).not.toContain(key as never);
    expectNoForbiddenResultFields((value as Record<string, unknown>)[key]);
  }
}

function prepareSessionFixture(options: {
  cleanupFails?: boolean;
  playwrightFailureAtInvocation?: number;
  startFails?: boolean;
} = {}): SessionFixture {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'backend-real-session-shards-'));
  const scriptsDir = path.join(tempRoot, 'scripts');
  const scriptsLibDir = path.join(scriptsDir, 'lib');
  const binDir = path.join(tempRoot, 'bin');
  const stateRoot = path.join(tempRoot, 'artifacts', 'backend-real', 'current');
  const runId = 'backend-real-session-test-run';
  const runRoot = path.join(tempRoot, 'artifacts', 'backend-real', 'runs', runId);
  const apiEnvLog = path.join(tempRoot, 'api-env.log');
  const apiStartLog = path.join(tempRoot, 'api-starts.log');
  const webEnvLog = path.join(tempRoot, 'web-env.log');
  const webStartLog = path.join(tempRoot, 'web-starts.log');

  mkdirSync(scriptsLibDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(path.join(tempRoot, 'artifacts', 'backend-real', 'runs'), { recursive: true });

  cpSync(path.join(process.cwd(), 'scripts', 'run-integration-e2e-full.sh'), path.join(scriptsDir, 'run-integration-e2e-full.sh'));
  cpSync(path.join(process.cwd(), 'scripts', 'lib', 'llmup-image-lock.sh'), path.join(scriptsLibDir, 'llmup-image-lock.sh'));
  cpSync(
    path.join(process.cwd(), 'scripts', 'lib', 'universal-proxy-runtime.sh'),
    path.join(scriptsLibDir, 'universal-proxy-runtime.sh'),
  );

  writeFileSync(
    path.join(scriptsLibDir, 'backend-real-state.sh'),
    `#!/usr/bin/env bash
set -euo pipefail

backend_real_state_root() {
  printf '%s\\n' "${stateRoot}"
}

ensure_backend_real_state() {
  mkdir -p "${stateRoot}"
  if [[ ! -f "${stateRoot}/state.json" ]]; then
    printf '{}\\n' > "${stateRoot}/state.json"
  fi
}
`,
    'utf8',
  );

  writeFileSync(
    path.join(scriptsLibDir, 'backend-real-env.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
load_backend_real_env() { :; }
export_backend_real_endpoint_env() { :; }
`,
    'utf8',
  );

  writeFileSync(
    path.join(scriptsLibDir, 'lane-run-state.sh'),
    `#!/usr/bin/env bash
set -euo pipefail

lane_generate_run_id() {
  printf '%s\\n' "${runId}"
}

lane_prepare_run_root() {
  local _lane="$1"
  local run_id="$2"
  mkdir -p "${tempRoot}/artifacts/backend-real/runs/\${run_id}"
  printf '%s\\n' "${tempRoot}/artifacts/backend-real/runs/\${run_id}"
}

lane_prepare_alias_link() {
  local target="$1"
  local link_path="$2"
  mkdir -p "$(dirname "\${link_path}")"
  ln -sfn "\${target}" "\${link_path}"
}

lane_mark_status() {
  local run_root="$1"
  local status="$2"
  printf '%s\\n' "\${status}" > "\${run_root}/.status"
}

lane_remove_current_link_if_matches() { :; }
lane_prune_runs() { :; }
`,
    'utf8',
  );

  writeFileSync(
    path.join(scriptsLibDir, 'next-generated-root-state.sh'),
    `#!/usr/bin/env bash
set -euo pipefail

next_generated_root_normalize() {
  :
}

next_generated_root_lane_owner_file() {
  local run_root="$1"
  printf '%s/.lane-owner.env\\n' "\${run_root}"
}

next_generated_root_write_lane_owner() {
  local run_root="$1"
  local lane_name="$2"
  local owner_pid="$3"
  local owner_label="$4"
  local owner_file
  owner_file="$(next_generated_root_lane_owner_file "\${run_root}")"
  mkdir -p "$(dirname "\${owner_file}")"
  cat > "\${owner_file}" <<EOF
lane_name=\${lane_name}
owner_pid=\${owner_pid}
owner_label=\${owner_label}
started_at=2026-04-28T00:00:00.000Z
EOF
}

next_generated_root_clear_lane_owner() {
  local run_root="$1"
  rm -f "$(next_generated_root_lane_owner_file "\${run_root}")"
}

next_generated_root_finalize_lane_cleanup() {
  if [[ "${options.cleanupFails ? '1' : '0'}" == "1" ]]; then
    return 98
  fi
}
`,
    'utf8',
  );

  writeFileSync(
    path.join(scriptsLibDir, 'runtime-verification.sh'),
    `#!/usr/bin/env bash
set -euo pipefail

clear_runtime_stack_env() { :; }

resolve_loopback_runtime_stack() {
  local api_port="$1"
  local web_port="$2"
  local keycloak_port="$3"
  local keycloak_realm="$4"
  local keycloak_client_id="$5"
  export RUNTIME_HOST_API_BASE_URL="http://127.0.0.1:\${api_port}"
  export RUNTIME_BROWSER_WEB_BASE_URL="http://127.0.0.1:\${web_port}"
  export RUNTIME_HOST_WEB_BASE_URL="http://127.0.0.1:\${web_port}"
  export RUNTIME_BROWSER_KEYCLOAK_BASE_URL="http://127.0.0.1:\${keycloak_port}"
  export KEYCLOAK_BASE_URL="\${RUNTIME_BROWSER_KEYCLOAK_BASE_URL}"
  export PUBLIC_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  export INTERNAL_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  export KEYCLOAK_REALM="\${keycloak_realm}"
  export KEYCLOAK_CLIENT_ID="\${keycloak_client_id}"
  export KEYCLOAK_ISSUER_URL="\${KEYCLOAK_BASE_URL}/realms/\${keycloak_realm}"
}

gate_evidence_init() { mkdir -p "$1"; }
gate_write_runtime_descriptor() { :; }
gate_write_resolved_env() { :; }
gate_record_task_summary() { printf '%s\\n' "$2" > "$1/task-summary.json"; }
gate_record_service_status() { :; }
gate_record_preflight_check() { :; }
gate_record_failure() { mkdir -p "$1"; printf '%s\\n' "$2:$3:$4" > "$1/failure-classification.txt"; }
gate_record_success() { mkdir -p "$1"; printf 'none:%s:ok\\n' "$2" > "$1/failure-classification.txt"; }
gate_run_auth_preflight() { printf 'integration-token\\n'; }
`,
    'utf8',
  );

  writeExecutable(
    path.join(scriptsDir, 'run-next-dev-safe.sh'),
    `#!/usr/bin/env bash
set -euo pipefail

printf 'web-start\\n' >> "${webStartLog}"
cat > "${webEnvLog}" <<EOF
NEXT_DEV_PROCESS_CAPTURED_BY=\${NEXT_DEV_PROCESS_CAPTURED_BY:-}
EOF

mkdir -p "$(dirname "\${NEXT_DEV_PID_FILE}")"
printf '%s\\n' "$$" > "\${NEXT_DEV_PID_FILE}"
trap 'exit 0' TERM INT
while true; do
  sleep 1
done
`,
  );

  writeExecutable(
    path.join(binDir, 'npm'),
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "run" && "$2" == "api:node:dev" ]]; then
  printf 'api-start\\n' >> "${apiStartLog}"
  cat > "${apiEnvLog}" <<EOF
PORT=\${PORT:-}
EOF
  trap 'exit 0' TERM INT
  while true; do
    sleep 1
  done
fi

if [[ "$1" == "run" ]]; then
  exit 0
fi

exit 0
`,
  );

  writeExecutable(
    path.join(binDir, 'npx'),
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "tsx" ]]; then
  exit 0
fi

if [[ "$1" == "playwright" && "$2" == "test" ]]; then
  count_file="${tempRoot}/playwright-count"
  count=0
  if [[ -f "\${count_file}" ]]; then
    count="$(cat "\${count_file}")"
  fi
  count="$((count + 1))"
  printf '%s\\n' "\${count}" > "\${count_file}"
  printf 'call:%s %s\\n' "\${count}" "$*" >> "${tempRoot}/playwright-commands.log"
  printf 'stdout PRESET_ENDPOINT_API_KEY=sk-session-secret-%s Authorization: Bearer raw-token-%s\\n' "\${count}" "\${count}"
  printf 'stderr CLIENT_SECRET=raw-client-secret-%s\\n' "\${count}" >&2
  if [[ "${String(options.playwrightFailureAtInvocation ?? 0)}" == "\${count}" ]]; then
    exit 23
  fi
  exit 0
fi

exit 0
`,
  );

  writeExecutable(
    path.join(binDir, 'curl'),
    `#!/usr/bin/env bash
set -euo pipefail

url="\${!#}"
status="000"

case "\${url}" in
  */api/v1/workspaces*)
    status="${options.startFails ? '000' : '401'}"
    ;;
  */api/v1/me/profile)
    status="200"
    ;;
  */admin/state)
    status="200"
    ;;
  */en-US/login|*/login|*/login/workspace|*/system/login|*/workspaces/ws_default/login|*/workspaces/ws_default|*/workspaces/ws_default/projects)
    status="200"
    ;;
esac

for arg in "$@"; do
  if [[ "\${arg}" == "-w" ]]; then
    printf '%s' "\${status}"
    exit 0
  fi
done

if [[ "\${status}" == "000" ]]; then
  exit 1
fi

exit 0
`,
  );

  chmodSync(path.join(scriptsDir, 'run-integration-e2e-full.sh'), 0o755);

  return {
    apiEnvLog,
    apiStartLog,
    binDir,
    runRoot,
    scriptPath: path.join(scriptsDir, 'run-integration-e2e-full.sh'),
    stateRoot,
    tempRoot,
    webEnvLog,
    webStartLog,
  };
}

function runSession(fixture: SessionFixture, sessionName = 'agents-backend-real-runner') {
  return spawnSync('bash', [fixture.scriptPath, '--session', sessionName], {
    cwd: fixture.tempRoot,
    env: {
      ...process.env,
      PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
      BACKEND_REAL_STATE_DIR: fixture.stateRoot,
      INTEGRATION_BOOTSTRAP_DEPS: 'false',
      INTEGRATION_INIT_DEPS: 'false',
      INTEGRATION_ENSURE_DEFAULT_WORKSPACE: 'false',
      INTEGRATION_API_PORT: '28191',
      INTEGRATION_WEB_PORT: '38191',
      INTEGRATION_API_READY_ATTEMPTS: '1',
      INTEGRATION_WEB_READY_ATTEMPTS: '1',
      INTEGRATION_READY_RETRY_SLEEP_SECONDS: '0',
      KEYCLOAK_REALM: 'mbos',
      KEYCLOAK_CLIENT_ID: 'agentsmith-web',
      MBOS_UNIVERSAL_PROXY_BASE_URL: 'http://127.0.0.1:39080',
      MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: 'fixture-admin-token',
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

describe('backend-real external runner session shards', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('routes the package script through one backend-real session wrapper instead of three full startups', () => {
    const packageJson = readJson('package.json') as { scripts?: Record<string, string> };
    const script = packageJson.scripts?.['test:agents:backend-real:runner'] ?? '';

    expect(script).toBe('bash scripts/run-backend-real-session-shards.sh');
    expect(script.match(/run-integration-e2e-full\.sh/g) ?? []).toHaveLength(0);
  });

  it('keeps the session wrapper shell-valid and pins exactly the three external runner shards', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/run-backend-real-session-shards.sh'])).not.toThrow();

    const wrapper = readFileSync('scripts/run-backend-real-session-shards.sh', 'utf8');
    expect(wrapper).toContain('--session');
    expect(wrapper).toContain('agents-backend-real-runner');
    expect(wrapper).not.toMatch(/&&\s*bash scripts\/run-integration-e2e-full\.sh/);

    const runner = readFileSync('scripts/run-integration-e2e-full.sh', 'utf8');
    expect(runner).toContain('run_backend_real_runner_session_shards');
    expect(runner).toContain('run_backend_real_chat_runner_session_shards');
    expect(runner).toContain(CHAT_BACKEND_REAL_SESSION_NAME);
    expect(runner).toContain('run_playwright_shard "chat-runner" "e2e/integration-chat-llm-runner.spec.ts"');
    expect(runner).toContain('run_playwright_shard "notebook-runner" "e2e/integration-notebook-codex-runner.spec.ts" --grep-invert docker');
    expect(runner).toContain('run_playwright_shard "notebook-docker" "e2e/integration-notebook-codex-runner.spec.ts" --grep docker');
    for (const shard of CHAT_BACKEND_REAL_SHARDS) {
      expect(runner).toContain(
        `run_playwright_shard "${shard.shardId}" "${shard.specFile}" --grep "${shard.grep}"`,
      );
    }
    expect(runner).toContain('API_READY_ATTEMPTS="${INTEGRATION_API_READY_ATTEMPTS:-120}"');
    expect(runner).toContain('WEB_READY_ATTEMPTS="${INTEGRATION_WEB_READY_ATTEMPTS:-120}"');
    expect(runner).toContain('READY_RETRY_SLEEP_SECONDS="${INTEGRATION_READY_RETRY_SLEEP_SECONDS:-1}"');
  });

  it('starts backend-real once, runs the three shards serially, and writes diagnostic-only aggregate evidence', () => {
    const fixture = prepareSessionFixture();
    tempRoots.push(fixture.tempRoot);

    const result = runSession(fixture);

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixture.tempRoot, 'playwright-commands.log'), 'utf8').trim().split('\n')).toEqual([
      'call:1 playwright test --config playwright.config.integration.ts e2e/integration-chat-llm-runner.spec.ts --project=chromium --workers=1',
      'call:2 playwright test --config playwright.config.integration.ts e2e/integration-notebook-codex-runner.spec.ts --project=chromium --workers=1 --grep-invert docker',
      'call:3 playwright test --config playwright.config.integration.ts e2e/integration-notebook-codex-runner.spec.ts --project=chromium --workers=1 --grep docker',
    ]);
    expect(readFileSync(fixture.apiEnvLog, 'utf8')).toContain('PORT=28191');
    expect(readFileSync(fixture.webEnvLog, 'utf8')).toContain('NEXT_DEV_PROCESS_CAPTURED_BY=run-integration-e2e-full');

    const aggregatePath = sessionEvidencePath(fixture, 'aggregate.json');
    expect(existsSync(aggregatePath)).toBe(true);
    expect(existsSync(sessionEvidencePath(fixture, 'session-aggregate.json'))).toBe(false);

    const aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8')) as {
      diagnostic_only: boolean;
      fixed_cost: { startup_count: number };
      shards: Array<{ diagnostic_state: string; result_path: string; shard_id: string }>;
    };

    expect(aggregate.diagnostic_only).toBe(true);
    expect(aggregate.fixed_cost.startup_count).toBe(1);
    expect(aggregate.shards.map((shard) => shard.shard_id)).toEqual([
      'chat-runner',
      'notebook-runner',
      'notebook-docker',
    ]);
    expect(aggregate.shards.map((shard) => shard.diagnostic_state)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expectNoForbiddenResultFields(aggregate);

    for (const shardId of ['chat-runner', 'notebook-runner', 'notebook-docker']) {
      const shardDir = sessionEvidencePath(fixture, 'shards', shardId);
      const stdoutLog = readFileSync(path.join(shardDir, 'playwright.stdout.log'), 'utf8');
      expect(existsSync(path.join(shardDir, 'result.json'))).toBe(true);
      expect(existsSync(path.join(shardDir, 'shard-result.json'))).toBe(false);
      expect(stdoutLog).toContain('[redacted]');
      expect(stdoutLog).not.toContain('sk-session-secret');
      expect(stdoutLog).not.toContain('raw-token');
      expect(stdoutLog).not.toContain('Bearer raw-token');
      expect(stdoutLog).not.toContain('Authorization: [redacted] raw-token');
      expect(readFileSync(path.join(shardDir, 'playwright.stderr.log'), 'utf8')).not.toContain('raw-client-secret');
    }
    expect(aggregate.shards.map((shard) => shard.result_path)).toEqual([
      'shards/chat-runner/result.json',
      'shards/notebook-runner/result.json',
      'shards/notebook-docker/result.json',
    ]);
    expect(result.stdout).not.toContain('sk-session-secret');
    expect(result.stderr).not.toContain('raw-client-secret');
  }, 15000);

  it('starts backend-real once and runs the external chat greps as serial diagnostic shards', () => {
    const fixture = prepareSessionFixture();
    tempRoots.push(fixture.tempRoot);

    const result = runSession(fixture, CHAT_BACKEND_REAL_SESSION_NAME);

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixture.tempRoot, 'playwright-commands.log'), 'utf8').trim().split('\n')).toEqual(
      CHAT_BACKEND_REAL_SHARDS.map((shard, index) => (
        `call:${index + 1} playwright test --config playwright.config.integration.ts ${shard.specFile} --project=chromium --workers=1 --grep ${shard.grep}`
      )),
    );
    expect(readFileSync(fixture.apiStartLog, 'utf8').trim().split('\n')).toEqual(['api-start']);
    expect(readFileSync(fixture.webStartLog, 'utf8').trim().split('\n')).toEqual(['web-start']);
    expect(readFileSync(fixture.apiEnvLog, 'utf8')).toContain('PORT=28191');
    expect(readFileSync(fixture.webEnvLog, 'utf8')).toContain('NEXT_DEV_PROCESS_CAPTURED_BY=run-integration-e2e-full');

    const aggregatePath = sessionEvidencePath(fixture, 'aggregate.json');
    expect(existsSync(aggregatePath)).toBe(true);
    expect(existsSync(sessionEvidencePath(fixture, 'session-aggregate.json'))).toBe(false);

    const aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8')) as {
      diagnostic_only: boolean;
      fixed_cost: { startup_count: number };
      shards: Array<{ diagnostic_state: string; grep: string | null; result_path: string; shard_id: string }>;
    };

    expect(aggregate.diagnostic_only).toBe(true);
    expect(aggregate.fixed_cost.startup_count).toBe(1);
    expect(aggregate.shards.map((shard) => shard.shard_id)).toEqual(
      CHAT_BACKEND_REAL_SHARDS.map((shard) => shard.shardId),
    );
    expect(aggregate.shards.map((shard) => shard.diagnostic_state)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(aggregate.shards.map((shard) => shard.grep)).toEqual(
      CHAT_BACKEND_REAL_SHARDS.map((shard) => shard.grep),
    );
    expect(aggregate.shards.map((shard) => shard.result_path)).toEqual(
      CHAT_BACKEND_REAL_SHARDS.map((shard) => `shards/${shard.shardId}/result.json`),
    );
    expectNoForbiddenResultFields(aggregate);

    for (const shard of CHAT_BACKEND_REAL_SHARDS) {
      const shardDir = sessionEvidencePath(fixture, 'shards', shard.shardId);
      expect(existsSync(path.join(shardDir, 'result.json'))).toBe(true);
      expect(existsSync(path.join(shardDir, 'shard-result.json'))).toBe(false);
      const shardResult = JSON.parse(readFileSync(path.join(shardDir, 'result.json'), 'utf8')) as {
        grep: string | null;
        shard_id: string;
      };
      const stdoutLog = readFileSync(path.join(shardDir, 'playwright.stdout.log'), 'utf8');
      const stderrLog = readFileSync(path.join(shardDir, 'playwright.stderr.log'), 'utf8');
      expect(shardResult).toMatchObject({ shard_id: shard.shardId, grep: shard.grep });
      expect(stdoutLog).toContain('[redacted]');
      expect(stdoutLog).not.toContain('sk-session-secret');
      expect(stdoutLog).not.toContain('raw-token');
      expect(stdoutLog).not.toContain('Bearer raw-token');
      expect(stderrLog).not.toContain('raw-client-secret');
    }
    expect(result.stdout).not.toContain('sk-session-secret');
    expect(result.stderr).not.toContain('raw-client-secret');
  }, 15000);

  it('does not retry a failed external chat shard or run later chat shards after assertion failure', () => {
    const fixture = prepareSessionFixture({ playwrightFailureAtInvocation: 3 });
    tempRoots.push(fixture.tempRoot);

    const result = runSession(fixture, CHAT_BACKEND_REAL_SESSION_NAME);

    expect(result.status).toBe(23);
    expect(readFileSync(path.join(fixture.tempRoot, 'playwright-commands.log'), 'utf8').trim().split('\n')).toEqual(
      CHAT_BACKEND_REAL_SHARDS.slice(0, 3).map((shard, index) => (
        `call:${index + 1} playwright test --config playwright.config.integration.ts ${shard.specFile} --project=chromium --workers=1 --grep ${shard.grep}`
      )),
    );
    const aggregatePath = sessionEvidencePath(fixture, 'aggregate.json');
    expect(existsSync(aggregatePath)).toBe(true);
    expect(existsSync(sessionEvidencePath(fixture, 'session-aggregate.json'))).toBe(false);

    const aggregate = JSON.parse(readFileSync(aggregatePath, 'utf8')) as {
      diagnostic_state: string;
      shards: Array<{ diagnostic_state: string; result_path: string; shard_id: string }>;
    };
    expect(aggregate.diagnostic_state).toBe('failed');
    expect(aggregate.shards.map((shard) => [shard.shard_id, shard.diagnostic_state])).toEqual([
      ['chat-runner-stream', 'succeeded'],
      ['chat-runner-continuity', 'succeeded'],
      ['chat-runner-workspace-reclaim', 'failed'],
      ['chat-stop-escalation', 'not_run'],
    ]);
    expect(aggregate.shards.map((shard) => shard.result_path)).toEqual(
      CHAT_BACKEND_REAL_SHARDS.map((shard) => `shards/${shard.shardId}/result.json`),
    );
    expect(
      existsSync(sessionEvidencePath(fixture, 'shards', 'chat-runner-workspace-reclaim', 'result.json')),
    ).toBe(true);
    expect(
      existsSync(sessionEvidencePath(fixture, 'shards', 'chat-runner-workspace-reclaim', 'shard-result.json')),
    ).toBe(false);
    expect(result.stderr).not.toContain('raw-client-secret');
  }, 15000);

  it('does not retry a failed shard or let cleanup failures overwrite the original assertion failure', () => {
    const fixture = prepareSessionFixture({ cleanupFails: true, playwrightFailureAtInvocation: 2 });
    tempRoots.push(fixture.tempRoot);

    const result = runSession(fixture);

    expect(result.status).toBe(23);
    expect(readFileSync(path.join(fixture.tempRoot, 'playwright-commands.log'), 'utf8').trim().split('\n')).toEqual([
      'call:1 playwright test --config playwright.config.integration.ts e2e/integration-chat-llm-runner.spec.ts --project=chromium --workers=1',
      'call:2 playwright test --config playwright.config.integration.ts e2e/integration-notebook-codex-runner.spec.ts --project=chromium --workers=1 --grep-invert docker',
    ]);
    expect(readFileSync(path.join(fixture.runRoot, '.status'), 'utf8')).toContain('failed');
    expect(result.stderr).not.toContain('raw-client-secret');
  }, 15000);

  it('does not run any shard when startup fails but still marks the session failed', () => {
    const fixture = prepareSessionFixture({ startFails: true });
    tempRoots.push(fixture.tempRoot);

    const result = runSession(fixture);

    expect(result.status).toBe(1);
    expect(existsSync(path.join(fixture.tempRoot, 'playwright-commands.log'))).toBe(false);
    expect(readFileSync(path.join(fixture.runRoot, '.status'), 'utf8')).toContain('failed');
    expect(readFileSync(path.join(fixture.runRoot, '.status'), 'utf8')).not.toContain('success');
  }, 15000);
});
