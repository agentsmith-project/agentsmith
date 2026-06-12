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

describe('wait real stack ready runtime ownership contract', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('keeps API fallback on local-runtime ownership while Web uses run-next-dev-safe child state capture', () => {
    const script = readFileSync('scripts/wait-real-stack-ready.sh', 'utf8');

    expect(script).toContain('scripts/lib/local-runtime-processes.sh');
    expect(script).toContain('local_runtime_port_is_listening');
    expect(script).toContain('local_runtime_start_owned_service api');
    expect(script).toContain('local_runtime_capture_authoritative_service_pid');
    expect(script).not.toContain('local_runtime_start_owned_service web');

    expect(script).toContain('next_dev_pid_file="${state_dir}/next-dev.pid"');
    expect(script).toContain('next_dev_port_file="${state_dir}/next-dev.port"');
    expect(script).toContain('NEXT_DEV_PID_FILE="${next_dev_pid_file}"');
    expect(script).toContain('NEXT_DEV_PORT_FILE="${next_dev_port_file}"');
    expect(script).toContain('NEXT_DEV_PORT="${WEB_PORT}"');
    expect(script).toContain('web_process_state_file="${state_dir}/web.process.json"');
    expect(script).toContain('NEXT_DEV_PROCESS_STATE_FILE="${web_process_state_file}"');
    expect(script).toContain('NEXT_DEV_PROCESS_KIND=web');
    expect(script).toContain('NEXT_DEV_PROCESS_CAPTURED_BY=wait-real-stack-ready');
    expect(script).toContain('failed to capture authoritative web process state from ${web_process_state_file}');
    expect(script).not.toContain('failed to capture authoritative web pid from ${next_dev_pid_file}');

    expect(script).not.toContain('scripts/lib/port-utils.sh');
    expect(script).not.toMatch(/\bis_port_listening\b/);
    expect(script).not.toContain('start_background_job()');
  });

  it('preserves an explicit Keycloak base URL after runtime env reset', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'wait-real-stack-ready-'));
    tempRoots.push(tempRoot);

    const scriptsDir = path.join(tempRoot, 'scripts');
    const scriptsLibDir = path.join(scriptsDir, 'lib');
    const binDir = path.join(tempRoot, 'bin');
    const stateRoot = path.join(tempRoot, 'artifacts/backend-real/current');
    const curlArgsLog = path.join(tempRoot, 'curl-args.log');

    mkdirSync(scriptsLibDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    cpSync(path.join(process.cwd(), 'scripts/wait-real-stack-ready.sh'), path.join(scriptsDir, 'wait-real-stack-ready.sh'));
    cpSync(path.join(process.cwd(), 'scripts/lib/backend-real-state.sh'), path.join(scriptsLibDir, 'backend-real-state.sh'));
    cpSync(path.join(process.cwd(), 'scripts/lib/local-redis-auth.sh'), path.join(scriptsLibDir, 'local-redis-auth.sh'));

    writeFileSync(
      path.join(scriptsLibDir, 'local-runtime-processes.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

local_runtime_port_is_listening() {
  return 0
}
`,
      'utf8',
    );

    writeFileSync(
      path.join(scriptsLibDir, 'runtime-verification.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

clear_runtime_stack_env() {
  unset KEYCLOAK_BASE_URL KEYCLOAK_URL PUBLIC_KEYCLOAK_BASE_URL INTERNAL_KEYCLOAK_BASE_URL KEYCLOAK_ISSUER_URL
  unset RUNTIME_BROWSER_KEYCLOAK_BASE_URL RUNTIME_HOST_KEYCLOAK_BASE_URL RUNTIME_HOST_API_BASE_URL RUNTIME_BROWSER_WEB_BASE_URL
}

resolve_loopback_runtime_stack() {
  local api_port="$1"
  local web_port="$2"
  local keycloak_port="$3"
  local keycloak_realm="$4"

  RUNTIME_HOST_API_BASE_URL="http://127.0.0.1:\${api_port}"
  RUNTIME_BROWSER_WEB_BASE_URL="http://localhost:\${web_port}"
  RUNTIME_BROWSER_KEYCLOAK_BASE_URL="http://localhost:\${keycloak_port}"
  RUNTIME_HOST_KEYCLOAK_BASE_URL="http://127.0.0.1:\${keycloak_port}"
  KEYCLOAK_BASE_URL="\${RUNTIME_BROWSER_KEYCLOAK_BASE_URL}"
  PUBLIC_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  INTERNAL_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  KEYCLOAK_ISSUER_URL="\${KEYCLOAK_BASE_URL}/realms/\${keycloak_realm}"
  export RUNTIME_HOST_API_BASE_URL RUNTIME_BROWSER_WEB_BASE_URL RUNTIME_BROWSER_KEYCLOAK_BASE_URL RUNTIME_HOST_KEYCLOAK_BASE_URL
  export KEYCLOAK_BASE_URL PUBLIC_KEYCLOAK_BASE_URL INTERNAL_KEYCLOAK_BASE_URL KEYCLOAK_ISSUER_URL
}
`,
      'utf8',
    );

    writeFileSync(
      path.join(binDir, 'curl'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${curlArgsLog}"
exit 0
`,
      'utf8',
    );
    writeFileSync(path.join(binDir, 'kubectl'), '#!/usr/bin/env bash\nexit 1\n', 'utf8');
    chmodSync(path.join(binDir, 'curl'), 0o755);
    chmodSync(path.join(binDir, 'kubectl'), 0o755);

    execFileSync('bash', [path.join(scriptsDir, 'wait-real-stack-ready.sh')], {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        ROOT_DIR: tempRoot,
        BACKEND_REAL_STATE_DIR: stateRoot,
        API_PORT: '20090',
        WEB_PORT: '3091',
        KEYCLOAK_BASE_URL: 'http://localhost:28081',
      },
      stdio: 'pipe',
    });

    const curlArgs = readFileSync(curlArgsLog, 'utf8');

    expect(curlArgs).toContain('http://localhost:28081/realms/mbos/.well-known/openid-configuration');
    expect(curlArgs).not.toContain('http://localhost:18080/realms/mbos/.well-known/openid-configuration');
  });

  it('records the authoritative API listener pid from the shared local runtime helper while Web still uses run-next-dev-safe child state', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'wait-real-stack-ready-'));
    tempRoots.push(tempRoot);

    const scriptsDir = path.join(tempRoot, 'scripts');
    const scriptsLibDir = path.join(scriptsDir, 'lib');
    const binDir = path.join(tempRoot, 'bin');
    const stateRoot = path.join(tempRoot, 'artifacts/backend-real/current');
    const releaseReadyDir = path.join(stateRoot, 'release-ready');
    const ownedKindsLog = path.join(tempRoot, 'owned-service-kinds.log');
    const authoritativeApiLog = path.join(tempRoot, 'authoritative-api.log');
    const webEnvLog = path.join(tempRoot, 'web-env.log');

    mkdirSync(scriptsLibDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    cpSync(path.join(process.cwd(), 'scripts/wait-real-stack-ready.sh'), path.join(scriptsDir, 'wait-real-stack-ready.sh'));
    cpSync(path.join(process.cwd(), 'scripts/lib/backend-real-state.sh'), path.join(scriptsLibDir, 'backend-real-state.sh'));
    cpSync(path.join(process.cwd(), 'scripts/lib/local-redis-auth.sh'), path.join(scriptsLibDir, 'local-redis-auth.sh'));

    writeFileSync(
      path.join(scriptsLibDir, 'local-runtime-processes.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

local_runtime_port_is_listening() {
  return 1
}

local_runtime_start_owned_service() {
  local service_kind="$1"
  local port="$2"
  printf '%s:%s\\n' "\${service_kind}" "\${port}" >> "${ownedKindsLog}"
  if [[ "\${service_kind}" == "web" ]]; then
    echo "web should not use local_runtime_start_owned_service" >&2
    return 97
  fi
  printf '4100\\n'
}

local_runtime_capture_authoritative_service_pid() {
  local root_pid="$1"
  local service_kind="$2"
  local port="$3"
  printf '%s:%s:%s\\n' "\${root_pid}" "\${service_kind}" "\${port}" >> "${authoritativeApiLog}"
  printf '5100\\n'
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

  RUNTIME_HOST_API_BASE_URL="http://127.0.0.1:\${api_port}"
  RUNTIME_BROWSER_WEB_BASE_URL="http://localhost:\${web_port}"
  KEYCLOAK_BASE_URL="http://localhost:\${keycloak_port}"
  PUBLIC_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  INTERNAL_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  KEYCLOAK_ISSUER_URL="\${KEYCLOAK_BASE_URL}/realms/\${keycloak_realm}"
  export \
    RUNTIME_HOST_API_BASE_URL \
    RUNTIME_BROWSER_WEB_BASE_URL \
    KEYCLOAK_BASE_URL \
    PUBLIC_KEYCLOAK_BASE_URL \
    INTERNAL_KEYCLOAK_BASE_URL \
    KEYCLOAK_ISSUER_URL
}
`,
      'utf8',
    );

    writeFileSync(
      path.join(scriptsDir, 'run-next-dev-safe.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$(dirname "${releaseReadyDir}/placeholder")"
cat > "${webEnvLog}" <<EOF
NEXT_DEV_PID_FILE=\${NEXT_DEV_PID_FILE:-}
NEXT_DEV_PORT_FILE=\${NEXT_DEV_PORT_FILE:-}
NEXT_DEV_PORT=\${NEXT_DEV_PORT:-}
NEXT_DEV_PROCESS_STATE_FILE=\${NEXT_DEV_PROCESS_STATE_FILE:-}
NEXT_DEV_PROCESS_KIND=\${NEXT_DEV_PROCESS_KIND:-}
NEXT_DEV_PROCESS_CAPTURED_BY=\${NEXT_DEV_PROCESS_CAPTURED_BY:-}
EOF
printf '%s\\n' "\${NEXT_DEV_PORT}" > "\${NEXT_DEV_PORT_FILE}"
cat > "\${NEXT_DEV_PROCESS_STATE_FILE}" <<EOF
{
  "schema_version": 1,
  "kind": "web",
  "pid": 6200,
  "port": \${NEXT_DEV_PORT},
  "command": "next dev",
  "cwd": "${tempRoot}",
  "process_identity": {
    "token": "test-identity",
    "source": "wait-real-stack-ready.test"
  },
  "captured_at": "2026-04-17T00:00:00.000Z",
  "captured_by": "\${NEXT_DEV_PROCESS_CAPTURED_BY}"
}
EOF
sleep 1
`,
      'utf8',
    );

    writeFileSync(path.join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 0\n', 'utf8');
    writeFileSync(path.join(binDir, 'kubectl'), '#!/usr/bin/env bash\nexit 1\n', 'utf8');
    chmodSync(path.join(binDir, 'curl'), 0o755);
    chmodSync(path.join(binDir, 'kubectl'), 0o755);

    execFileSync('bash', [path.join(scriptsDir, 'wait-real-stack-ready.sh')], {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        ROOT_DIR: tempRoot,
        BACKEND_REAL_STATE_DIR: stateRoot,
        API_PORT: '20040',
        WEB_PORT: '3041',
        KEYCLOAK_PORT: '18080',
      },
      stdio: 'pipe',
    });

    const ownedKinds = readFileSync(ownedKindsLog, 'utf8').trim().split('\n');
    const authoritativeApiCalls = readFileSync(authoritativeApiLog, 'utf8').trim().split('\n');
    const webEnv = readFileSync(webEnvLog, 'utf8');
    const state = JSON.parse(readFileSync(path.join(stateRoot, 'state.json'), 'utf8')) as {
      services?: { local_api_pid?: string; local_web_pid?: string };
    };
    const processState = JSON.parse(readFileSync(path.join(releaseReadyDir, 'web.process.json'), 'utf8')) as {
      pid: number;
      port: number;
      captured_by: string;
    };

    expect(ownedKinds).toEqual(['api:20040']);
    expect(authoritativeApiCalls).toEqual(['4100:api:20040']);
    expect(webEnv).toContain(`NEXT_DEV_PID_FILE=${path.join(releaseReadyDir, 'next-dev.pid')}`);
    expect(webEnv).toContain(`NEXT_DEV_PORT_FILE=${path.join(releaseReadyDir, 'next-dev.port')}`);
    expect(webEnv).toContain('NEXT_DEV_PORT=3041');
    expect(webEnv).toContain(`NEXT_DEV_PROCESS_STATE_FILE=${path.join(releaseReadyDir, 'web.process.json')}`);
    expect(webEnv).toContain('NEXT_DEV_PROCESS_KIND=web');
    expect(webEnv).toContain('NEXT_DEV_PROCESS_CAPTURED_BY=wait-real-stack-ready');
    expect(existsSync(path.join(releaseReadyDir, 'next-dev.pid'))).toBe(false);
    expect(state.services?.local_api_pid).toBe('5100');
    expect(state.services?.local_web_pid).toBe('6200');
    expect(processState.pid).toBe(6200);
    expect(processState.port).toBe(3041);
    expect(processState.captured_by).toBe('wait-real-stack-ready');
  });

  it('keeps explicit release-ready API_PORT and WEB_PORT authoritative even when ambient integration ports are present', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'wait-real-stack-ready-'));
    tempRoots.push(tempRoot);

    const scriptsDir = path.join(tempRoot, 'scripts');
    const scriptsLibDir = path.join(scriptsDir, 'lib');
    const binDir = path.join(tempRoot, 'bin');
    const stateRoot = path.join(tempRoot, 'artifacts/backend-real/current');
    const releaseReadyDir = path.join(stateRoot, 'release-ready');
    const apiCallLog = path.join(tempRoot, 'api-call.log');
    const authoritativeApiLog = path.join(tempRoot, 'authoritative-api.log');
    const webEnvLog = path.join(tempRoot, 'web-env.log');

    mkdirSync(scriptsLibDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    cpSync(path.join(process.cwd(), 'scripts/wait-real-stack-ready.sh'), path.join(scriptsDir, 'wait-real-stack-ready.sh'));
    cpSync(path.join(process.cwd(), 'scripts/lib/backend-real-state.sh'), path.join(scriptsLibDir, 'backend-real-state.sh'));
    cpSync(path.join(process.cwd(), 'scripts/lib/local-redis-auth.sh'), path.join(scriptsLibDir, 'local-redis-auth.sh'));

    writeFileSync(
      path.join(scriptsLibDir, 'local-runtime-processes.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

local_runtime_port_is_listening() {
  return 1
}

local_runtime_start_owned_service() {
  local service_kind="$1"
  local port="$2"
  printf '%s:%s\\n' "\${service_kind}" "\${port}" >> "${apiCallLog}"
  printf '4100\\n'
}

local_runtime_capture_authoritative_service_pid() {
  local root_pid="$1"
  local service_kind="$2"
  local port="$3"
  printf '%s:%s:%s\\n' "\${root_pid}" "\${service_kind}" "\${port}" >> "${authoritativeApiLog}"
  printf '5100\\n'
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

  RUNTIME_HOST_API_BASE_URL="http://127.0.0.1:\${api_port}"
  RUNTIME_BROWSER_WEB_BASE_URL="http://localhost:\${web_port}"
  KEYCLOAK_BASE_URL="http://localhost:\${keycloak_port}"
  PUBLIC_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  INTERNAL_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  KEYCLOAK_ISSUER_URL="\${KEYCLOAK_BASE_URL}/realms/\${keycloak_realm}"
  export \
    RUNTIME_HOST_API_BASE_URL \
    RUNTIME_BROWSER_WEB_BASE_URL \
    KEYCLOAK_BASE_URL \
    PUBLIC_KEYCLOAK_BASE_URL \
    INTERNAL_KEYCLOAK_BASE_URL \
    KEYCLOAK_ISSUER_URL
}
`,
      'utf8',
    );

    writeFileSync(
      path.join(scriptsDir, 'run-next-dev-safe.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$(dirname "${releaseReadyDir}/placeholder")"
cat > "${webEnvLog}" <<EOF
NEXT_DEV_PORT=\${NEXT_DEV_PORT:-}
NEXT_PUBLIC_API_BASE=\${NEXT_PUBLIC_API_BASE:-}
EOF
printf '%s\\n' "\${NEXT_DEV_PORT}" > "\${NEXT_DEV_PORT_FILE}"
cat > "\${NEXT_DEV_PROCESS_STATE_FILE}" <<EOF
{
  "schema_version": 1,
  "kind": "web",
  "pid": 6200,
  "port": \${NEXT_DEV_PORT},
  "command": "next dev",
  "cwd": "${tempRoot}",
  "process_identity": {
    "token": "test-identity",
    "source": "wait-real-stack-ready.test"
  },
  "captured_at": "2026-04-17T00:00:00.000Z",
  "captured_by": "\${NEXT_DEV_PROCESS_CAPTURED_BY}"
}
EOF
sleep 1
`,
      'utf8',
    );

    writeFileSync(path.join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 0\n', 'utf8');
    writeFileSync(path.join(binDir, 'kubectl'), '#!/usr/bin/env bash\nexit 1\n', 'utf8');
    chmodSync(path.join(binDir, 'curl'), 0o755);
    chmodSync(path.join(binDir, 'kubectl'), 0o755);

    execFileSync('bash', [path.join(scriptsDir, 'wait-real-stack-ready.sh')], {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        ROOT_DIR: tempRoot,
        BACKEND_REAL_STATE_DIR: stateRoot,
        API_PORT: '20040',
        WEB_PORT: '3041',
        INTEGRATION_API_PORT: '29999',
        INTEGRATION_WEB_PORT: '39999',
        KEYCLOAK_PORT: '18080',
      },
      stdio: 'pipe',
    });

    expect(readFileSync(apiCallLog, 'utf8').trim().split('\n')).toEqual(['api:20040']);
    expect(readFileSync(authoritativeApiLog, 'utf8').trim().split('\n')).toEqual(['4100:api:20040']);
    expect(readFileSync(webEnvLog, 'utf8')).toContain('NEXT_DEV_PORT=3041');
    expect(readFileSync(webEnvLog, 'utf8')).toContain('NEXT_PUBLIC_API_BASE=http://localhost:20040/api/v1');
    expect(readFileSync(webEnvLog, 'utf8')).not.toContain('29999');
    expect(readFileSync(webEnvLog, 'utf8')).not.toContain('39999');
  });

  it('uses probe-only parent stack reuse without starting local API or Web services', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'wait-real-stack-ready-'));
    tempRoots.push(tempRoot);

    const scriptsDir = path.join(tempRoot, 'scripts');
    const scriptsLibDir = path.join(scriptsDir, 'lib');
    const binDir = path.join(tempRoot, 'bin');
    const stateRoot = path.join(tempRoot, 'artifacts/backend-real/current');
    const runtimeCallsLog = path.join(tempRoot, 'runtime-calls.log');
    const runNextLog = path.join(tempRoot, 'run-next.log');
    const curlArgsLog = path.join(tempRoot, 'curl-args.log');
    const kubectlLog = path.join(tempRoot, 'kubectl.log');

    mkdirSync(scriptsLibDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(stateRoot, { recursive: true });

    cpSync(path.join(process.cwd(), 'scripts/wait-real-stack-ready.sh'), path.join(scriptsDir, 'wait-real-stack-ready.sh'));
    cpSync(path.join(process.cwd(), 'scripts/lib/backend-real-state.sh'), path.join(scriptsLibDir, 'backend-real-state.sh'));
    cpSync(path.join(process.cwd(), 'scripts/lib/local-redis-auth.sh'), path.join(scriptsLibDir, 'local-redis-auth.sh'));

    writeFileSync(
      path.join(scriptsLibDir, 'local-runtime-processes.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

local_runtime_port_is_listening() {
  printf 'port-check:%s\\n' "$1" >> "${runtimeCallsLog}"
  return 1
}

local_runtime_start_owned_service() {
  printf 'start:%s:%s\\n' "$1" "$2" >> "${runtimeCallsLog}"
  return 97
}

local_runtime_capture_authoritative_service_pid() {
  printf 'capture:%s:%s:%s\\n' "$1" "$2" "$3" >> "${runtimeCallsLog}"
  return 97
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

  RUNTIME_HOST_API_BASE_URL="http://127.0.0.1:\${api_port}"
  RUNTIME_BROWSER_WEB_BASE_URL="http://localhost:\${web_port}"
  KEYCLOAK_BASE_URL="http://localhost:\${keycloak_port}"
  PUBLIC_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  INTERNAL_KEYCLOAK_BASE_URL="\${KEYCLOAK_BASE_URL}"
  KEYCLOAK_ISSUER_URL="\${KEYCLOAK_BASE_URL}/realms/\${keycloak_realm}"
  export \
    RUNTIME_HOST_API_BASE_URL \
    RUNTIME_BROWSER_WEB_BASE_URL \
    KEYCLOAK_BASE_URL \
    PUBLIC_KEYCLOAK_BASE_URL \
    INTERNAL_KEYCLOAK_BASE_URL \
    KEYCLOAK_ISSUER_URL
}
`,
      'utf8',
    );

    writeFileSync(
      path.join(scriptsDir, 'run-next-dev-safe.sh'),
      `#!/usr/bin/env bash
printf 'run-next-dev-safe should not run\\n' >> "${runNextLog}"
exit 98
`,
      'utf8',
    );

    writeFileSync(
      path.join(binDir, 'curl'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${curlArgsLog}"
exit 0
`,
      'utf8',
    );
    writeFileSync(
      path.join(binDir, 'kubectl'),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${kubectlLog}"
exit 0
`,
      'utf8',
    );
    writeFileSync(path.join(stateRoot, 'token.txt'), 'probe-token\n', 'utf8');
    chmodSync(path.join(binDir, 'curl'), 0o755);
    chmodSync(path.join(binDir, 'kubectl'), 0o755);

    execFileSync('bash', [path.join(scriptsDir, 'wait-real-stack-ready.sh')], {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        BACKEND_REAL_READY_PROBE_ONLY: '1',
        INTEGRATION_PARENT_STACK_REUSE: 'true',
        BACKEND_REAL_STATE_DIR: stateRoot,
        API_PORT: '20090',
        WEB_PORT: '3091',
        KEYCLOAK_PORT: '28081',
        API_BASE: 'http://127.0.0.1:20090',
        BASE_URL: 'http://localhost:3091',
      },
      stdio: 'pipe',
    });

    expect(existsSync(runtimeCallsLog)).toBe(false);
    expect(existsSync(runNextLog)).toBe(false);
    expect(existsSync(kubectlLog)).toBe(false);
    expect(readFileSync(curlArgsLog, 'utf8').trim().split('\n')).toEqual([
      '-fsS http://localhost:28081/realms/mbos/.well-known/openid-configuration',
      '-fsS http://127.0.0.1:20090/api/v1/openapi.json',
      '-fsS http://localhost:3091/api/public/workspaces',
    ]);
  });
});
