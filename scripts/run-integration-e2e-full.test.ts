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

describe('run-integration-e2e-full lifecycle observability contract', () => {
  const ghcrAuthFallbackHint = ['docker', 'login', 'ghcr.io'].join(' ');
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  function readLockedLlmupImage(): string {
    const lock = readFileSync('infra/deploy/shared/llmup-image.lock', 'utf8');
    const image = lock.match(/^llmup_source_image=(.+)$/m)?.[1];
    expect(image).toBeTruthy();
    return image ?? '';
  }

  function writeExecutable(filePath: string, content: string): void {
    writeFileSync(filePath, content, 'utf8');
    chmodSync(filePath, 0o755);
  }

  function prepareManagedProxyFixture(
    tempRoot: string,
    options: { curlMode: 'candidate-reachable' | 'explicit-unreachable' | 'managed-container'; dockerMode?: 'success' | 'pull-fail' | 'run-fail' },
  ): {
    apiEnvLog: string;
    binDir: string;
    dockerLog: string;
    scriptPath: string;
    webEnvLog: string;
  } {
    const scriptsDir = path.join(tempRoot, 'scripts');
    const scriptsLibDir = path.join(scriptsDir, 'lib');
    const infraSharedDir = path.join(tempRoot, 'infra', 'deploy', 'shared');
    const universalProxyConfigDir = path.join(infraSharedDir, 'universal-proxy');
    const binDir = path.join(tempRoot, 'bin');
    const stateRoot = path.join(tempRoot, 'artifacts', 'backend-real', 'current');
    const runId = 'managed-proxy-test-run';
    const apiEnvLog = path.join(tempRoot, 'api-env.log');
    const webEnvLog = path.join(tempRoot, 'web-env.log');
    const dockerLog = path.join(tempRoot, 'docker.log');
    const dockerRunMarker = path.join(tempRoot, 'docker-run.marker');

    mkdirSync(scriptsLibDir, { recursive: true });
    mkdirSync(universalProxyConfigDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(path.join(tempRoot, 'artifacts', 'backend-real', 'runs'), { recursive: true });

    cpSync(path.join(process.cwd(), 'scripts', 'run-integration-e2e-full.sh'), path.join(scriptsDir, 'run-integration-e2e-full.sh'));
    cpSync(path.join(process.cwd(), 'scripts', 'lib', 'llmup-image-lock.sh'), path.join(scriptsLibDir, 'llmup-image-lock.sh'));
    cpSync(
      path.join(process.cwd(), 'scripts', 'lib', 'universal-proxy-runtime.sh'),
      path.join(scriptsLibDir, 'universal-proxy-runtime.sh'),
    );
    cpSync(path.join(process.cwd(), 'infra', 'deploy', 'shared', 'llmup-image.lock'), path.join(infraSharedDir, 'llmup-image.lock'));
    cpSync(
      path.join(process.cwd(), 'infra', 'deploy', 'shared', 'universal-proxy', 'config.yaml'),
      path.join(universalProxyConfigDir, 'config.yaml'),
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

lane_mark_status() { :; }
lane_remove_current_link_if_matches() { :; }
lane_prune_runs() { :; }
`,
      'utf8',
    );

    writeFileSync(
      path.join(scriptsLibDir, 'next-generated-root-state.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

next_generated_root_normalize() { :; }

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

next_generated_root_finalize_lane_cleanup() { :; }
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
  export KEYCLOAK_BASE_URL="http://127.0.0.1:\${keycloak_port}"
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
gate_wait_for_http() { return 0; }
gate_record_preflight_check() { :; }
gate_record_failure() { :; }
gate_record_success() { :; }
gate_run_auth_preflight() { printf 'integration-token\\n'; }
`,
      'utf8',
    );

    writeExecutable(
      path.join(scriptsDir, 'run-next-dev-safe.sh'),
      `#!/usr/bin/env bash
set -euo pipefail
cat > "${webEnvLog}" <<EOF
NEXT_PUBLIC_API_BASE=\${NEXT_PUBLIC_API_BASE:-}
EOF
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
  cat > "${apiEnvLog}" <<EOF
PORT=\${PORT:-}
MBOS_UNIVERSAL_PROXY_BASE_URL=\${MBOS_UNIVERSAL_PROXY_BASE_URL:-}
MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=\${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}
MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST=\${MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST:-}
EOF
  trap 'exit 0' TERM INT
  while true; do
    sleep 1
  done
fi

exit 0
`,
    );

    writeExecutable(
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
    );

    writeExecutable(
      path.join(binDir, 'curl'),
      `#!/usr/bin/env bash
set -euo pipefail

	url="\${!#}"
	status="000"
	has_admin_bearer=0
	previous=""
	for arg in "$@"; do
	  if [[ "\${previous}" == "-H" && "\${arg}" == "Authorization: Bearer "* ]]; then
	    has_admin_bearer=1
	  fi
	  previous="\${arg}"
	done
	case "\${url}" in
	  */admin/state)
	    if [[ "${options.curlMode}" == "candidate-reachable" && "\${has_admin_bearer}" == "1" ]]; then
	      status="200"
	    elif [[ "${options.curlMode}" == "managed-container" && -f "${dockerRunMarker}" && "\${has_admin_bearer}" == "1" ]]; then
	      status="200"
	    elif [[ "${options.curlMode}" == "candidate-reachable" ]]; then
	      status="403"
	    elif [[ "${options.curlMode}" == "managed-container" && -f "${dockerRunMarker}" ]]; then
	      status="403"
	    fi
	    ;;
  */api/v1/me/profile)
    status="200"
    ;;
  */api/v1/workspaces*)
    status="401"
    ;;
  */en-US/login|*/login|*/login/workspace|*/system/login|*/workspaces/ws_default|*/workspaces/ws_default/projects)
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

    writeExecutable(
      path.join(binDir, 'docker'),
      `#!/usr/bin/env bash
set -euo pipefail

{
  printf 'docker'
  for arg in "$@"; do
    printf ' %s' "\${arg}"
  done
  printf '\\n'
} >> "${dockerLog}"

case "\${1:-}" in
  ps)
    exit 0
    ;;
  container)
    if [[ "\${2:-}" == "inspect" ]]; then
      format="\${4:-}"
      ref="\${5:-}"
      if [[ "\${ref}" != "fake-universal-proxy-container" ]]; then
        exit 1
      fi
      if [[ "\${format}" == *"com.agentsmith.managed-by"* ]]; then
        printf 'universal-proxy-runtime\\n'
        exit 0
      fi
      if [[ "\${format}" == *"com.agentsmith.runtime-label"* ]]; then
        printf 'integration-e2e-full\\n'
        exit 0
      fi
      if [[ "\${format}" == *".Id"* ]]; then
        printf 'fake-universal-proxy-container\\n'
        exit 0
      fi
      exit 0
    fi
    ;;
  image)
    if [[ "\${2:-}" == "inspect" ]]; then
      exit 1
    fi
    ;;
  pull)
    if [[ "${options.dockerMode ?? 'success'}" == "pull-fail" ]]; then
      printf 'fake pull failure\\n' >&2
      exit 41
    fi
    exit 0
    ;;
  run)
    if [[ "${options.dockerMode ?? 'success'}" == "run-fail" ]]; then
      printf 'fake run failure\\n' >&2
      exit 42
    fi
    touch "${dockerRunMarker}"
    printf 'fake-universal-proxy-container\\n'
    exit 0
    ;;
  rm)
    rm -f "${dockerRunMarker}"
    exit 0
    ;;
  logs)
    exit 0
    ;;
esac

exit 0
`,
    );

    chmodSync(path.join(scriptsDir, 'run-integration-e2e-full.sh'), 0o755);

    return {
      apiEnvLog,
      binDir,
      dockerLog,
      scriptPath: path.join(scriptsDir, 'run-integration-e2e-full.sh'),
      webEnvLog,
    };
  }

  function runManagedProxyFixture(
    tempRoot: string,
    fixture: { binDir: string; scriptPath: string },
    extraEnv: Record<string, string>,
  ): ReturnType<typeof spawnSync> {
    return spawnSync('bash', [fixture.scriptPath, 'e2e/example.spec.ts'], {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
        INTEGRATION_BOOTSTRAP_DEPS: 'false',
        INTEGRATION_INIT_DEPS: 'false',
        INTEGRATION_ENSURE_DEFAULT_WORKSPACE: 'false',
        INTEGRATION_API_PORT: '28191',
        INTEGRATION_WEB_PORT: '38191',
        KEYCLOAK_REALM: 'mbos',
        KEYCLOAK_CLIENT_ID: 'agentsmith-web',
        UNIVERSAL_PROXY_RUNTIME_WAIT_TIMEOUT_SECONDS: '1',
        ...extraEnv,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });
  }

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
    expect(script).toContain('UNIVERSAL_PROXY_RUNTIME_FORCE_MANAGED="${INTEGRATION_UNIVERSAL_PROXY_FORCE_MANAGED:-${UNIVERSAL_PROXY_RUNTIME_FORCE_MANAGED:-0}}"');
    expect(script).toContain('UNIVERSAL_PROXY_RUNTIME_UPSTREAM_HOST="${INTEGRATION_UNIVERSAL_PROXY_UPSTREAM_HOST:-${UNIVERSAL_PROXY_RUNTIME_UPSTREAM_HOST:-host.docker.internal}}"');
    expect(clearLaneOwnerIndex).toBeGreaterThanOrEqual(0);
    expect(normalizeIndex).toBeGreaterThanOrEqual(0);
    expect(clearLaneOwnerIndex).toBeLessThan(normalizeIndex);
  });

  it('binds focused universal-proxy model-profile evidence to a forced managed locked container', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const command = packageJson.scripts?.['test:e2e:integration:universal-proxy:model-profile'];

    expect(command).toContain('INTEGRATION_UNIVERSAL_PROXY_FORCE_MANAGED=1');
    expect(command).toContain('INTEGRATION_UNIVERSAL_PROXY_PORT=${INTEGRATION_UNIVERSAL_PROXY_PORT:-39084}');
    expect(command).toContain('bash scripts/run-integration-e2e-full.sh e2e/integration-universal-proxy-endpoint.spec.ts');
    expect(command).toContain('--grep "model profile runtime config"');
  });

  it('passes runner image controls into the Playwright process instead of forcing hidden rebuild defaults', () => {
    const script = readFileSync('scripts/run-integration-e2e-full.sh', 'utf8');
    const playwrightLaunchIndex = script.indexOf('npx playwright test --config playwright.config.integration.ts');

    expect(playwrightLaunchIndex).toBeGreaterThanOrEqual(0);

    const expectedAssignments = [
      'MBOS_UNIVERSAL_PROXY_BASE_URL="${MBOS_UNIVERSAL_PROXY_BASE_URL:-}"',
      'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN="${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}"',
      'MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST="${MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_BASE_DOCKER_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_BASE_DOCKER_IMAGE:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_REBUILD_BASE_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_REBUILD_BASE_IMAGE:-0}"',
      'INTEGRATION_AGENT_TASK_RUNNER_REBUILD_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_REBUILD_IMAGE:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_EMBEDDED="${INTEGRATION_AGENT_TASK_RUNNER_EMBEDDED:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS="${INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS:-mbos-context,feishu-docs,jira-ops}"',
      'INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_REQUIRED="${INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_REQUIRED:-1}"',
      'INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_DIR="${INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_DIR:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_MOUNT_READY_TIMEOUT_MS="${INTEGRATION_AGENT_TASK_RUNNER_MOUNT_READY_TIMEOUT_MS:-120000}"',
      'INTEGRATION_INTERNAL_AGENT_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-}"',
      'INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-0}"',
      'INTEGRATION_INTERNAL_AGENT_REBUILD_IMAGE="${INTEGRATION_INTERNAL_AGENT_REBUILD_IMAGE:-}"',
      'INTEGRATION_RUNNER_LOG_DIR="${INTEGRATION_RUNNER_LOG_DIR:-}"',
    ];

    for (const assignment of expectedAssignments) {
      expect(script, assignment).toContain(assignment);
      expect(script.indexOf(assignment), assignment).toBeLessThan(playwrightLaunchIndex);
    }
  });

  it('keeps active local/backend-real runtime entrypoints free of sibling source-build proxy coupling', () => {
    const activeEntrypoints = [
      'scripts/run-integration-e2e-full.sh',
      'scripts/substrate/common.sh',
      'scripts/substrate/providers/compose.sh',
      'scripts/local-manual/start-proxy.sh',
    ];
    const forbiddenFragments = [
      '../llm-universal-proxy',
      'cargo build',
      'target/debug/llm-universal-proxy',
    ];

    for (const entrypoint of activeEntrypoints) {
      const content = readFileSync(entrypoint, 'utf8');
      for (const fragment of forbiddenFragments) {
        expect(content, `${entrypoint} must not contain ${fragment}`).not.toContain(fragment);
      }
    }
  });

  it('fails fast for an explicit unavailable proxy URL without invoking docker or starting API/Web', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-proxy-explicit-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'explicit-unreachable' });

    const result = runManagedProxyFixture(tempRoot, fixture, {
      MBOS_UNIVERSAL_PROXY_BASE_URL: 'http://127.0.0.1:49080',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('http://127.0.0.1:49080');
    expect(result.stderr).toContain('MBOS_UNIVERSAL_PROXY_BASE_URL');
    expect(result.stderr).toContain('MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
    expect(existsSync(fixture.dockerLog) ? readFileSync(fixture.dockerLog, 'utf8') : '').toBe('');
    expect(existsSync(fixture.apiEnvLog)).toBe(false);
    expect(existsSync(fixture.webEnvLog)).toBe(false);
  }, 10000);

  it('reuses a reachable default universal proxy URL without invoking docker', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-proxy-reuse-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });

    const result = runManagedProxyFixture(tempRoot, fixture, {
      MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: 'fixture-admin-token',
    });

    expect(result.status).toBe(17);
    expect(existsSync(fixture.dockerLog) ? readFileSync(fixture.dockerLog, 'utf8') : '').toBe('');
    expect(readFileSync(fixture.apiEnvLog, 'utf8')).toContain(
      'MBOS_UNIVERSAL_PROXY_BASE_URL=http://127.0.0.1:39080',
    );
    expect(readFileSync(fixture.apiEnvLog, 'utf8')).toContain(
      'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=fixture-admin-token',
    );
  }, 10000);

  it('does not reuse a reachable default universal proxy from a naked admin probe', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-proxy-naked-reuse-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });

    const result = runManagedProxyFixture(tempRoot, fixture, {});

    expect(result.status).toBe(17);
    expect(readFileSync(fixture.dockerLog, 'utf8')).toContain('docker run');
    expect(readFileSync(fixture.apiEnvLog, 'utf8')).toMatch(/MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=.+/);
  }, 15000);

  it('forces a managed locked proxy even when a default candidate URL is reachable', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-proxy-force-managed-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });

    const result = runManagedProxyFixture(tempRoot, fixture, {
      INTEGRATION_UNIVERSAL_PROXY_FORCE_MANAGED: '1',
      INTEGRATION_UNIVERSAL_PROXY_PORT: '39184',
      MBOS_UNIVERSAL_PROXY_BASE_URL: 'http://127.0.0.1:38080',
      MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: 'fixture-admin-token',
      MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST: '127.0.0.1',
    });

    expect(result.status).toBe(17);
    expect(result.stderr).toContain('UNIVERSAL_PROXY_RUNTIME_FORCE_MANAGED=1 ignores MBOS_UNIVERSAL_PROXY_BASE_URL=http://127.0.0.1:38080');
    const dockerLog = readFileSync(fixture.dockerLog, 'utf8');
    const apiEnv = readFileSync(fixture.apiEnvLog, 'utf8');
    const lockedImage = readLockedLlmupImage();
    expect(dockerLog).toContain(`docker pull ${lockedImage}`);
    expect(dockerLog).toContain(`docker run`);
    expect(dockerLog).toContain(lockedImage);
    expect(dockerLog).toContain('127.0.0.1:39184:8080');
    expect(apiEnv).toContain('MBOS_UNIVERSAL_PROXY_BASE_URL=http://127.0.0.1:39184');
    expect(apiEnv).toContain('MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST=host.docker.internal');
  }, 15000);

  it('starts a managed docker proxy from the locked llmup image when no candidate URL is reachable', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-proxy-managed-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'managed-container' });

    const result = runManagedProxyFixture(tempRoot, fixture, {});

    expect(result.status).toBe(17);
    const dockerLog = readFileSync(fixture.dockerLog, 'utf8');
    const apiEnv = readFileSync(fixture.apiEnvLog, 'utf8');
    const lockedImage = readLockedLlmupImage();
    expect(dockerLog).toContain(`docker pull ${lockedImage}`);
    expect(dockerLog).toContain(`docker run`);
    expect(dockerLog).toContain(lockedImage);
    expect(dockerLog).toContain('--add-host=host.docker.internal:host-gateway');
    expect(dockerLog).toContain('127.0.0.1:39080:8080');
    expect(apiEnv).toContain('MBOS_UNIVERSAL_PROXY_BASE_URL=http://127.0.0.1:39080');
    expect(apiEnv).toMatch(/MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=.+/);
    expect(apiEnv).toContain('MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST=host.docker.internal');
  }, 15000);

  it('does not start API/Web when managed proxy docker pull fails', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-proxy-pull-fail-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'managed-container', dockerMode: 'pull-fail' });

    const result = runManagedProxyFixture(tempRoot, fixture, {});

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pull_policy=missing');
    expect(result.stderr).toContain('network access to GHCR');
    expect(result.stderr).not.toContain(ghcrAuthFallbackHint);
    expect(result.stderr).toContain('MBOS_UNIVERSAL_PROXY_BASE_URL');
    expect(readFileSync(fixture.dockerLog, 'utf8')).toContain('docker pull');
    expect(existsSync(fixture.apiEnvLog)).toBe(false);
    expect(existsSync(fixture.webEnvLog)).toBe(false);
  }, 10000);

  it('does not start API/Web when managed proxy docker run fails', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-proxy-run-fail-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'managed-container', dockerMode: 'run-fail' });

    const result = runManagedProxyFixture(tempRoot, fixture, {});

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pull_policy=missing');
    expect(result.stderr).toContain('network access to GHCR');
    expect(result.stderr).not.toContain(ghcrAuthFallbackHint);
    expect(result.stderr).toContain('docker-run.stderr.log');
    expect(result.stderr).toContain('fake run failure');
    expect(result.stderr).toContain('MBOS_UNIVERSAL_PROXY_BASE_URL');
    expect(readFileSync(fixture.dockerLog, 'utf8')).toContain('docker run');
    expect(existsSync(fixture.apiEnvLog)).toBe(false);
    expect(existsSync(fixture.webEnvLog)).toBe(false);
  }, 10000);

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
MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=\${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}
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
	has_admin_bearer=0
	previous=""
	for arg in "$@"; do
	  if [[ "\${previous}" == "-H" && "\${arg}" == "Authorization: Bearer "* ]]; then
	    has_admin_bearer=1
	  fi
	  previous="\${arg}"
	done

	case "\${url}" in
	  */admin/state)
	    if [[ "\${has_admin_bearer}" == "1" ]]; then
	      status="200"
	    else
	      status="403"
	    fi
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
	          MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: 'fixture-admin-token',
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
	    expect(apiEnv).toContain('MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=fixture-admin-token');

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
