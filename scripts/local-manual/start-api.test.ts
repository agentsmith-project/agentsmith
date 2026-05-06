import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

describe('local-manual start-api', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('captures the authoritative api listener pid into process-state after listener handoff', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts/local-manual/start-api.sh'), 'utf8');

    expect(script).toContain("capture_listener_pid \"${PORT_API}\" \"${API_PID_FILE}\" \"api\"");
    expect(script).toContain("local_manual_write_tracked_service_process_state api");
    expect(script).toContain("printf '%s\\n' \"${PORT_API}\" > \"${API_PORT_FILE}\"");
    expect(script).toContain("MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN='${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}'");
    expect(script).toContain("AGENT_EXECUTION_HTTP_BASE_URL='${AGENT_EXECUTION_HTTP_BASE_URL:-http://localhost:${PORT_API}}'");
    expect(script).toContain("AGENT_EXECUTION_WS_BASE_URL='${AGENT_EXECUTION_WS_BASE_URL:-}'");
    expect(script).not.toContain("AGENT_EXECUTION_WS_BASE_URL='${AGENT_EXECUTION_WS_BASE_URL:-ws://localhost:${PORT_API}}'");
  });

  it('writes api process-state after capture_listener_pid establishes the listener pid', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-start-api-'));
    tempRoots.push(tempRoot);

    const scriptsDir = path.join(tempRoot, 'scripts/local-manual');
    const runtimeRoot = path.join(tempRoot, 'artifacts/runtime/lines/local-manual/current');
    const processStateFile = path.join(runtimeRoot, 'api.process.json');
    const launchCommandFile = path.join(runtimeRoot, 'api-launch-command.sh');

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(runtimeRoot, { recursive: true });

    cpSync(
      path.join(process.cwd(), 'scripts/local-manual/start-api.sh'),
      path.join(scriptsDir, 'start-api.sh'),
    );

    writeFileSync(
      path.join(scriptsDir, 'common.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${tempRoot}"
PORT_API=20000
PORT_WEB=3101
API_PID_FILE="${runtimeRoot}/api.pid"
API_PORT_FILE="${runtimeRoot}/api.port"
API_PROCESS_STATE_FILE="${processStateFile}"
API_READY_FILE="${runtimeRoot}/api.ready"
API_LOG="${runtimeRoot}/api.log"
KEYCLOAK_BASE_URL="http://localhost:18080"
KEYCLOAK_REALM="mbos"
KEYCLOAK_CLIENT_ID="agentsmith"
PUBLIC_KEYCLOAK_BASE_URL="http://localhost:18080"
INTERNAL_KEYCLOAK_BASE_URL="http://localhost:18080"
KEYCLOAK_ISSUER_URL="http://localhost:18080/realms/mbos"
DATABASE_URL="postgres://localhost:15432/mbos"
REDIS_URL="redis://localhost:16379"
MONGO_URL="mongodb://localhost:17017"
MONGO_DB_NAME="mbos"
MINIO_ENDPOINT="localhost"
MINIO_PORT="19000"
MINIO_USE_SSL="0"
MINIO_ACCESS_KEY="minio"
MINIO_SECRET_KEY="miniostorage"
MINIO_BUCKET="artifacts"
	FILE_LIBRARY_CLIENT_POSTGRES_HOST="localhost"
	FILE_LIBRARY_CLIENT_POSTGRES_PORT="15432"
	MBOS_UNIVERSAL_PROXY_BASE_URL="http://localhost:38080"
	MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN="proxy-admin-token"

	init_local_manual_env() {
	  mkdir -p "${runtimeRoot}"
}
wait_port_free() {
  :
}
	launch_detached() {
	  printf '%s\\n' "4100" > "$1"
	  printf '%s\\n' "$3" > "${launchCommandFile}"
	}
wait_http() {
  :
}
capture_listener_pid() {
  printf '%s\\n' "4200" > "$2"
}
local_manual_write_tracked_service_process_state() {
  printf '%s|%s|%s|%s\\n' "$1" "$2" "$3" "$4" > "${processStateFile}"
}
write_ready_file() {
  printf 'ready\\n' > "$1"
}
`,
      'utf8',
    );

    execFileSync('bash', [path.join(scriptsDir, 'start-api.sh')], {
      cwd: tempRoot,
      env: {
        ...process.env,
        AGENT_EXECUTION_HTTP_BASE_URL: 'http://172.19.0.1:20000',
      },
      stdio: 'pipe',
    });

    expect(readFileSync(path.join(runtimeRoot, 'api.pid'), 'utf8')).toBe('4200\n');
    expect(readFileSync(path.join(runtimeRoot, 'api.port'), 'utf8')).toBe('20000\n');
    expect(readFileSync(processStateFile, 'utf8')).toBe('api|4200|start-api|20000\n');
    expect(readFileSync(path.join(runtimeRoot, 'api.ready'), 'utf8')).toBe('ready\n');
    expect(readFileSync(launchCommandFile, 'utf8')).toContain("MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN='proxy-admin-token'");
    expect(readFileSync(launchCommandFile, 'utf8')).toContain(
      "AGENT_EXECUTION_HTTP_BASE_URL='http://172.19.0.1:20000'",
    );
  });

  it('passes the kind gateway HTTP base when local internal runtime restarts the API', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts/local-manual/internal-common.sh'), 'utf8');

    expect(script).toContain('AGENT_EXECUTION_HTTP_BASE_URL="http://${kind_gateway}:${PORT_API}"');
    expect(script).toContain('AGENT_EXECUTION_WS_BASE_URL="ws://${kind_gateway}:${PORT_API}"');
  });
});
