import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
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
  const parentProcesses: ChildProcess[] = [];

  afterEach(() => {
    while (parentProcesses.length > 0) {
      const parentProcess = parentProcesses.pop();
      if (parentProcess?.pid) {
        parentProcess.kill('SIGTERM');
      }
    }
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
    afscpLifecycleLog: string;
    apiEnvLog: string;
    binDir: string;
    commandsLog: string;
    dockerLog: string;
    playwrightEnvLog: string;
    scriptPath: string;
    webEnvLog: string;
  } {
    const scriptsDir = path.join(tempRoot, 'scripts');
    const scriptsLibDir = path.join(scriptsDir, 'lib');
    const scriptsLocalManualDir = path.join(scriptsDir, 'local-manual');
    const infraSharedDir = path.join(tempRoot, 'infra', 'deploy', 'shared');
    const universalProxyConfigDir = path.join(infraSharedDir, 'universal-proxy');
    const binDir = path.join(tempRoot, 'bin');
    const stateRoot = path.join(tempRoot, 'artifacts', 'backend-real', 'current');
    const runId = 'managed-proxy-test-run';
    const apiEnvLog = path.join(tempRoot, 'api-env.log');
    const webEnvLog = path.join(tempRoot, 'web-env.log');
    const playwrightEnvLog = path.join(tempRoot, 'playwright-env.log');
    const commandsLog = path.join(tempRoot, 'commands.log');
    const dockerLog = path.join(tempRoot, 'docker.log');
    const afscpLifecycleLog = path.join(tempRoot, 'afscp-lifecycle.log');
    const dockerRunMarker = path.join(tempRoot, 'docker-run.marker');

    mkdirSync(scriptsLibDir, { recursive: true });
    mkdirSync(scriptsLocalManualDir, { recursive: true });
    mkdirSync(universalProxyConfigDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(path.join(tempRoot, 'artifacts', 'backend-real', 'runs'), { recursive: true });

    cpSync(path.join(process.cwd(), 'scripts', 'run-integration-e2e-full.sh'), path.join(scriptsDir, 'run-integration-e2e-full.sh'));
    cpSync(path.join(process.cwd(), 'scripts', 'lib', 'afscp-local-runtime.sh'), path.join(scriptsLibDir, 'afscp-local-runtime.sh'));
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
      path.join(scriptsLocalManualDir, 'internal-common.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

ensure_afscp_local_runtime() {
  {
    printf 'ensure\\n'
    printf 'AFSCP_BASE_URL=%s\\n' "\${AFSCP_BASE_URL:-}"
    printf 'AFSCP_EXPORT_GATEWAY_BASE_URL=%s\\n' "\${AFSCP_EXPORT_GATEWAY_BASE_URL:-}"
    printf 'AFSCP_DEFAULT_VOLUME_ID=%s\\n' "\${AFSCP_DEFAULT_VOLUME_ID:-}"
    printf 'AFSCP_CALLER_SERVICE=%s\\n' "\${AFSCP_CALLER_SERVICE:-}"
    printf 'AFSCP_BOOTSTRAP_CALLER_SERVICE=%s\\n' "\${AFSCP_BOOTSTRAP_CALLER_SERVICE:-}"
    printf 'AFSCP_ORCHESTRATOR_CALLER_SERVICE=%s\\n' "\${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-}"
    printf 'DATABASE_URL=%s\\n' "\${DATABASE_URL:-}"
  } >> "${afscpLifecycleLog}"
}

stop_afscp_local_runtime() {
  {
    printf 'stop\\n'
    printf 'AFSCP_BASE_URL=%s\\n' "\${AFSCP_BASE_URL:-}"
  } >> "${afscpLifecycleLog}"
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
  export RUNTIME_HOST_WEB_BASE_URL="http://127.0.0.1:\${web_port}"
  export KEYCLOAK_BASE_URL="http://127.0.0.1:\${keycloak_port}"
  export PUBLIC_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  export INTERNAL_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  export KEYCLOAK_REALM="\${keycloak_realm}"
  export KEYCLOAK_CLIENT_ID="\${KEYCLOAK_CLIENT_ID:-\${keycloak_client_id}}"
  export KEYCLOAK_ISSUER_URL="\${KEYCLOAK_BASE_URL}/realms/\${keycloak_realm}"
}

gate_evidence_init() { mkdir -p "$1"; }
gate_write_runtime_descriptor() { :; }
gate_write_resolved_env() {
  local evidence_dir="$1"
  cat > "\${evidence_dir}/resolved-env.json" <<EOF
{
  "AFSCP_BASE_URL": "\${AFSCP_BASE_URL:-}",
  "AFSCP_EXPORT_GATEWAY_BASE_URL": "\${AFSCP_EXPORT_GATEWAY_BASE_URL:-}",
  "AFSCP_DEFAULT_VOLUME_ID": "\${AFSCP_DEFAULT_VOLUME_ID:-}",
  "AFSCP_CALLER_SERVICE": "\${AFSCP_CALLER_SERVICE:-}",
  "AFSCP_SERVICE_TOKEN": "\${AFSCP_SERVICE_TOKEN:+[set]}",
  "AFSCP_BOOTSTRAP_CALLER_SERVICE": "\${AFSCP_BOOTSTRAP_CALLER_SERVICE:-}",
  "AFSCP_BOOTSTRAP_SERVICE_TOKEN": "\${AFSCP_BOOTSTRAP_SERVICE_TOKEN:+[set]}",
  "AFSCP_ORCHESTRATOR_CALLER_SERVICE": "\${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-}",
  "AFSCP_ORCHESTRATOR_SERVICE_TOKEN": "\${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:+[set]}"
}
EOF
}
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
NEXT_DEV_MEMORY_PROFILE=\${NEXT_DEV_MEMORY_PROFILE:-}
AFSCP_BASE_URL=\${AFSCP_BASE_URL:-}
AFSCP_EXPORT_GATEWAY_BASE_URL=\${AFSCP_EXPORT_GATEWAY_BASE_URL:-}
AFSCP_DEFAULT_VOLUME_ID=\${AFSCP_DEFAULT_VOLUME_ID:-}
AFSCP_CALLER_SERVICE=\${AFSCP_CALLER_SERVICE:-}
AFSCP_SERVICE_TOKEN=\${AFSCP_SERVICE_TOKEN:-}
AFSCP_BOOTSTRAP_CALLER_SERVICE=\${AFSCP_BOOTSTRAP_CALLER_SERVICE:-}
AFSCP_BOOTSTRAP_SERVICE_TOKEN=\${AFSCP_BOOTSTRAP_SERVICE_TOKEN:-}
AFSCP_ORCHESTRATOR_CALLER_SERVICE=\${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-}
AFSCP_ORCHESTRATOR_SERVICE_TOKEN=\${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-}
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
printf 'npm' >> "${commandsLog}"
for arg in "$@"; do
  printf ' %s' "\${arg}" >> "${commandsLog}"
done
printf '\\n' >> "${commandsLog}"

if [[ "$1" == "run" && "$2" == "api:node:dev" ]]; then
  cat > "${apiEnvLog}" <<EOF
PORT=\${PORT:-}
MBOS_UNIVERSAL_PROXY_BASE_URL=\${MBOS_UNIVERSAL_PROXY_BASE_URL:-}
MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=\${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}
MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST=\${MBOS_UNIVERSAL_PROXY_UPSTREAM_HOST:-}
AFSCP_BASE_URL=\${AFSCP_BASE_URL:-}
AFSCP_EXPORT_GATEWAY_BASE_URL=\${AFSCP_EXPORT_GATEWAY_BASE_URL:-}
AFSCP_DEFAULT_VOLUME_ID=\${AFSCP_DEFAULT_VOLUME_ID:-}
AFSCP_CALLER_SERVICE=\${AFSCP_CALLER_SERVICE:-}
AFSCP_SERVICE_TOKEN=\${AFSCP_SERVICE_TOKEN:-}
AFSCP_BOOTSTRAP_CALLER_SERVICE=\${AFSCP_BOOTSTRAP_CALLER_SERVICE:-}
AFSCP_BOOTSTRAP_SERVICE_TOKEN=\${AFSCP_BOOTSTRAP_SERVICE_TOKEN:-}
AFSCP_ORCHESTRATOR_CALLER_SERVICE=\${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-}
AFSCP_ORCHESTRATOR_SERVICE_TOKEN=\${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-}
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
printf 'npx' >> "${commandsLog}"
for arg in "$@"; do
  printf ' %s' "\${arg}" >> "${commandsLog}"
done
printf '\\n' >> "${commandsLog}"
if [[ "$1" == "playwright" && "$2" == "test" ]]; then
  cat > "${playwrightEnvLog}" <<EOF
BASE_URL=\${BASE_URL:-}
INTEGRATION_API_BASE=\${INTEGRATION_API_BASE:-}
MONGO_URL=\${MONGO_URL:-}
MONGO_DB_NAME=\${MONGO_DB_NAME:-}
AFSCP_BASE_URL=\${AFSCP_BASE_URL:-}
AFSCP_EXPORT_GATEWAY_BASE_URL=\${AFSCP_EXPORT_GATEWAY_BASE_URL:-}
AFSCP_DEFAULT_VOLUME_ID=\${AFSCP_DEFAULT_VOLUME_ID:-}
AFSCP_CALLER_SERVICE=\${AFSCP_CALLER_SERVICE:-}
AFSCP_SERVICE_TOKEN=\${AFSCP_SERVICE_TOKEN:-}
AFSCP_BOOTSTRAP_CALLER_SERVICE=\${AFSCP_BOOTSTRAP_CALLER_SERVICE:-}
AFSCP_BOOTSTRAP_SERVICE_TOKEN=\${AFSCP_BOOTSTRAP_SERVICE_TOKEN:-}
AFSCP_ORCHESTRATOR_CALLER_SERVICE=\${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-}
AFSCP_ORCHESTRATOR_SERVICE_TOKEN=\${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-}
EOF
  exit 17
fi
if [[ "$1" == "tsx" ]]; then
  exit 0
fi
exit 0
`,
    );

    writeExecutable(
      path.join(binDir, 'make'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'make' >> "${commandsLog}"
for arg in "$@"; do
  printf ' %s' "\${arg}" >> "${commandsLog}"
done
printf '\\n' >> "${commandsLog}"
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
  */api/test/system/workspaces/seed)
    status="200"
    ;;
  */en-US/login|*/login|*/login/workspace|*/system/login|*/workspaces/ws_default|*/workspaces/ws_default/projects|*/workspaces/ws_default/projects/proj_001/files)
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
      afscpLifecycleLog,
      apiEnvLog,
      binDir,
      commandsLog,
      dockerLog,
      playwrightEnvLog,
      scriptPath: path.join(scriptsDir, 'run-integration-e2e-full.sh'),
      webEnvLog,
    };
  }

  function runManagedProxyFixture(
    tempRoot: string,
    fixture: { binDir: string; scriptPath: string },
    extraEnv: Record<string, string>,
    specFile = 'e2e/example.spec.ts',
  ): ReturnType<typeof spawnSync> {
    return spawnSync('bash', [fixture.scriptPath, specFile], {
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

  function startParentOwnedFixtureProcess(ownerToken: string, serviceKind: 'api' | 'web'): ChildProcess {
    const child = spawn(
      'bash',
      [
        '-c',
        'export LOCAL_RUNTIME_TREE_ROOT_PID="${BASHPID}"; exec bash -c \'trap "exit 0" TERM INT; while true; do sleep 1; done\'',
      ],
      {
        env: {
          ...process.env,
          LOCAL_RUNTIME_OWNER_TOKEN: ownerToken,
          LOCAL_RUNTIME_SERVICE_KIND: serviceKind,
        },
        stdio: 'ignore',
      },
    );
    if (!child.pid) {
      throw new Error(`failed to start ${serviceKind} parent-owned fixture process`);
    }
    parentProcesses.push(child);
    execFileSync(
      'bash',
      [
        '-c',
        `for _ in $(seq 1 50); do if tr '\\0' '\\n' </proc/${child.pid}/environ 2>/dev/null | grep -q '^LOCAL_RUNTIME_TREE_ROOT_PID=${child.pid}$'; then exit 0; fi; sleep 0.02; done; exit 1`,
      ],
      { stdio: 'pipe' },
    );
    return child;
  }

  function buildParentStackReuseEnv(ownerToken: string, apiPid: number, webPid: number): Record<string, string> {
    return {
      INTEGRATION_PARENT_STACK_REUSE: 'true',
      INTEGRATION_PARENT_STACK_DEPS_READY: 'true',
      INTEGRATION_PARENT_STACK_DEPS_INIT_READY: 'true',
      INTEGRATION_PARENT_STACK_OWNER_TOKEN: ownerToken,
      INTEGRATION_PARENT_STACK_RUN_ROOT: '/tmp/parent-release-run',
      INTEGRATION_PARENT_STACK_PROCESS_STATE_DIR: '/tmp/parent-release-run/processes',
      INTEGRATION_PARENT_STACK_API_ROOT_PID: String(apiPid),
      INTEGRATION_PARENT_STACK_API_PID: String(apiPid),
      INTEGRATION_PARENT_STACK_WEB_ROOT_PID: String(webPid),
      INTEGRATION_PARENT_STACK_API_PORT: '28191',
      INTEGRATION_PARENT_STACK_WEB_PORT: '38191',
      INTEGRATION_PARENT_STACK_POSTGRES_PORT: '25432',
      INTEGRATION_PARENT_STACK_MONGO_PORT: '27027',
      INTEGRATION_PARENT_STACK_REDIS_PORT: '26379',
      INTEGRATION_PARENT_STACK_MINIO_API_PORT: '29000',
      INTEGRATION_PARENT_STACK_MINIO_CONSOLE_PORT: '29001',
      INTEGRATION_PARENT_STACK_KEYCLOAK_PORT: '28081',
      INTEGRATION_PARENT_STACK_API_BASE: 'http://127.0.0.1:28191',
      INTEGRATION_PARENT_STACK_WEB_BASE_URL: 'http://127.0.0.1:38191',
      INTEGRATION_PARENT_STACK_HOST_WEB_BASE_URL: 'http://127.0.0.1:38191',
      INTEGRATION_PARENT_STACK_KEYCLOAK_BASE_URL: 'http://127.0.0.1:28081',
      INTEGRATION_PARENT_STACK_KEYCLOAK_REALM: 'mbos',
      INTEGRATION_PARENT_STACK_KEYCLOAK_CLIENT_ID: 'agentsmith-web',
      INTEGRATION_PARENT_STACK_MONGO_URL: 'mongodb://mbos:mbos_dev_password@127.0.0.1:27027/admin',
      INTEGRATION_PARENT_STACK_MONGO_DB_NAME: 'mbos',
      INTEGRATION_PARENT_STACK_DATABASE_URL: 'postgresql://mbos:mbos_dev_password@localhost:25432/mbos',
      INTEGRATION_PARENT_STACK_REDIS_URL: 'redis://localhost:26379',
      INTEGRATION_PARENT_STACK_MINIO_ENDPOINT: 'localhost',
      INTEGRATION_PARENT_STACK_MINIO_PORT: '29000',
    };
  }

  it('fails closed before deps, API/Web, or Playwright when parent stack reuse lacks ownership truth', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-parent-reuse-missing-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });

    const result = runManagedProxyFixture(tempRoot, fixture, {
      INTEGRATION_PARENT_STACK_REUSE: 'true',
      INTEGRATION_BOOTSTRAP_DEPS: 'true',
      INTEGRATION_INIT_DEPS: 'true',
      INTEGRATION_ENSURE_DEFAULT_WORKSPACE: 'true',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('parent-owned existing stack reuse refused');
    expect(result.stderr).toContain('INTEGRATION_PARENT_STACK_DEPS_READY');
    expect(existsSync(fixture.apiEnvLog)).toBe(false);
    expect(existsSync(fixture.webEnvLog)).toBe(false);
    expect(existsSync(fixture.playwrightEnvLog)).toBe(false);
    expect(existsSync(fixture.commandsLog) ? readFileSync(fixture.commandsLog, 'utf8') : '').toBe('');
  }, 10000);

  it('runs only Playwright against a verified parent-owned stack in reuse mode', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-parent-reuse-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });
    const ownerToken = 'parent-stack-reuse-owner';
    const apiProcess = startParentOwnedFixtureProcess(ownerToken, 'api');
    const webProcess = startParentOwnedFixtureProcess(ownerToken, 'web');

    const result = runManagedProxyFixture(tempRoot, fixture, {
      ...buildParentStackReuseEnv(ownerToken, apiProcess.pid ?? 0, webProcess.pid ?? 0),
      INTEGRATION_BOOTSTRAP_DEPS: 'true',
      INTEGRATION_INIT_DEPS: 'true',
      INTEGRATION_ENSURE_DEFAULT_WORKSPACE: 'true',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(17);
    expect(existsSync(fixture.apiEnvLog)).toBe(false);
    expect(existsSync(fixture.webEnvLog)).toBe(false);
    expect(existsSync(fixture.dockerLog) ? readFileSync(fixture.dockerLog, 'utf8') : '').toBe('');
    expect(existsSync(fixture.afscpLifecycleLog)).toBe(false);
    const commands = readFileSync(fixture.commandsLog, 'utf8');
    expect(commands).toContain('npx playwright test');
    expect(commands).toContain('npx tsx scripts/integration-keycloak-init.ts --redirects-only');
    expect(commands).not.toContain('make deps-bootstrap');
    expect(commands).not.toContain('npm run integration:deps:init:postgres');
    expect(commands).not.toContain('npm run integration:deps:init:keycloak');
    expect(commands).not.toContain('scripts/ensure-default-workspace.ts');
    const playwrightEnv = readFileSync(fixture.playwrightEnvLog, 'utf8');
    expect(playwrightEnv).toContain('BASE_URL=http://127.0.0.1:38191');
    expect(playwrightEnv).toContain('INTEGRATION_API_BASE=http://127.0.0.1:28191');
  }, 10000);

  it('allows parent-owned stack reuse when Mongo URLs differ only by equivalent loopback hostnames', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-parent-reuse-mongo-loopback-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });
    const ownerToken = 'parent-stack-reuse-mongo-loopback-owner';
    const apiProcess = startParentOwnedFixtureProcess(ownerToken, 'api');
    const webProcess = startParentOwnedFixtureProcess(ownerToken, 'web');

    const result = runManagedProxyFixture(tempRoot, fixture, {
      ...buildParentStackReuseEnv(ownerToken, apiProcess.pid ?? 0, webProcess.pid ?? 0),
      INTEGRATION_PARENT_STACK_MONGO_URL: 'mongodb://mbos:mbos_dev_password@localhost:27027/admin',
      INTEGRATION_BOOTSTRAP_DEPS: 'true',
      INTEGRATION_INIT_DEPS: 'true',
      INTEGRATION_ENSURE_DEFAULT_WORKSPACE: 'true',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(17);
    expect(existsSync(fixture.apiEnvLog)).toBe(false);
    expect(existsSync(fixture.webEnvLog)).toBe(false);
    const playwrightEnv = readFileSync(fixture.playwrightEnvLog, 'utf8');
    expect(playwrightEnv).toContain('MONGO_URL=mongodb://mbos:mbos_dev_password@127.0.0.1:27027/admin');
  }, 10000);

  it.each([
    ['non-loopback host', 'mongodb://mbos:mbos_dev_password@mongo.example.test:27027/admin'],
    ['different port', 'mongodb://mbos:mbos_dev_password@localhost:27999/admin'],
  ])('refuses parent-owned stack reuse when Mongo URL has %s', (_caseName, parentMongoUrl) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-parent-reuse-mongo-refused-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });
    const ownerToken = `parent-stack-reuse-mongo-refused-${_caseName.replace(/[^a-z]/g, '-')}`;
    const apiProcess = startParentOwnedFixtureProcess(ownerToken, 'api');
    const webProcess = startParentOwnedFixtureProcess(ownerToken, 'web');

    const result = runManagedProxyFixture(tempRoot, fixture, {
      ...buildParentStackReuseEnv(ownerToken, apiProcess.pid ?? 0, webProcess.pid ?? 0),
      INTEGRATION_PARENT_STACK_MONGO_URL: parentMongoUrl,
      INTEGRATION_BOOTSTRAP_DEPS: 'true',
      INTEGRATION_INIT_DEPS: 'true',
      INTEGRATION_ENSURE_DEFAULT_WORKSPACE: 'true',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('parent-owned existing stack reuse refused');
    expect(result.stderr).toContain('INTEGRATION_PARENT_STACK_MONGO_URL');
    expect(existsSync(fixture.apiEnvLog)).toBe(false);
    expect(existsSync(fixture.webEnvLog)).toBe(false);
    expect(existsSync(fixture.playwrightEnvLog)).toBe(false);
  }, 10000);

  it('stays shell-syntax valid and wires next-dev lifecycle capture into the managed web launch', () => {
    expect(() => execFileSync('bash', ['-n', 'scripts/run-integration-e2e-full.sh'])).not.toThrow();

    const script = readFileSync('scripts/run-integration-e2e-full.sh', 'utf8');
    const clearLaneOwnerIndex = script.indexOf('next_generated_root_clear_lane_owner "${INTEGRATION_RUN_ROOT}"');
    const normalizeIndex = script.lastIndexOf('next_generated_root_normalize');

    expect(script).toContain('NEXT_WEB_PROCESS_STATE_FILE="${INTEGRATION_RUN_ROOT}/web.process.json"');
    expect(script).toContain('NEXT_DEV_EXIT_MARKER_FILE="${INTEGRATION_RUN_ROOT}/next-dev-exit.json"');
    expect(script).toContain('NEXT_DEV_MEMORY_PROFILE="${NEXT_DEV_MEMORY_PROFILE:-validation}"');
    expect(script).toContain('NEXT_DEV_PROCESS_STATE_FILE="${NEXT_WEB_PROCESS_STATE_FILE}"');
    expect(script).toContain('NEXT_DEV_PROCESS_KIND=web');
    expect(script).toContain('NEXT_DEV_PROCESS_CAPTURED_BY=run-integration-e2e-full');
    expect(script).toContain('NEXT_DEV_EXIT_MARKER_FILE="${NEXT_DEV_EXIT_MARKER_FILE}"');
    expect(script).toContain('next_generated_root_write_lane_owner "${INTEGRATION_RUN_ROOT}" "backend-real" "$$" "run-integration-e2e-full.sh"');
    expect(script).toContain('ORIGINAL_INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-}"');
    expect(script).toContain('export INTEGRATION_MONGO_PORT="${ORIGINAL_INTEGRATION_MONGO_PORT}"');
    expect(script).toContain('ORIGINAL_INTEGRATION_KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT:-}"');
    expect(script).toContain('export INTEGRATION_KEYCLOAK_PORT="${ORIGINAL_INTEGRATION_KEYCLOAK_PORT}"');
    expect(script).toContain('MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@127.0.0.1:${MONGO_PORT}/admin}"');
    expect(script).toContain('MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"');
    expect(script).toContain('export MONGO_URL MONGO_DB_NAME');
    expect(script).not.toContain('MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${MONGO_PORT}/admin}"');
    expect(script).toContain('"${PLAYWRIGHT_BASE_URL}/api/test/system/workspaces/seed"');
    expect(script).toContain('gate_record_preflight_check "${INTEGRATION_LOG_DIR}" "web_test_routes" "passed"');
    expect(script).toContain('capture_integration_lifecycle_observation "pre-stop"');
    expect(script).toContain('capture_integration_lifecycle_observation "post-stop"');
    expect(script).toContain('PARENT_STACK_REUSE_MODE="${INTEGRATION_PARENT_STACK_REUSE:-false}"');
    expect(script).toContain('require_parent_owned_existing_stack_reuse_truth()');
    expect(script).toContain('require_parent_owned_process_truth "INTEGRATION_PARENT_STACK_API_ROOT_PID" "api"');
    expect(script).toContain('require_parent_owned_process_truth "INTEGRATION_PARENT_STACK_WEB_ROOT_PID" "web"');
    expect(script).toContain('if parent_stack_reuse_enabled; then');
    expect(script).toContain('require_parent_owned_existing_stack_reuse_truth');
    expect(script).toContain('else\n  preflight_managed_agent_task_asbcp_env');
    expect(script).toContain('next_generated_root_clear_lane_owner "${INTEGRATION_RUN_ROOT}"');
    expect(script).toContain('next_generated_root_finalize_lane_cleanup');
    expect(script).toContain('UNIVERSAL_PROXY_RUNTIME_FORCE_MANAGED="${INTEGRATION_UNIVERSAL_PROXY_FORCE_MANAGED:-${UNIVERSAL_PROXY_RUNTIME_FORCE_MANAGED:-0}}"');
    expect(script).toContain('UNIVERSAL_PROXY_RUNTIME_UPSTREAM_HOST="${INTEGRATION_UNIVERSAL_PROXY_UPSTREAM_HOST:-${UNIVERSAL_PROXY_RUNTIME_UPSTREAM_HOST:-host.docker.internal}}"');
    expect(script).toContain('source "${ROOT_DIR}/scripts/lib/afscp-local-runtime.sh"');
    expect(script).toContain('resolve_afscp_local_runtime_defaults "${API_PORT}" "vol_integration"');
    expect(script).toContain('ensure_integration_afscp_local_runtime');
    expect(script).toContain('stop_integration_afscp_local_runtime');
    expect(script).toContain('sync_keycloak_redirects_for_current_runtime()');
    expect(script).toContain('npx tsx scripts/integration-keycloak-init.ts --redirects-only');
    expect(script.indexOf('sync_keycloak_redirects_for_current_runtime')).toBeLessThan(
      script.indexOf('gate_run_auth_preflight "${INTEGRATION_LOG_DIR}"'),
    );
    expect(clearLaneOwnerIndex).toBeGreaterThanOrEqual(0);
    expect(normalizeIndex).toBeGreaterThanOrEqual(0);
    expect(clearLaneOwnerIndex).toBeLessThan(normalizeIndex);
  });

  it('fails backend-real visual review before Playwright when managed sandbox env is missing', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-visual-sandbox-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });

    const result = runManagedProxyFixture(
      tempRoot,
      fixture,
      {
        AGENT_EXECUTION_WS_BASE_URL: '',
        INTERNAL_AGENT_K8S_NAMESPACE: '',
        ASBCP_INTERNAL_BASE_URL: '',
        ASBCP_SERVICE_KEY: '',
      },
      'e2e/integration-visual-review.spec.ts',
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Managed Agent Task backend-real coverage requires ASBCP bootstrap');
    expect(result.stderr).toContain('ASBCP_INTERNAL_BASE_URL');
    expect(result.stderr).toContain('ASBCP_SERVICE_KEY');
    expect(result.stderr).toContain('AGENT_EXECUTION_WS_BASE_URL');
    expect(result.stderr).toContain('INTERNAL_AGENT_K8S_NAMESPACE');
    expect(result.stderr).toContain('run-internal-agent-task-real-gate.sh --visual-review');
    expect(existsSync(fixture.apiEnvLog)).toBe(false);
    expect(existsSync(fixture.webEnvLog)).toBe(false);
    expect(existsSync(fixture.playwrightEnvLog)).toBe(false);
  }, 10000);

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
      'MONGO_URL="${MONGO_URL}"',
      'MONGO_DB_NAME="${MONGO_DB_NAME}"',
      'INTEGRATION_AGENT_TASK_RUNNER_BASE_DOCKER_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_BASE_DOCKER_IMAGE:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_REBUILD_BASE_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_REBUILD_BASE_IMAGE:-0}"',
      'INTEGRATION_AGENT_TASK_RUNNER_REBUILD_IMAGE="${INTEGRATION_AGENT_TASK_RUNNER_REBUILD_IMAGE:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_EMBEDDED="${INTEGRATION_AGENT_TASK_RUNNER_EMBEDDED:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS="${INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS:-mbos-context,feishu-docs,jira-ops}"',
      'INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_REQUIRED="${INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_REQUIRED:-1}"',
      'INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_DIR="${INTEGRATION_AGENT_TASK_RUNNER_BUILTIN_SKILLS_DIR:-}"',
      'INTEGRATION_AGENT_TASK_RUNNER_WORKSPACE_READY_TIMEOUT_MS="${INTEGRATION_AGENT_TASK_RUNNER_WORKSPACE_READY_TIMEOUT_MS:-120000}"',
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

  it('passes the resolved backend-real Mongo configuration into the Playwright process with loopback defaults', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-playwright-mongo-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });

    const result = runManagedProxyFixture(tempRoot, fixture, {
      MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: 'fixture-admin-token',
      INTEGRATION_MONGO_PORT: '',
      MONGO_PORT: '',
      MONGO_URL: '',
      MONGO_DB_NAME: '',
    });

    expect(result.status).toBe(17);
    const playwrightEnv = readFileSync(fixture.playwrightEnvLog, 'utf8');
    expect(playwrightEnv).toContain('BASE_URL=http://127.0.0.1:38191');
    expect(playwrightEnv).toContain('INTEGRATION_API_BASE=http://127.0.0.1:28191');
    expect(playwrightEnv).toContain('MONGO_URL=mongodb://mbos:mbos_dev_password@127.0.0.1:27027/admin');
    expect(playwrightEnv).toContain('MONGO_DB_NAME=mbos');
  }, 10000);

  it('derives the Playwright Mongo URL from the restored integration Mongo port override', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-playwright-mongo-port-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });

    const result = runManagedProxyFixture(tempRoot, fixture, {
      MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: 'fixture-admin-token',
      INTEGRATION_MONGO_PORT: '27999',
      MONGO_PORT: '',
      MONGO_URL: '',
      MONGO_DB_NAME: '',
    });

    expect(result.status).toBe(17);
    const playwrightEnv = readFileSync(fixture.playwrightEnvLog, 'utf8');
    expect(playwrightEnv).toContain('MONGO_URL=mongodb://mbos:mbos_dev_password@127.0.0.1:27999/admin');
    expect(playwrightEnv).toContain('MONGO_DB_NAME=mbos');
  }, 10000);

  it('resolves default AFSCP runtime env, injects it into API/Web/Playwright, and cleans up the owned runtime', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'run-integration-e2e-full-afscp-'));
    tempRoots.push(tempRoot);
    const fixture = prepareManagedProxyFixture(tempRoot, { curlMode: 'candidate-reachable' });

    const result = runManagedProxyFixture(tempRoot, fixture, {
      MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: 'fixture-admin-token',
      AFSCP_BASE_URL: '',
      AFSCP_EXPORT_GATEWAY_BASE_URL: '',
      AFSCP_DEFAULT_VOLUME_ID: '',
      AFSCP_CALLER_SERVICE: '',
      AFSCP_SERVICE_TOKEN: '',
      AFSCP_BOOTSTRAP_CALLER_SERVICE: '',
      AFSCP_BOOTSTRAP_SERVICE_TOKEN: '',
      AFSCP_ORCHESTRATOR_CALLER_SERVICE: '',
      AFSCP_ORCHESTRATOR_SERVICE_TOKEN: '',
    });

    expect(result.status).toBe(17);
    const resolvedEnv = JSON.parse(
      readFileSync(
        path.join(tempRoot, 'artifacts', 'backend-real', 'runs', 'managed-proxy-test-run', 'integration', 'resolved-env.json'),
        'utf8',
      ),
    ) as Record<string, string>;
    const expected = [
      'AFSCP_BASE_URL=http://127.0.0.1:37221',
      'AFSCP_EXPORT_GATEWAY_BASE_URL=http://127.0.0.1:37222',
      'AFSCP_DEFAULT_VOLUME_ID=vol_integration_28191',
      'AFSCP_CALLER_SERVICE=agentsmith-api',
      'AFSCP_SERVICE_TOKEN=agentsmith-local-afscp-product-token',
      'AFSCP_BOOTSTRAP_CALLER_SERVICE=agentsmith-bootstrap',
      'AFSCP_BOOTSTRAP_SERVICE_TOKEN=agentsmith-local-afscp-bootstrap-token',
      'AFSCP_ORCHESTRATOR_CALLER_SERVICE=agentsmith-sandbox-control-plane',
      'AFSCP_ORCHESTRATOR_SERVICE_TOKEN=agentsmith-local-afscp-orchestrator-token',
    ];
    for (const envLog of [
      readFileSync(fixture.apiEnvLog, 'utf8'),
      readFileSync(fixture.webEnvLog, 'utf8'),
      readFileSync(fixture.playwrightEnvLog, 'utf8'),
    ]) {
      for (const assignment of expected) {
        expect(envLog).toContain(assignment);
      }
    }

    expect(readFileSync(fixture.webEnvLog, 'utf8')).toContain('NEXT_DEV_MEMORY_PROFILE=validation');
    expect(resolvedEnv.AFSCP_BASE_URL).toBe('http://127.0.0.1:37221');
    expect(resolvedEnv.AFSCP_EXPORT_GATEWAY_BASE_URL).toBe('http://127.0.0.1:37222');
    expect(resolvedEnv.AFSCP_DEFAULT_VOLUME_ID).toBe('vol_integration_28191');
    expect(resolvedEnv.AFSCP_SERVICE_TOKEN).toBe('[set]');
    expect(resolvedEnv.AFSCP_BOOTSTRAP_SERVICE_TOKEN).toBe('[set]');
    expect(resolvedEnv.AFSCP_ORCHESTRATOR_SERVICE_TOKEN).toBe('[set]');
    expect(readFileSync(fixture.afscpLifecycleLog, 'utf8')).toContain('ensure');
    expect(readFileSync(fixture.afscpLifecycleLog, 'utf8')).toContain('stop');
  }, 10000);

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
    const scriptsLocalManualDir = path.join(scriptsDir, 'local-manual');
    const binDir = path.join(tempRoot, 'bin');
    const stateRoot = path.join(tempRoot, 'artifacts', 'backend-real', 'current');
    const runId = 'integration-test-run';
    const runRoot = path.join(tempRoot, 'artifacts', 'backend-real', 'runs', runId);
    const lifecycleDir = path.join(stateRoot, 'integration-lifecycle', runId);
    const webEnvLog = path.join(tempRoot, 'web-env.log');
    const apiEnvLog = path.join(tempRoot, 'api-env.log');
    const afscpLifecycleLog = path.join(tempRoot, 'afscp-lifecycle.log');
    const finalizeLog = path.join(tempRoot, 'finalize.log');

    mkdirSync(scriptsLibDir, { recursive: true });
    mkdirSync(scriptsLocalManualDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(path.join(tempRoot, 'artifacts', 'backend-real', 'runs'), { recursive: true });

    cpSync(path.join(process.cwd(), 'scripts', 'run-integration-e2e-full.sh'), path.join(scriptsDir, 'run-integration-e2e-full.sh'));
    cpSync(path.join(process.cwd(), 'scripts', 'lib', 'afscp-local-runtime.sh'), path.join(scriptsLibDir, 'afscp-local-runtime.sh'));
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
      path.join(scriptsLocalManualDir, 'internal-common.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

ensure_afscp_local_runtime() {
  {
    printf 'ensure\\n'
    printf 'AFSCP_BASE_URL=%s\\n' "\${AFSCP_BASE_URL:-}"
  } >> "${afscpLifecycleLog}"
}

stop_afscp_local_runtime() {
  {
    printf 'stop\\n'
    printf 'AFSCP_BASE_URL=%s\\n' "\${AFSCP_BASE_URL:-}"
  } >> "${afscpLifecycleLog}"
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
  export RUNTIME_HOST_WEB_BASE_URL="http://127.0.0.1:\${web_port}"
  export KEYCLOAK_BASE_URL="http://127.0.0.1:\${keycloak_port}"
  export PUBLIC_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  export INTERNAL_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  export KEYCLOAK_ISSUER_URL="\${KEYCLOAK_BASE_URL}/realms/\${keycloak_realm}"
  export KEYCLOAK_CLIENT_ID="\${KEYCLOAK_CLIENT_ID:-\${keycloak_client_id}}"
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
NEXT_DEV_MEMORY_PROFILE=\${NEXT_DEV_MEMORY_PROFILE:-}
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
  */api/test/system/workspaces/seed)
    if [[ -f "${tempRoot}/stop-web-probe" ]]; then
      status="000"
    else
      status="200"
    fi
    ;;
  */en-US/login|*/login|*/login/workspace|*/system/login|*/workspaces/ws_default|*/workspaces/ws_default/projects|*/workspaces/ws_default/projects/proj_001/files)
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

    expect(webEnv).toContain('NEXT_DEV_MEMORY_PROFILE=validation');
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
