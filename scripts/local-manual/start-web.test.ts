import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

describe('local-manual start-web', () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('runs local-manual web with lane-private next output and explicit root contract protection', () => {
    const script = readFileSync(path.join(process.cwd(), 'scripts/local-manual/start-web.sh'), 'utf8');

    expect(script).toContain("NEXT_DIST_DIR='${LOCAL_MANUAL_NEXT_DIST_DIR}'");
    expect(script).toContain("NEXT_GENERATED_ROOT_MANAGED='1'");
    expect(script).toContain("NEXT_GENERATED_ROOT_STATE_DIR='${LOCAL_MANUAL_NEXT_ROOT_CONTRACT_DIR}'");
    expect(script).toContain("NEXT_DEV_PROCESS_STATE_FILE='${WEB_PROCESS_STATE_FILE}'");
    expect(script).toContain("exec npm run dev:test -- --port '${PORT_WEB}'");
  });

  it('launches the web wrapper in managed root mode and writes the readiness marker', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-start-web-'));
    tempRoots.push(tempRoot);

    const scriptsDir = path.join(tempRoot, 'scripts/local-manual');
    const runtimeRoot = path.join(tempRoot, 'artifacts/runtime/lines/local-manual/current');
    const launchCommandFile = path.join(tempRoot, 'launch-command.sh');

    mkdirSync(scriptsDir, { recursive: true });
    mkdirSync(runtimeRoot, { recursive: true });

    cpSync(
      path.join(process.cwd(), 'scripts/local-manual/start-web.sh'),
      path.join(scriptsDir, 'start-web.sh'),
    );

    writeFileSync(
      path.join(scriptsDir, 'common.sh'),
      `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${tempRoot}"
PORT_API=20000
PORT_WEB=3101
LOCALE="en-US"
LOCAL_MANUAL_NEXT_DIST_DIR="${runtimeRoot}/next-dist"
LOCAL_MANUAL_NEXT_ROOT_CONTRACT_DIR="${runtimeRoot}/next-root-contract"
WEB_PID_FILE="${runtimeRoot}/web.pid"
WEB_PORT_FILE="${runtimeRoot}/web.port"
WEB_PROCESS_STATE_FILE="${runtimeRoot}/web.process.json"
WEB_READY_FILE="${runtimeRoot}/web.ready"
WEB_LOG="${runtimeRoot}/web.log"
KEYCLOAK_URL="http://localhost:18080/realms"
KEYCLOAK_REALM="mbos"
KEYCLOAK_CLIENT_ID="agentsmith"
KEYCLOAK_BASE_URL="http://localhost:18080"
PUBLIC_KEYCLOAK_BASE_URL="http://localhost:18080"
INTERNAL_KEYCLOAK_BASE_URL="http://localhost:18080"
MONGO_URL="mongodb://localhost:17017"
MONGO_DB_NAME="mbos"

init_local_manual_env() {
  mkdir -p "${runtimeRoot}" "${runtimeRoot}/next-dist" "${runtimeRoot}/next-root-contract"
}
wait_port_free() {
  :
}
launch_detached() {
  printf '%s\\n' "$3" > "${launchCommandFile}"
  printf '%s\\n' "5100" > "$1"
}
wait_http() {
  :
}
write_ready_file() {
  printf 'ready\\n' > "$1"
}
`,
      'utf8',
    );

    execFileSync('bash', [path.join(scriptsDir, 'start-web.sh')], {
      cwd: tempRoot,
      stdio: 'pipe',
    });

    const launchCommand = readFileSync(launchCommandFile, 'utf8');
    expect(launchCommand).toContain("NEXT_GENERATED_ROOT_MANAGED='1'");
    expect(launchCommand).toContain(`NEXT_DIST_DIR='${path.join(runtimeRoot, 'next-dist')}'`);
    expect(launchCommand).toContain(`NEXT_GENERATED_ROOT_STATE_DIR='${path.join(runtimeRoot, 'next-root-contract')}'`);
    expect(launchCommand).toContain(`NEXT_DEV_PROCESS_STATE_FILE='${path.join(runtimeRoot, 'web.process.json')}'`);
    expect(launchCommand).toContain("exec npm run dev:test -- --port '3101'");
    expect(readFileSync(path.join(runtimeRoot, 'web.ready'), 'utf8')).toBe('ready\n');
  });
});
