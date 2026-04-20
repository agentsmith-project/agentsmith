import { execFileSync } from 'node:child_process';
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

describe('run-integration-e2e-full lifecycle observability contract', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('stays shell-syntax valid and wires next-dev lifecycle capture into the managed web launch', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/run-integration-e2e-full.sh'])).not.toThrow();

    const script = readFileSync('scripts/run-integration-e2e-full.sh', 'utf8');
    const clearLaneOwnerIndex = script.indexOf('next_generated_root_clear_lane_owner "${INTEGRATION_RUN_ROOT}"');
    const normalizeIndex = script.lastIndexOf('next_generated_root_normalize');

    expect(script).toContain('NEXT_WEB_PROCESS_STATE_FILE="${INTEGRATION_RUN_ROOT}/web.process.json"');
    expect(script).toContain('NEXT_DEV_EXIT_MARKER_FILE="${INTEGRATION_RUN_ROOT}/next-dev-exit.json"');
    expect(script).toContain('NEXT_DEV_PROCESS_STATE_FILE="${NEXT_WEB_PROCESS_STATE_FILE}"');
    expect(script).toContain('NEXT_DEV_PROCESS_KIND=web');
    expect(script).toContain('NEXT_DEV_PROCESS_CAPTURED_BY=run-integration-e2e-full');
    expect(script).toContain('NEXT_DEV_EXIT_MARKER_FILE="${NEXT_DEV_EXIT_MARKER_FILE}"');
    expect(script).toContain('next_generated_root_write_lane_owner "${INTEGRATION_RUN_ROOT}" "backend-real" "$$" "run-integration-e2e-full.sh"');
    expect(script).toContain('capture_integration_lifecycle_observation "pre-stop"');
    expect(script).toContain('capture_integration_lifecycle_observation "post-stop"');
    expect(script).toContain('next_generated_root_clear_lane_owner "${INTEGRATION_RUN_ROOT}"');
    expect(script).toContain('next_generated_root_finalize_lane_cleanup');
    expect(clearLaneOwnerIndex).toBeGreaterThanOrEqual(0);
    expect(normalizeIndex).toBeGreaterThanOrEqual(0);
    expect(clearLaneOwnerIndex).toBeLessThan(normalizeIndex);
  });

  it('captures pre-stop and post-stop lifecycle evidence without changing the failure retention contract', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-'));
    tempRoots.push(tempRoot);

    const scriptsDir = path.join(tempRoot, 'scripts');
    const scriptsLibDir = path.join(scriptsDir, 'lib');
    const binDir = path.join(tempRoot, 'bin');
    const stateRoot = path.join(tempRoot, 'artifacts', 'backend-real', 'current');
    const runId = 'integration-test-run';
    const runRoot = path.join(tempRoot, 'artifacts', 'backend-real', 'runs', runId);
    const lifecycleDir = path.join(stateRoot, 'integration-lifecycle', runId);
    const webEnvLog = path.join(tempRoot, 'web-env.log');
    const apiEnvLog = path.join(tempRoot, 'api-env.log');
    const finalizeLog = path.join(tempRoot, 'finalize.log');

    mkdirSync(scriptsLibDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(path.join(tempRoot, 'artifacts', 'backend-real', 'runs'), { recursive: true });

    cpSync(path.join(process.cwd(), 'scripts', 'run-integration-e2e-full.sh'), path.join(scriptsDir, 'run-integration-e2e-full.sh'));

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

load_backend_real_env() {
  :
}

export_backend_real_endpoint_env() {
  :
}
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

lane_remove_current_link_if_matches() {
  :
}

lane_prune_runs() {
  :
}
`,
      'utf8',
    );

    writeFileSync(
      path.join(scriptsLibDir, 'next-generated-root-state.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

next_generated_root_normalize() {
  local owner_file
  owner_file="$(next_generated_root_lane_owner_file "\${INTEGRATION_RUN_ROOT}")"
  if [[ -f "\${owner_file}" ]]; then
    printf '[next-generated-root] active lane owner blocks validation cleanup\\n' >&2
    return 97
  fi
  printf 'normalized\\n' >> "${finalizeLog}"
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
started_at=2026-04-19T00:00:00.000Z
EOF
}

next_generated_root_clear_lane_owner() {
  local run_root="$1"
  rm -f "$(next_generated_root_lane_owner_file "\${run_root}")"
}

next_generated_root_finalize_lane_cleanup() {
  printf 'finalized\\n' >> "${finalizeLog}"
}
`,
      'utf8',
    );

    writeFileSync(
      path.join(scriptsLibDir, 'runtime-verification.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

clear_runtime_stack_env() {
  :
}

resolve_loopback_runtime_stack() {
  local api_port="$1"
  local web_port="$2"
  local keycloak_port="$3"
  local keycloak_realm="$4"
  local keycloak_client_id="$5"
  export RUNTIME_HOST_API_BASE_URL="http://127.0.0.1:\${api_port}"
  export RUNTIME_BROWSER_WEB_BASE_URL="http://127.0.0.1:\${web_port}"
  export KEYCLOAK_BASE_URL="http://127.0.0.1:\${keycloak_port}"
  export PUBLIC_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  export INTERNAL_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  export KEYCLOAK_ISSUER_URL="\${KEYCLOAK_BASE_URL}/realms/\${keycloak_realm}"
  export KEYCLOAK_CLIENT_ID="\${keycloak_client_id}"
}

gate_evidence_init() {
  mkdir -p "$1"
}

gate_write_runtime_descriptor() {
  :
}

gate_write_resolved_env() {
  :
}

gate_record_task_summary() {
  printf '%s\\n' "$2" > "$1/task-summary.json"
}

gate_record_service_status() {
  :
}

gate_wait_for_http() {
  return 0
}

gate_record_preflight_check() {
  :
}

gate_record_failure() {
  :
}

gate_record_success() {
  :
}

gate_run_auth_preflight() {
  printf 'integration-token\\n'
}
`,
      'utf8',
    );

    writeFileSync(
      path.join(scriptsDir, 'run-next-dev-safe.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

cat > "${webEnvLog}" <<EOF
NEXT_DEV_PROCESS_STATE_FILE=\${NEXT_DEV_PROCESS_STATE_FILE:-}
NEXT_DEV_PROCESS_KIND=\${NEXT_DEV_PROCESS_KIND:-}
NEXT_DEV_PROCESS_CAPTURED_BY=\${NEXT_DEV_PROCESS_CAPTURED_BY:-}
NEXT_DEV_EXIT_MARKER_FILE=\${NEXT_DEV_EXIT_MARKER_FILE:-}
EOF

mkdir -p "$(dirname "\${NEXT_DEV_PID_FILE}")"
printf '%s\\n' "$$" > "\${NEXT_DEV_PID_FILE}"
mkdir -p "$(dirname "\${NEXT_DEV_PROCESS_STATE_FILE}")"
cat > "\${NEXT_DEV_PROCESS_STATE_FILE}" <<EOF
{
  "schema_version": 1,
  "kind": "web",
  "pid": $$,
  "port": \${NEXT_DEV_PORT:-0},
  "captured_by": "\${NEXT_DEV_PROCESS_CAPTURED_BY:-}"
}
EOF

trap 'touch "${tempRoot}/stop-web-probe"; mkdir -p "$(dirname "\${NEXT_DEV_EXIT_MARKER_FILE}")"; cat > "\${NEXT_DEV_EXIT_MARKER_FILE}" <<EOF
{
  "event": "trap_exit",
  "exit_status": 0,
  "signal": 15,
  "child_pid": $$,
  "timestamp": "2026-04-19T00:00:00.000Z"
}
EOF
exit 0' TERM INT

while true; do
  sleep 1
done
`,
      'utf8',
    );

    writeFileSync(
      path.join(binDir, 'npm'),
      `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "run" && "$2" == "api:node:dev" ]]; then
  cat > "${apiEnvLog}" <<EOF
PORT=\${PORT:-}
MBOS_UNIVERSAL_PROXY_BASE_URL=\${MBOS_UNIVERSAL_PROXY_BASE_URL:-}
EOF
  trap 'touch "${tempRoot}/stop-api-probe"; exit 0' TERM INT
  while true; do
    sleep 1
  done
fi

exit 0
`,
      'utf8',
    );

    writeFileSync(
      path.join(binDir, 'npx'),
      `#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "playwright" && "$2" == "test" ]]; then
  exit 17
fi

if [[ "$1" == "tsx" ]]; then
  exit 0
fi

exit 0
`,
      'utf8',
    );

    writeFileSync(
      path.join(binDir, 'curl'),
      `#!/usr/bin/env bash
set -euo pipefail

	url="\${!#}"
status="000"

case "\${url}" in
  */admin/state)
    status="200"
    ;;
  */api/v1/me/profile)
    status="200"
    ;;
  */api/v1/workspaces*)
    if [[ -f "${tempRoot}/stop-api-probe" ]]; then
      status="000"
    else
      status="401"
    fi
    ;;
  */en-US/login|*/login|*/login/workspace|*/system/login|*/workspaces/ws_default|*/workspaces/ws_default/projects)
    if [[ -f "${tempRoot}/stop-web-probe" ]]; then
      status="000"
    else
      status="200"
    fi
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
      'utf8',
    );

    chmodSync(path.join(scriptsDir, 'run-integration-e2e-full.sh'), 0o755);
    chmodSync(path.join(scriptsDir, 'run-next-dev-safe.sh'), 0o755);
    chmodSync(path.join(binDir, 'npm'), 0o755);
    chmodSync(path.join(binDir, 'npx'), 0o755);
    chmodSync(path.join(binDir, 'curl'), 0o755);

    try {
      execFileSync('bash', [path.join(scriptsDir, 'run-integration-e2e-full.sh'), 'e2e/example.spec.ts'], {
        cwd: tempRoot,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          ROOT_DIR: tempRoot,
          BACKEND_REAL_STATE_DIR: stateRoot,
          MBOS_UNIVERSAL_PROXY_BASE_URL: 'http://127.0.0.1:39080',
          INTEGRATION_BOOTSTRAP_DEPS: 'false',
          INTEGRATION_INIT_DEPS: 'false',
          INTEGRATION_ENSURE_DEFAULT_WORKSPACE: 'false',
          INTEGRATION_API_PORT: '28191',
          INTEGRATION_WEB_PORT: '38191',
          KEYCLOAK_REALM: 'mbos',
          KEYCLOAK_CLIENT_ID: 'agentsmith-web',
        },
        stdio: 'pipe',
      });
      throw new Error('expected integration playwright failure');
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : NaN;
      expect(status).toBe(17);
    }

    const webEnv = readFileSync(webEnvLog, 'utf8');
    const apiEnv = readFileSync(apiEnvLog, 'utf8');
    const preStop = JSON.parse(readFileSync(path.join(lifecycleDir, 'pre-stop.json'), 'utf8')) as {
      lane_owner: { present: boolean; owner_label: string | null };
      api: { alive: boolean; probe: { status: string } };
      web: {
        wrapper_alive: boolean;
        next_alive: boolean;
        process_state_present: boolean;
        next_dev_exit_marker_present: boolean;
        probe: { status: string };
      };
    };
    const postStop = JSON.parse(readFileSync(path.join(lifecycleDir, 'post-stop.json'), 'utf8')) as {
      api: { alive: boolean; probe: { status: string } };
      web: {
        wrapper_alive: boolean;
        next_alive: boolean;
        next_dev_exit_marker_present: boolean;
        next_dev_exit_marker: { event: string } | null;
        probe: { status: string };
      };
    };

    expect(webEnv).toContain(`NEXT_DEV_PROCESS_STATE_FILE=${path.join(runRoot, 'web.process.json')}`);
    expect(webEnv).toContain('NEXT_DEV_PROCESS_KIND=web');
    expect(webEnv).toContain('NEXT_DEV_PROCESS_CAPTURED_BY=run-integration-e2e-full');
    expect(webEnv).toContain(`NEXT_DEV_EXIT_MARKER_FILE=${path.join(runRoot, 'next-dev-exit.json')}`);
    expect(apiEnv).toContain('PORT=28191');
    expect(apiEnv).toContain('MBOS_UNIVERSAL_PROXY_BASE_URL=http://127.0.0.1:39080');

    expect(preStop.lane_owner.present).toBe(true);
    expect(preStop.lane_owner.owner_label).toBe('run-integration-e2e-full.sh');
    expect(preStop.api.alive).toBe(true);
    expect(preStop.api.probe.status).toBe('401');
    expect(preStop.web.wrapper_alive).toBe(true);
    expect(preStop.web.next_alive).toBe(true);
    expect(preStop.web.process_state_present).toBe(true);
    expect(preStop.web.next_dev_exit_marker_present).toBe(false);
    expect(preStop.web.probe.status).toBe('200');

    expect(postStop.api.alive).toBe(false);
    expect(postStop.api.probe.status).toBe('000');
    expect(postStop.web.wrapper_alive).toBe(false);
    expect(postStop.web.next_alive).toBe(false);
    expect(postStop.web.next_dev_exit_marker_present).toBe(true);
    expect(postStop.web.next_dev_exit_marker?.event).toBe('trap_exit');
    expect(postStop.web.probe.status).toBe('000');

    expect(existsSync(path.join(runRoot, '.lane-owner.env'))).toBe(false);
    expect(existsSync(path.join(runRoot, '.status'))).toBe(true);
    expect(readFileSync(path.join(runRoot, '.status'), 'utf8')).toContain('failed');
    expect(readFileSync(finalizeLog, 'utf8')).toContain('normalized');
    expect(readFileSync(finalizeLog, 'utf8')).toContain('finalized');
  }, 15000);
});
