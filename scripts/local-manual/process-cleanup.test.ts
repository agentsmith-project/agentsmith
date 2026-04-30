import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveInvalidLocalManualRunnerNormalizationCases } from './owner-janitor.js';

const repoRoot = process.cwd();

function extractFunctionBody(source: string, functionName: string): string {
  const signature = `${functionName}() {`;
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`missing function: ${functionName}`);
  }

  let depth = 0;
  let bodyStart = -1;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      if (bodyStart === -1) {
        bodyStart = index + 1;
      }
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart, index);
      }
    }
  }

  throw new Error(`unterminated function: ${functionName}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readOptionalFile(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function execBashCapture(args: {
  script: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('bash', ['-lc', args.script], {
    cwd: args.cwd,
    env: args.env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function writeProcessStateFile(args: {
  file: string;
  kind: 'web' | 'api';
  pid: number;
  port: number;
  token?: string;
  tokenSource?: string;
  command?: string;
  cwd?: string;
  capturedBy?: string;
}) {
  writeFileSync(
    args.file,
    `${JSON.stringify({
      schema_version: 1,
      kind: args.kind,
      pid: args.pid,
      port: args.port,
      command: args.command ?? `test-${args.kind}`,
      cwd: args.cwd ?? repoRoot,
      process_identity: {
        token: args.token ?? `token-${args.pid}`,
        source: args.tokenSource ?? 'test',
      },
      captured_at: '2026-04-14T00:00:00.000Z',
      captured_by: args.capturedBy ?? 'process-cleanup.test',
    }, null, 2)}\n`,
    'utf8',
  );
}

function readLinuxBootProcessIdentityToken(pid: number): string {
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const statRaw = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const closeParen = statRaw.lastIndexOf(')');
  if (!bootId || closeParen === -1) {
    throw new Error(`failed to read live process identity for pid ${pid}`);
  }
  const trailing = statRaw.slice(closeParen + 2).trim().split(/\s+/);
  const startTime = trailing[19];
  if (!startTime) {
    throw new Error(`missing process start time for pid ${pid}`);
  }
  return `linux:boot=${bootId}:start=${startTime}`;
}

async function waitForPidExit(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await sleep(100);
  }
  return !isPidAlive(pid);
}

async function waitForPidAlive(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPidAlive(pid)) {
      return true;
    }
    await sleep(100);
  }
  return isPidAlive(pid);
}

function killProcessTreeGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Ignore cleanup failures.
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Ignore cleanup failures.
  }
}

function reserveTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to reserve tcp port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function writeFakeServiceServerScript(tempRoot: string, kind: 'web' | 'api') {
  const relativePath =
    kind === 'web' ? 'node_modules/next/dist/bin/next' : 'packages/api-entry-node/dev-server.js';
  const scriptPath = path.join(tempRoot, relativePath);
  mkdirSync(path.dirname(scriptPath), { recursive: true });
  writeFileSync(
    scriptPath,
    `const http = require('node:http');
const args = process.argv.slice(2);
const getArg = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    return '';
  }
  return String(args[index + 1]);
};
const portValue = getArg('--port') || process.env.PORT || '${kind === 'web' ? '3001' : '20000'}';
const port = Number.parseInt(portValue, 10);
if (!Number.isFinite(port) || port <= 0) {
  throw new Error('missing --port/PORT');
}
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('${kind}\\n');
});
server.listen(port, '127.0.0.1');
setInterval(() => {}, 1000);
`,
    'utf8',
  );
  return scriptPath;
}

function spawnDetachedServiceProcess(args: {
  tempRoot: string;
  kind: 'web' | 'api';
  port: number;
  cwd?: string;
  label?: string;
}): number {
  const scriptPath = writeFakeServiceServerScript(args.tempRoot, args.kind);
  const cwd = args.cwd ?? repoRoot;
  const label = args.label ?? `local-manual-${args.kind}`;
  const launcherScript = path.join(args.tempRoot, `${args.kind}-service-launcher-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`);
  writeFileSync(
    launcherScript,
    `#!/usr/bin/env bash
set -euo pipefail
cd "${cwd}"
exec -a "${label}" node "${scriptPath}" --port "${args.port}"
`,
    'utf8',
  );
  chmodSync(launcherScript, 0o755);

  const pid = Number.parseInt(
    execFileSync(
      'bash',
      ['-lc', `setsid bash "${launcherScript}" >/dev/null 2>&1 < /dev/null & echo $!`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    ).trim(),
    10,
  );
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`failed to spawn detached ${args.kind} service process`);
  }
  return pid;
}

function listenerPidsForPort(port: number): number[] {
  const raw = execFileSync(
    'bash',
    ['-lc', `lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true`],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  ).trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

async function waitForServiceListenerReady(args: {
  pid: number;
  port: number;
  timeoutMs?: number;
}): Promise<boolean> {
  const deadline = Date.now() + (args.timeoutMs ?? 2_000);
  while (Date.now() < deadline) {
    if (!isPidAlive(args.pid)) {
      return false;
    }
    if (listenerPidsForPort(args.port).includes(args.pid)) {
      return true;
    }
    await sleep(50);
  }
  return isPidAlive(args.pid) && listenerPidsForPort(args.port).includes(args.pid);
}

async function spawnReadyDetachedServiceProcess(args: {
  tempRoot: string;
  kind: 'web' | 'api';
  cwd?: string;
  label?: string;
  attempts?: number;
  reservePort?: () => Promise<number>;
}): Promise<{ pid: number; port: number }> {
  const attempts = args.attempts ?? 5;
  const reservePort = args.reservePort ?? reserveTcpPort;
  let lastFailure = `failed to launch detached ${args.kind} service`;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const port = await reservePort();
    const pid = spawnDetachedServiceProcess({
      tempRoot: args.tempRoot,
      kind: args.kind,
      port,
      cwd: args.cwd,
      label: args.label,
    });
    const ready = await waitForServiceListenerReady({ pid, port });
    if (ready) {
      return { pid, port };
    }
    lastFailure = `detached ${args.kind} service failed to bind reserved port ${port} on attempt ${attempt}/${attempts}`;
    killProcessTreeGroup(pid);
    await waitForPidExit(pid, 1_000);
  }
  throw new Error(lastFailure);
}

function writeOwnedRunnerTreeScripts(tempRoot: string) {
  const level1Script = path.join(tempRoot, 'runner-level-1.sh');
  const level2Script = path.join(tempRoot, 'runner-level-2.sh');
  const level3Script = path.join(tempRoot, 'runner-level-3.sh');
  const fakeTsxCli = path.join(tempRoot, 'node_modules/tsx/dist/cli.mjs');
  mkdirSync(path.dirname(fakeTsxCli), { recursive: true });
  writeFileSync(
    fakeTsxCli,
    'setInterval(() => {}, 1000);\\n',
    'utf8',
  );

  writeFileSync(
    level1Script,
    `#!/usr/bin/env bash
set -euo pipefail
bash -lc 'exec -a "make notebook-runner" bash "${level2Script}"' &
child=$!
wait "$child"
`,
    'utf8',
  );
  chmodSync(level1Script, 0o755);

  writeFileSync(
    level2Script,
    `#!/usr/bin/env bash
set -euo pipefail
bash -lc 'exec -a "npm run dev -w @mbos/notebook-codex-runner" bash "${level3Script}"' &
child=$!
wait "$child"
`,
    'utf8',
  );
  chmodSync(level2Script, 0o755);

  writeFileSync(
    level3Script,
    `#!/usr/bin/env bash
set -euo pipefail
cd "${path.join(repoRoot, 'packages/notebook-codex-runner')}"
exec node "${fakeTsxCli}" src/index.ts
`,
    'utf8',
  );
  chmodSync(level3Script, 0o755);

  return { level1Script };
}

function spawnDetachedOwnedRunnerTree(tempRoot: string, rootLabel = 'make notebook-agent-runner'): number {
  const { level1Script } = writeOwnedRunnerTreeScripts(tempRoot);
  const launcherScript = path.join(tempRoot, 'runner-launcher.sh');
  writeFileSync(
    launcherScript,
    `#!/usr/bin/env bash
set -euo pipefail
exec -a "${rootLabel}" bash "${level1Script}"
`,
    'utf8',
  );
  chmodSync(launcherScript, 0o755);

  const pid = Number.parseInt(
    execFileSync(
      'bash',
      ['-lc', `setsid bash "${launcherScript}" >/dev/null 2>&1 < /dev/null & echo $!`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    ).trim(),
    10,
  );
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error('failed to spawn owned runner tree');
  }
  return pid;
}

function spawnDetachedSiblingProcess(label = 'make notebook-runner unrelated-sibling'): number {
  const siblingScript = path.join(os.tmpdir(), `local-manual-sibling-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`);
  writeFileSync(
    siblingScript,
    `#!/usr/bin/env bash
set -euo pipefail
exec -a "${label}" sleep 300
`,
    'utf8',
  );
  chmodSync(siblingScript, 0o755);

  const pid = Number.parseInt(
    execFileSync(
      'bash',
      ['-lc', `setsid bash "${siblingScript}" >/dev/null 2>&1 < /dev/null & echo $!`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    ).trim(),
    10,
  );
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error('failed to spawn sibling process');
  }
  return pid;
}

function setupRealCommonFixture(args?: { apiPort?: number; webPort?: number }) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-process-cleanup-real-'));
  const backendRealRoot = path.join(tempRoot, 'artifacts/backend-real/current');
  const runtimeLinesRoot = path.join(tempRoot, 'artifacts/runtime/lines');
  const envFile = path.join(tempRoot, '.env.local-manual');
  mkdirSync(backendRealRoot, { recursive: true });
  mkdirSync(runtimeLinesRoot, { recursive: true });
  writeFileSync(
    envFile,
    `PORT_API=${args?.apiPort ?? 20000}
PORT_WEB=${args?.webPort ?? 3001}
`,
    'utf8',
  );

  const localManualRoot = path.join(runtimeLinesRoot, 'local-manual/current');

  return {
    tempRoot,
    envFile,
    backendRealRoot,
    runtimeLinesRoot,
    localManualRoot,
    runnerPidFile: path.join(runtimeLinesRoot, 'local-manual/current/runner.pid'),
    runnerReadyFile: path.join(runtimeLinesRoot, 'local-manual/current/runner.ready'),
    webPidFile: path.join(runtimeLinesRoot, 'local-manual/current/web.pid'),
    webPortFile: path.join(runtimeLinesRoot, 'local-manual/current/web.port'),
    webProcessFile: path.join(runtimeLinesRoot, 'local-manual/current/web.process.json'),
    webReadyFile: path.join(runtimeLinesRoot, 'local-manual/current/web.ready'),
    apiPidFile: path.join(runtimeLinesRoot, 'local-manual/current/api.pid'),
    apiPortFile: path.join(runtimeLinesRoot, 'local-manual/current/api.port'),
    apiProcessFile: path.join(runtimeLinesRoot, 'local-manual/current/api.process.json'),
    apiReadyFile: path.join(runtimeLinesRoot, 'local-manual/current/api.ready'),
    webEvidenceFile: path.join(runtimeLinesRoot, 'local-manual/current/evidence/web/stop-authority.json'),
    apiEvidenceFile: path.join(runtimeLinesRoot, 'local-manual/current/evidence/api/stop-authority.json'),
  };
}

function setupCommonFixture() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-process-cleanup-'));
  const scriptsLocalManualDir = path.join(tempRoot, 'scripts/local-manual');
  const scriptsLibDir = path.join(tempRoot, 'scripts/lib');
  const scriptsScenariosDir = path.join(tempRoot, 'scripts/scenarios');
  const scriptsSubstrateDir = path.join(tempRoot, 'scripts/substrate');
  const runtimeRoot = path.join(tempRoot, 'artifacts/runtime/lines/local-manual/current');
  const nodeBinDir = path.join(tempRoot, 'node_modules/.bin');
  const planFile = path.join(tempRoot, 'janitor-plan.json');

  mkdirSync(scriptsLocalManualDir, { recursive: true });
  mkdirSync(scriptsLibDir, { recursive: true });
  mkdirSync(scriptsScenariosDir, { recursive: true });
  mkdirSync(scriptsSubstrateDir, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(nodeBinDir, { recursive: true });

  cpSync(
    path.join(process.cwd(), 'scripts/local-manual/common.sh'),
    path.join(scriptsLocalManualDir, 'common.sh'),
  );

  writeFileSync(
    path.join(scriptsLibDir, 'backend-real-state.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
ensure_backend_real_state() { :; }
backend_real_prune_forbidden_current_entries() { :; }
backend_real_state_file() { printf '%s\\n' "${tempRoot}/backend-real-state.json"; }
backend_real_token_file() { printf '%s\\n' "${tempRoot}/backend-real.token"; }
`,
    'utf8',
  );

  writeFileSync(
    path.join(scriptsLibDir, 'runtime-line-state.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
ensure_runtime_line_current_root() {
  mkdir -p "${runtimeRoot}"
  printf '%s\\n' "${runtimeRoot}"
}
local_manual_next_dist_dir() {
  printf '%s\\n' "${runtimeRoot}/next-dist"
}
`,
    'utf8',
  );

  writeFileSync(
    path.join(scriptsLibDir, 'runtime-config.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
load_runtime_env_stack() { :; }
`,
    'utf8',
  );

  writeFileSync(
    path.join(scriptsLibDir, 'runtime-verification.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
gate_evidence_init() { mkdir -p "$1/runner"; }
gate_write_runtime_descriptor() { :; }
gate_write_resolved_env() { :; }
gate_record_task_summary() { :; }
gate_record_preflight_check() {
  mkdir -p "${tempRoot}"
  printf 'preflight:%s|%s|%s\\n' "$2" "$3" "$4" >> "${tempRoot}/evidence-events.log"
}
gate_record_failure() {
  mkdir -p "${tempRoot}"
  printf 'failure:%s|%s|%s\\n' "$2" "$3" "$4" >> "${tempRoot}/evidence-events.log"
}
`,
    'utf8',
  );

  writeFileSync(
    path.join(scriptsScenariosDir, 'common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
state_write_summary() { :; }
`,
    'utf8',
  );

  writeFileSync(
    path.join(scriptsSubstrateDir, 'common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
SUBSTRATE_CONNECTION_ENV="${tempRoot}/missing-substrate.env"
SUBSTRATE_KEYCLOAK_BASE_URL="http://localhost:18080"
SUBSTRATE_KEYCLOAK_REALM="mbos"
SUBSTRATE_KEYCLOAK_CLIENT_ID="agentsmith"
SUBSTRATE_KEYCLOAK_ISSUER_URL="http://localhost:18080/realms/mbos"
SUBSTRATE_PROXY_BASE_URL="http://127.0.0.1:38080"
SUBSTRATE_PROXY_READY_FILE="${runtimeRoot}/proxy.ready"
stop_pid_file_if_running() {
  printf 'stop-pid:%s\\n' "$2" >> "${tempRoot}/events.log"
  rm -f "$1"
}
`,
    'utf8',
  );

writeFileSync(
    path.join(nodeBinDir, 'tsx'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -ge 1 && "\${*: -1}" == "--normalize-plan-stdin" ]]; then
  args=("$@")
  exec "${path.join(process.cwd(), 'node_modules/.bin/tsx')}" "${path.join(process.cwd(), 'scripts/local-manual/owner-janitor.ts')}" "\${args[@]:1}"
fi
cat "${planFile}"
`,
    { mode: 0o755 },
  );

  return {
    tempRoot,
    runtimeRoot,
    commonScript: path.join(scriptsLocalManualDir, 'common.sh'),
    planFile,
    eventsFile: path.join(tempRoot, 'events.log'),
    evidenceEventsFile: path.join(tempRoot, 'evidence-events.log'),
    runnerPidFile: path.join(runtimeRoot, 'runner.pid'),
    runnerReadyFile: path.join(runtimeRoot, 'runner.ready'),
    webPidFile: path.join(runtimeRoot, 'web.pid'),
    webReadyFile: path.join(runtimeRoot, 'web.ready'),
    webPortFile: path.join(runtimeRoot, 'web.port'),
    webProcessFile: path.join(runtimeRoot, 'web.process.json'),
    webEvidenceFile: path.join(runtimeRoot, 'evidence/web/stop-authority.json'),
    apiPidFile: path.join(runtimeRoot, 'api.pid'),
    apiReadyFile: path.join(runtimeRoot, 'api.ready'),
    apiPortFile: path.join(runtimeRoot, 'api.port'),
    apiProcessFile: path.join(runtimeRoot, 'api.process.json'),
    apiEvidenceFile: path.join(runtimeRoot, 'evidence/api/stop-authority.json'),
    degradedEvidenceFile: path.join(runtimeRoot, 'evidence/runner/stop-owner-janitor.json'),
  };
}

const tempRoots: string[] = [];
const plannerFallbackCases = [
  {
    label: 'empty',
    planContent: '',
    reason: 'planner_unavailable',
  },
  {
    label: 'malformed',
    planContent: '{bad json',
    reason: 'planner_malformed',
  },
] as const;

const derivedPlannerMalformedSentinelCases = (() => {
  const invalidCases = deriveInvalidLocalManualRunnerNormalizationCases();
  const replaceRunnerCase = invalidCases.find((invalidCase) => (
    invalidCase.intent === 'replace_runner'
    && invalidCase.expectedFallback.action === 'block'
  ));
  const stopLineCase = invalidCases.find((invalidCase) => (
    invalidCase.intent === 'stop_line'
    && invalidCase.expectedFallback.action === 'mark_degraded'
  ));

  if (!replaceRunnerCase || !stopLineCase) {
    throw new Error('missing derived planner malformed sentinel cases');
  }

  return [replaceRunnerCase, stopLineCase] as const;
})();

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

describe('local-manual process cleanup contract', () => {
  it('keeps tracked cleanup as the default lifecycle path and isolates untracked cleanup behind rescue mode', () => {
    const common = readFileSync(path.join(process.cwd(), 'scripts/local-manual/common.sh'), 'utf8');
    const stopBody = extractFunctionBody(common, 'stop_local_manual_processes');
    const rescueBody = extractFunctionBody(common, 'rescue_stop_untracked_local_manual_processes');

    expect(common).toContain('LOCAL_MANUAL_ALLOW_UNTRACKED_PROCESS_RESCUE');
    expect(common).toContain('WEB_LAUNCHER_PID_FILE');
    expect(stopBody).toContain('stop_local_manual_runner_owner_aware');
    expect(stopBody).toContain('stop_local_manual_tracked_service_owner_aware web');
    expect(stopBody).toContain('stop_local_manual_web_launcher_owner_aware');
    expect(stopBody).toContain('stop_local_manual_tracked_service_owner_aware api');
    expect(stopBody).not.toContain('stop_pid_file_if_running');
    expect(stopBody).not.toContain('stop_matching_processes');
    expect(stopBody).not.toContain('stop_listeners_on_port');
    expect(rescueBody).toContain('stop_matching_processes');
    expect(rescueBody).toContain('stop_listeners_on_port');
  });

  it('reclaims a half-started web launcher pid that was written before Next owner state existed', async () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);
    const launcherScript = path.join(fixture.tempRoot, 'web-launcher-without-owner-state.sh');
    writeFileSync(
      launcherScript,
      `#!/usr/bin/env bash
set -euo pipefail
exec -a "npm run dev:test -- --port 3001" sleep 300
`,
      'utf8',
    );
    chmodSync(launcherScript, 0o755);
    const launcherPid = Number.parseInt(
      execFileSync(
        'bash',
        ['-lc', `setsid bash "${launcherScript}" >/dev/null 2>&1 < /dev/null & echo $!`],
        {
          cwd: fixture.tempRoot,
          encoding: 'utf8',
          stdio: 'pipe',
        },
      ).trim(),
      10,
    );

    try {
      expect(await waitForPidAlive(launcherPid)).toBe(true);
      writeFileSync(fixture.webPidFile, `${launcherPid}\n`, 'utf8');
      writeFileSync(fixture.webReadyFile, 'ready\n', 'utf8');

      execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${fixture.commonScript}"
            init_local_manual_env
            stop_local_manual_processes
          `,
        ],
        {
          cwd: fixture.tempRoot,
          env: {
            ...process.env,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
            PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
          },
          stdio: 'pipe',
        },
      );

      expect(existsSync(fixture.webPidFile)).toBe(false);
      expect(existsSync(fixture.webReadyFile)).toBe(false);
      expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"authority": "launcher_reclaimable"');
    } finally {
      killProcessTreeGroup(launcherPid);
    }
  }, 10_000);

  it('does not let unverified runner ownership block stop-line cleanup', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    writeFileSync(
      fixture.planFile,
      `${JSON.stringify({
        kind: 'runner',
        authority: 'unverified',
        action: 'mark_degraded',
        reason: 'tracked_pid_reused',
        lifecycle: 'stop_line',
      }, null, 2)}\n`,
      'utf8',
    );

    execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          mkdir -p "${path.join(fixture.runtimeRoot, 'evidence/runner')}"
          printf '4100\\n' > "${fixture.runnerPidFile}"
          printf 'ready\\n' > "${fixture.runnerReadyFile}"
          printf '5100\\n' > "${fixture.webPidFile}"
          printf '6100\\n' > "${fixture.apiPidFile}"
          stop_local_manual_processes
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      },
    );

    expect(readOptionalFile(fixture.eventsFile)).not.toContain('stop-pid:web');
    expect(readOptionalFile(fixture.eventsFile)).not.toContain('stop-pid:api');
    expect(readOptionalFile(fixture.eventsFile)).not.toContain('stop-pid:runner');
    expect(readFileSync(fixture.runnerPidFile, 'utf8')).toBe('4100\n');
    expect(() => readFileSync(fixture.runnerReadyFile, 'utf8')).toThrow();
    expect(existsSync(fixture.webPidFile)).toBe(false);
    expect(existsSync(fixture.apiPidFile)).toBe(false);
    expect(readFileSync(fixture.degradedEvidenceFile, 'utf8')).toContain('"authority": "unverified"');
    expect(readFileSync(fixture.degradedEvidenceFile, 'utf8')).toContain('"action": "mark_degraded"');
  });

  for (const testCase of plannerFallbackCases) {
    it(`${testCase.label} plan does not block stop-line cleanup and records ${testCase.reason} evidence`, () => {
      const fixture = setupCommonFixture();
      tempRoots.push(fixture.tempRoot);

      writeFileSync(fixture.planFile, testCase.planContent, 'utf8');

      execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${fixture.commonScript}"
            init_local_manual_env
            mkdir -p "${path.join(fixture.runtimeRoot, 'evidence/runner')}"
            printf '4100\\n' > "${fixture.runnerPidFile}"
            printf 'ready\\n' > "${fixture.runnerReadyFile}"
            printf '5100\\n' > "${fixture.webPidFile}"
            printf '6100\\n' > "${fixture.apiPidFile}"
            stop_local_manual_processes
          `,
        ],
        {
          cwd: fixture.tempRoot,
          env: {
            ...process.env,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
            PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
          },
          stdio: 'pipe',
        },
      );

      expect(readOptionalFile(fixture.eventsFile)).not.toContain('stop-pid:web');
      expect(readOptionalFile(fixture.eventsFile)).not.toContain('stop-pid:api');
      expect(readOptionalFile(fixture.eventsFile)).not.toContain('stop-pid:runner');
      expect(readFileSync(fixture.runnerPidFile, 'utf8')).toBe('4100\n');
      expect(() => readFileSync(fixture.runnerReadyFile, 'utf8')).toThrow();
      expect(existsSync(fixture.webPidFile)).toBe(false);
      expect(existsSync(fixture.apiPidFile)).toBe(false);
      expect(readFileSync(fixture.degradedEvidenceFile, 'utf8')).toContain('"authority": "unverified"');
      expect(readFileSync(fixture.degradedEvidenceFile, 'utf8')).toContain('"action": "mark_degraded"');
      expect(readFileSync(fixture.degradedEvidenceFile, 'utf8')).toContain(`"reason": "${testCase.reason}"`);
    });

    it(`${testCase.label} plan blocks replace_runner and preserves tracking state`, () => {
      const fixture = setupCommonFixture();
      tempRoots.push(fixture.tempRoot);

      writeFileSync(fixture.planFile, testCase.planContent, 'utf8');

      const output = execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${fixture.commonScript}"
            init_local_manual_env
            mkdir -p "${path.join(fixture.runtimeRoot, 'evidence/runner')}"
            printf '4100\\n' > "${fixture.runnerPidFile}"
            printf 'ready\\n' > "${fixture.runnerReadyFile}"
            set +e
            stop_local_manual_runner_owner_aware replace_runner
            status=$?
            set -e
            printf 'status=%s\\n' "\${status}"
            if [[ -f "${fixture.runnerPidFile}" ]]; then
              printf 'runner_pid=present\\n'
            else
              printf 'runner_pid=missing\\n'
            fi
            if [[ -f "${fixture.runnerReadyFile}" ]]; then
              printf 'runner_ready=present\\n'
            else
              printf 'runner_ready=missing\\n'
            fi
          `,
        ],
        {
          cwd: fixture.tempRoot,
          env: {
            ...process.env,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
            PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
          },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      expect(output).toContain('status=1');
      expect(output).toContain('runner_pid=present');
      expect(output).toContain('runner_ready=present');
    });
  }

  it('clears runner tracking state only after full-stop verification succeeds', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    writeFileSync(
      fixture.planFile,
      `${JSON.stringify({
        kind: 'runner',
        authority: 'current_active',
        action: 'stop_runner_tree',
        reason: 'tracked_runner_supervisor',
        stop: {
          scope: 'owned_runner_tree',
          root_pid: 4100,
          owned_pids: [4100, 4101, 4102],
          verification: 'all_owned_pids_exited',
        },
      }, null, 2)}\n`,
      'utf8',
    );

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          local_manual_actuate_runner_stop_contract() {
            printf 'actuate\\n' >> "${fixture.eventsFile}"
            return 0
          }
          local_manual_verify_runner_stop_contract() {
            printf 'verify\\n' >> "${fixture.eventsFile}"
            return 1
          }
          printf '4100\\n' > "${fixture.runnerPidFile}"
          printf 'ready\\n' > "${fixture.runnerReadyFile}"
          set +e
          stop_local_manual_runner_owner_aware replace_runner
          status=$?
          set -e
          printf 'status=%s\\n' "\${status}"
          if [[ -f "${fixture.runnerPidFile}" ]]; then
            printf 'runner_pid=present\\n'
          else
            printf 'runner_pid=missing\\n'
          fi
          if [[ -f "${fixture.runnerReadyFile}" ]]; then
            printf 'runner_ready=present\\n'
          else
            printf 'runner_ready=missing\\n'
          fi
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toContain('status=1');
    expect(output).toContain('runner_pid=present');
    expect(output).toContain('runner_ready=present');
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('actuate');
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('verify');
  });

  it('replace_runner with a shared derived malformed runner tuple does not clear runner state', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);
    const derivedCase = derivedPlannerMalformedSentinelCases[0];

    writeFileSync(
      fixture.planFile,
      `${JSON.stringify(derivedCase.payload, null, 2)}\n`,
      'utf8',
    );

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          mkdir -p "${path.join(fixture.runtimeRoot, 'evidence/runner')}"
          printf '4100\\n' > "${fixture.runnerPidFile}"
          printf 'ready\\n' > "${fixture.runnerReadyFile}"
          set +e
          stop_local_manual_runner_owner_aware replace_runner
          status=$?
          set -e
          printf 'status=%s\\n' "\${status}"
          if [[ -f "${fixture.runnerPidFile}" ]]; then
            printf 'runner_pid=present\\n'
          else
            printf 'runner_pid=missing\\n'
          fi
          if [[ -f "${fixture.runnerReadyFile}" ]]; then
            printf 'runner_ready=present\\n'
          else
            printf 'runner_ready=missing\\n'
          fi
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toContain('status=1');
    expect(output).toContain('runner_pid=present');
    expect(output).toContain('runner_ready=present');
  });

  it('stop_line with semantically inconsistent stop_runner_tree degrades instead of actuating', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);
    const derivedCase = derivedPlannerMalformedSentinelCases[1];

    writeFileSync(
      fixture.planFile,
      `${JSON.stringify(derivedCase.payload, null, 2)}\n`,
      'utf8',
    );

    execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          mkdir -p "${path.join(fixture.runtimeRoot, 'evidence/runner')}"
          local_manual_actuate_runner_stop_contract() {
            printf 'actuate\\n' >> "${fixture.eventsFile}"
            return 0
          }
          printf '4100\\n' > "${fixture.runnerPidFile}"
          printf 'ready\\n' > "${fixture.runnerReadyFile}"
          printf '5100\\n' > "${fixture.webPidFile}"
          printf '6100\\n' > "${fixture.apiPidFile}"
          stop_local_manual_processes
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      },
    );

    expect(readOptionalFile(fixture.eventsFile)).not.toContain('stop-pid:web');
    expect(readOptionalFile(fixture.eventsFile)).not.toContain('stop-pid:api');
    expect(readOptionalFile(fixture.eventsFile)).not.toContain('actuate');
    expect(existsSync(fixture.webPidFile)).toBe(false);
    expect(existsSync(fixture.apiPidFile)).toBe(false);
    expect(readFileSync(fixture.degradedEvidenceFile, 'utf8')).toContain('"action": "mark_degraded"');
    expect(readFileSync(fixture.degradedEvidenceFile, 'utf8')).toContain('"reason": "planner_malformed"');
  });

  it('verified tracked web stop does not delegate to generic pid-file cleanup and only clears state after service stop verification succeeds', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    const result = execBashCapture({
      script: `
        source "${fixture.commonScript}"
        init_local_manual_env
        local_manual_classify_tracked_service_authority() {
          printf 'current_active|tracked_local_manual_%s\\n' "$1"
        }
        local_manual_actuate_tracked_service_stop_contract() {
          printf 'actuate:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
          return 0
        }
        local_manual_verify_tracked_service_stop_contract() {
          printf 'verify:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
          return 1
        }
        printf '5100\\n' > "${fixture.webPidFile}"
        printf 'ready\\n' > "${fixture.webReadyFile}"
        printf '3001\\n' > "${path.join(fixture.runtimeRoot, 'web.port')}"
        if stop_local_manual_tracked_service_owner_aware web; then
          printf 'status=0\\n'
        else
          status=$?
          printf 'status=%s\\n' "\${status}"
        fi
        if [[ -f "${fixture.webPidFile}" ]]; then
          printf 'web_pid=present\\n'
        else
          printf 'web_pid=missing\\n'
        fi
        if [[ -f "${fixture.webReadyFile}" ]]; then
          printf 'web_ready=present\\n'
        else
          printf 'web_ready=missing\\n'
        fi
        if [[ -f "${path.join(fixture.runtimeRoot, 'web.port')}" ]]; then
          printf 'web_port=present\\n'
        else
          printf 'web_port=missing\\n'
        fi
        exit 0
      `,
      cwd: fixture.tempRoot,
      env: {
        ...process.env,
        LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
        PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('status=1');
    expect(result.stdout).toContain('web_pid=present');
    expect(result.stdout).toContain('web_ready=present');
    expect(result.stdout).toContain('web_port=present');
    expect(existsSync(fixture.webPidFile)).toBe(true);
    expect(existsSync(fixture.webReadyFile)).toBe(true);
    expect(existsSync(path.join(fixture.runtimeRoot, 'web.port'))).toBe(true);
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('actuate:web|5100');
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('verify:web|5100');
    expect(readFileSync(fixture.eventsFile, 'utf8')).not.toContain('stop-pid:web');
  });

  it('preserves caller set +e when the stop actuation helper enables errexit internally', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    const result = execBashCapture({
      script: `
        source "${fixture.commonScript}"
        init_local_manual_env
        local_manual_classify_tracked_service_authority() {
          printf 'current_active|tracked_local_manual_%s\\n' "$1"
        }
        local_manual_actuate_tracked_service_stop_contract() {
          set -e
          printf 'actuate:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
          return 0
        }
        local_manual_verify_tracked_service_stop_contract() {
          printf 'verify:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
          return 0
        }
        printf '5100\\n' > "${fixture.webPidFile}"
        printf 'ready\\n' > "${fixture.webReadyFile}"
        printf '3001\\n' > "${path.join(fixture.runtimeRoot, 'web.port')}"
        set +e
        if [[ "$-" == *e* ]]; then
          printf 'before=on\\n'
        else
          printf 'before=off\\n'
        fi
        stop_local_manual_tracked_service_owner_aware web
        status=$?
        if [[ "$-" == *e* ]]; then
          printf 'after=on\\n'
        else
          printf 'after=off\\n'
        fi
        printf 'status=%s\\n' "\${status}"
        exit 0
      `,
      cwd: fixture.tempRoot,
      env: {
        ...process.env,
        LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
        PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('before=off');
    expect(result.stdout).toContain('after=off');
    expect(result.stdout).toContain('status=0');
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('actuate:web|5100');
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('verify:web|5100');
  });

  it('preserves caller set -e when the stop actuation helper toggles errexit internally', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    const result = execBashCapture({
      script: `
        source "${fixture.commonScript}"
        init_local_manual_env
        local_manual_classify_tracked_service_authority() {
          printf 'current_active|tracked_local_manual_%s\\n' "$1"
        }
        local_manual_actuate_tracked_service_stop_contract() {
          set +e
          printf 'actuate:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
          return 0
        }
        local_manual_verify_tracked_service_stop_contract() {
          printf 'verify:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
          return 0
        }
        printf '5100\\n' > "${fixture.webPidFile}"
        printf 'ready\\n' > "${fixture.webReadyFile}"
        printf '3001\\n' > "${path.join(fixture.runtimeRoot, 'web.port')}"
        set -e
        if [[ "$-" == *e* ]]; then
          printf 'before=on\\n'
        else
          printf 'before=off\\n'
        fi
        stop_local_manual_tracked_service_owner_aware web
        status=$?
        if [[ "$-" == *e* ]]; then
          printf 'after=on\\n'
        else
          printf 'after=off\\n'
        fi
        printf 'status=%s\\n' "\${status}"
        exit 0
      `,
      cwd: fixture.tempRoot,
      env: {
        ...process.env,
        LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
        PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('before=on');
    expect(result.stdout).toContain('after=on');
    expect(result.stdout).toContain('status=0');
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('actuate:web|5100');
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('verify:web|5100');
  });

  it('rechecks tracked web identity tokens immediately before actuation and degrades on token mismatch', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          tracked_pid="$$"
          classify_count_file="${path.join(fixture.tempRoot, 'classify-count-token.txt')}"
          printf '0\\n' > "\${classify_count_file}"
          local_manual_classify_tracked_service_authority() {
            classify_count="$(cat "\${classify_count_file}")"
            classify_count=$((classify_count + 1))
            printf '%s\\n' "\${classify_count}" > "\${classify_count_file}"
            if [[ "\${classify_count}" -le 2 ]]; then
              printf 'current_active|tracked_local_manual_%s|token-a|linux_boot_id_proc_stat\\n' "$1"
              return 0
            fi
            printf 'unverified|tracked_pid_reused\\n'
          }
          local_manual_actuate_tracked_service_stop_contract() {
            printf 'actuate:%s|%s|%s\\n' "$1" "$2" "$3" >> "${fixture.eventsFile}"
            return 2
          }
          printf '%s\\n' "\${tracked_pid}" > "${fixture.webPidFile}"
          printf 'ready\\n' > "${fixture.webReadyFile}"
          printf '3001\\n' > "${fixture.webPortFile}"
          cat > "${fixture.webProcessFile}" <<EOF_PROCESS_STATE
{
  "schema_version": 1,
  "kind": "web",
  "pid": \${tracked_pid},
  "port": 3001,
  "command": "npm run dev:test -- --port 3001",
  "cwd": "${repoRoot}",
  "process_identity": {
    "token": "token-a",
    "source": "linux_boot_id_proc_stat"
  },
  "captured_at": "2026-04-14T00:00:00.000Z",
  "captured_by": "process-cleanup.test"
}
EOF_PROCESS_STATE
          stop_local_manual_tracked_service_owner_aware web
          printf 'classify_calls=%s\\n' "$(cat "\${classify_count_file}")"
          if [[ -f "${fixture.webPidFile}" ]]; then
            printf 'web_pid=present\\n'
          else
            printf 'web_pid=missing\\n'
          fi
          if [[ -f "${fixture.webReadyFile}" ]]; then
            printf 'web_ready=present\\n'
          else
            printf 'web_ready=missing\\n'
          fi
          if [[ -f "${fixture.webPortFile}" ]]; then
            printf 'web_port=present\\n'
          else
            printf 'web_port=missing\\n'
          fi
          if [[ -f "${fixture.webProcessFile}" ]]; then
            printf 'web_process=present\\n'
          else
            printf 'web_process=missing\\n'
          fi
          exit 0
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toContain('classify_calls=3');
    expect(output).toContain('web_pid=present');
    expect(output).toContain('web_ready=missing');
    expect(output).toContain('web_port=present');
    expect(output).toContain('web_process=present');
    expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"authority": "unverified"');
    expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"reason": "tracked_pid_reused"');
  });

  it('verifies tracked web stop with token-aware pid identity and listener checks', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          tracked_pid="$$"
          local_manual_process_command_line() {
            printf 'npm run dev:test -- --port 3001\\n'
          }
          local_manual_process_cwd() {
            printf '%s\\n' "${repoRoot}"
          }
          local_manual_live_process_identity() {
            case "$1" in
              "\${tracked_pid}") printf 'token-b|linux_boot_id_proc_stat\\n' ;;
              5200) printf 'listener-token|linux_boot_id_proc_stat\\n' ;;
            esac
          }
          local_manual_service_listener_pids() {
            if [[ "\${LISTENER_STATE:-busy}" == "busy" ]]; then
              printf '5200\\n'
            fi
          }
          set +e
          local_manual_verify_tracked_service_stop_contract web "\${tracked_pid}" token-a
          busy_status=$?
          LISTENER_STATE=clear
          local_manual_verify_tracked_service_stop_contract web "\${tracked_pid}" token-a
          clear_status=$?
          set -e
          printf 'busy_status=%s\\n' "\${busy_status}"
          printf 'clear_status=%s\\n' "\${clear_status}"
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toContain('busy_status=1');
    expect(output).toContain('clear_status=0');
  });

  it('preserves tracked pid, port, and malformed sidecar state while clearing ready', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    writeFileSync(fixture.webProcessFile, '{bad json\n', 'utf8');

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          tracked_pid="$$"
          local_manual_process_command_line() {
            printf 'npm run dev:test -- --port 3001\\n'
          }
          local_manual_process_cwd() {
            printf '%s\\n' "${repoRoot}"
          }
          printf '%s\\n' "\${tracked_pid}" > "${fixture.webPidFile}"
          printf 'ready\\n' > "${fixture.webReadyFile}"
          printf '3001\\n' > "${fixture.webPortFile}"
          stop_local_manual_tracked_service_owner_aware web
          if [[ -f "${fixture.webPidFile}" ]]; then
            printf 'web_pid=present\\n'
          else
            printf 'web_pid=missing\\n'
          fi
          if [[ -f "${fixture.webReadyFile}" ]]; then
            printf 'web_ready=present\\n'
          else
            printf 'web_ready=missing\\n'
          fi
          if [[ -f "${fixture.webPortFile}" ]]; then
            printf 'web_port=present\\n'
          else
            printf 'web_port=missing\\n'
          fi
          if [[ -f "${fixture.webProcessFile}" ]]; then
            printf 'web_process=present\\n'
          else
            printf 'web_process=missing\\n'
          fi
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toContain('web_pid=present');
    expect(output).toContain('web_ready=missing');
    expect(output).toContain('web_port=present');
    expect(output).toContain('web_process=present');
    expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"authority": "unverified"');
    expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"reason": "tracked_state_invalid"');
  });

  it('rechecks tracked web authority immediately before actuation and degrades instead of killing a reused pid', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          mkdir -p "${path.join(fixture.runtimeRoot, 'evidence/web')}"
          classify_count_file="${path.join(fixture.tempRoot, 'classify-count.txt')}"
          printf '0\\n' > "\${classify_count_file}"
          local_manual_classify_tracked_service_authority() {
            classify_call_count="$(cat "\${classify_count_file}")"
            classify_call_count=$((classify_call_count + 1))
            printf '%s\\n' "\${classify_call_count}" > "\${classify_count_file}"
            printf 'classify:%s\\n' "\${classify_call_count}" >> "${fixture.eventsFile}"
            if [[ "\${classify_call_count}" -eq 1 ]]; then
              printf 'current_active|tracked_local_manual_%s\\n' "$1"
              return 0
            fi
            printf 'unverified|tracked_pid_reused\\n'
          }
          local_manual_actuate_tracked_service_stop_contract() {
            printf 'actuate:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
            return 0
          }
          printf '5100\\n' > "${fixture.webPidFile}"
          printf 'ready\\n' > "${fixture.webReadyFile}"
          printf '3001\\n' > "${fixture.webPortFile}"
          stop_local_manual_tracked_service_owner_aware web
          printf 'classify_calls=%s\\n' "$(grep -c '^classify:' "${fixture.eventsFile}")"
          if [[ -f "${fixture.webPidFile}" ]]; then
            printf 'web_pid=present\\n'
          else
            printf 'web_pid=missing\\n'
          fi
          if [[ -f "${fixture.webReadyFile}" ]]; then
            printf 'web_ready=present\\n'
          else
            printf 'web_ready=missing\\n'
          fi
          if [[ -f "${fixture.webPortFile}" ]]; then
            printf 'web_port=present\\n'
          else
            printf 'web_port=missing\\n'
          fi
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toContain('classify_calls=2');
    expect(output).toContain('web_pid=present');
    expect(output).toContain('web_ready=missing');
    expect(output).toContain('web_port=present');
    expect(readOptionalFile(fixture.eventsFile)).not.toContain('actuate:web|5100');
    expect(readOptionalFile(fixture.eventsFile)).not.toContain('stop-pid:web');
    expect(readFileSync(fixture.webPidFile, 'utf8')).toBe('5100\n');
    expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"authority": "unverified"');
    expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"action": "mark_degraded"');
    expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"reason": "tracked_pid_reused"');
  });

  it('rechecks tracked web authority immediately before actuation and removes stale state instead of killing a missing pid', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          classify_count_file="${path.join(fixture.tempRoot, 'classify-count-stale.txt')}"
          printf '0\\n' > "\${classify_count_file}"
          local_manual_classify_tracked_service_authority() {
            classify_call_count="$(cat "\${classify_count_file}")"
            classify_call_count=$((classify_call_count + 1))
            printf '%s\\n' "\${classify_call_count}" > "\${classify_count_file}"
            printf 'classify:%s\\n' "\${classify_call_count}" >> "${fixture.eventsFile}"
            if [[ "\${classify_call_count}" -eq 1 ]]; then
              printf 'current_active|tracked_local_manual_%s\\n' "$1"
              return 0
            fi
            printf 'stale_reclaimable|tracked_pid_missing\\n'
          }
          local_manual_actuate_tracked_service_stop_contract() {
            printf 'actuate:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
            return 0
          }
          printf '5100\\n' > "${fixture.webPidFile}"
          printf 'ready\\n' > "${fixture.webReadyFile}"
          printf '3001\\n' > "${fixture.webPortFile}"
          stop_local_manual_tracked_service_owner_aware web
          printf 'classify_calls=%s\\n' "$(grep -c '^classify:' "${fixture.eventsFile}")"
          if [[ -f "${fixture.webPidFile}" ]]; then
            printf 'web_pid=present\\n'
          else
            printf 'web_pid=missing\\n'
          fi
          if [[ -f "${fixture.webReadyFile}" ]]; then
            printf 'web_ready=present\\n'
          else
            printf 'web_ready=missing\\n'
          fi
          if [[ -f "${fixture.webPortFile}" ]]; then
            printf 'web_port=present\\n'
          else
            printf 'web_port=missing\\n'
          fi
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(output).toContain('classify_calls=2');
    expect(output).toContain('web_pid=missing');
    expect(output).toContain('web_ready=missing');
    expect(output).toContain('web_port=missing');
    expect(readOptionalFile(fixture.eventsFile)).not.toContain('actuate:web|5100');
    expect(readOptionalFile(fixture.eventsFile)).not.toContain('stop-pid:web');
    expect(existsSync(fixture.webEvidenceFile)).toBe(false);
  });

  it('signals the final rechecked web pid snapshot instead of rereading a later pid-file rewrite', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          classify_count_file="${path.join(fixture.tempRoot, 'classify-count-snapshot.txt')}"
          printf '0\\n' > "\${classify_count_file}"
          local_manual_classify_tracked_service_authority() {
            classify_call_count="$(cat "\${classify_count_file}")"
            classify_call_count=$((classify_call_count + 1))
            printf '%s\\n' "\${classify_call_count}" > "\${classify_count_file}"
            printf 'classify:%s\\n' "\${classify_call_count}" >> "${fixture.eventsFile}"
            if [[ "\${classify_call_count}" -eq 2 ]]; then
              printf '6100\\n' > "${fixture.webPidFile}"
            fi
            printf 'current_active|tracked_local_manual_%s\\n' "$1"
          }
          local_manual_actuate_tracked_service_stop_contract() {
            printf 'actuate:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
            return 0
          }
          local_manual_verify_tracked_service_stop_contract() {
            printf 'verify:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
            return 0
          }
          printf '5100\\n' > "${fixture.webPidFile}"
          printf 'ready\\n' > "${fixture.webReadyFile}"
          printf '3001\\n' > "${fixture.webPortFile}"
          stop_local_manual_tracked_service_owner_aware web
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      },
    );

    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('actuate:web|5100');
    expect(readFileSync(fixture.eventsFile, 'utf8')).toContain('verify:web|5100');
    expect(readFileSync(fixture.eventsFile, 'utf8')).not.toContain('actuate:web|6100');
    expect(readFileSync(fixture.eventsFile, 'utf8')).not.toContain('verify:web|6100');
  });

  it('rechecks tracked web identity before both TERM and KILL escalation', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          tracked_pid="$$"
          identity_checks_file="${path.join(fixture.tempRoot, 'identity-check-count.txt')}"
          printf '0\\n' > "\${identity_checks_file}"
          local_manual_recheck_tracked_service_identity_authority() {
            current_count="$(cat "\${identity_checks_file}")"
            current_count=$((current_count + 1))
            printf '%s\\n' "\${current_count}" > "\${identity_checks_file}"
            printf 'identity:%s|%s|%s\\n' "$1" "$2" "\${current_count}" >> "${fixture.eventsFile}"
            printf 'current_active|tracked_local_manual_%s\\n' "$1"
          }
          seq() { printf '1\\n'; }
          sleep() { :; }
          local_manual_signal_tracked_service_pid() {
            printf 'signal:%s|%s\\n' "$1" "$2" >> "${fixture.eventsFile}"
          }
          local_manual_verify_tracked_service_stop_contract() {
            printf 'verify:%s|%s|%s\\n' "$1" "$2" "$3" >> "${fixture.eventsFile}"
            if grep -q '^signal:KILL|' "${fixture.eventsFile}" 2>/dev/null; then
              return 0
            fi
            return 1
          }
          local_manual_actuate_tracked_service_stop_contract web "\${tracked_pid}" token-expected
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        stdio: 'pipe',
      },
    );

    const eventLog = readFileSync(fixture.eventsFile, 'utf8');
    expect(eventLog.match(/^identity:/gm)?.length ?? 0).toBe(2);
    expect(eventLog).toContain('signal:TERM|');
    expect(eventLog).toContain('signal:KILL|');
    expect(eventLog).toContain('verify:web|');
  });

  it('degrades instead of killing live tracked web/api services when their process-state token mismatches the live pid identity', async () => {
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const fixture = setupRealCommonFixture({ apiPort, webPort });
    tempRoots.push(fixture.tempRoot);

    const webPid = spawnDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'web',
      port: webPort,
      label: 'local-manual-web-token-mismatch',
    });
    const apiPid = spawnDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'api',
      port: apiPort,
      cwd: path.join(repoRoot, 'packages/api-entry-node'),
      label: 'local-manual-api-token-mismatch',
    });

    try {
      await sleep(500);
      mkdirSync(fixture.localManualRoot, { recursive: true });
      writeFileSync(fixture.webPidFile, `${webPid}\n`, 'utf8');
      writeFileSync(fixture.webPortFile, `${webPort}\n`, 'utf8');
      writeFileSync(fixture.webReadyFile, 'ready\n', 'utf8');
      writeProcessStateFile({
        file: fixture.webProcessFile,
        kind: 'web',
        pid: webPid,
        port: webPort,
        token: 'bogus-web-token',
      });

      writeFileSync(fixture.apiPidFile, `${apiPid}\n`, 'utf8');
      writeFileSync(fixture.apiPortFile, `${apiPort}\n`, 'utf8');
      writeFileSync(fixture.apiReadyFile, 'ready\n', 'utf8');
      writeProcessStateFile({
        file: fixture.apiProcessFile,
        kind: 'api',
        pid: apiPid,
        port: apiPort,
        token: 'bogus-api-token',
        cwd: path.join(repoRoot, 'packages/api-entry-node'),
      });

      execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"
            init_local_manual_env
            setup_local_manual_runtime_evidence
            stop_local_manual_processes
          `,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ENV_FILE: fixture.envFile,
            BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
            RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          },
          stdio: 'pipe',
        },
      );

      expect(isPidAlive(webPid)).toBe(true);
      expect(isPidAlive(apiPid)).toBe(true);
      expect(existsSync(fixture.webPidFile)).toBe(true);
      expect(existsSync(fixture.apiPidFile)).toBe(true);
      expect(existsSync(fixture.webPortFile)).toBe(true);
      expect(existsSync(fixture.apiPortFile)).toBe(true);
      expect(existsSync(fixture.webProcessFile)).toBe(true);
      expect(existsSync(fixture.apiProcessFile)).toBe(true);
      expect(existsSync(fixture.webReadyFile)).toBe(false);
      expect(existsSync(fixture.apiReadyFile)).toBe(false);
      expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"reason": "tracked_pid_reused"');
      expect(readFileSync(fixture.apiEvidenceFile, 'utf8')).toContain('"reason": "tracked_pid_reused"');
    } finally {
      killProcessTreeGroup(webPid);
      killProcessTreeGroup(apiPid);
    }
  }, 20_000);

  it('retries detached service startup on a lost reserved-port race and only returns once the service is truly listening', async () => {
    const fixture = setupRealCommonFixture();
    tempRoots.push(fixture.tempRoot);

    const blockedPortLease = await reserveTcpPort();
    const fallbackPort = await reserveTcpPort();
    const blockedPortServer = net.createServer();
    blockedPortServer.unref();
    await new Promise<void>((resolve, reject) => {
      blockedPortServer.once('error', reject);
      blockedPortServer.listen(blockedPortLease, '127.0.0.1', () => resolve());
    });

    let reserveAttempt = 0;
    const service = await spawnReadyDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'api',
      cwd: path.join(repoRoot, 'packages/api-entry-node'),
      attempts: 2,
      reservePort: async () => {
        reserveAttempt += 1;
        return reserveAttempt === 1 ? blockedPortLease : fallbackPort;
      },
    });

    try {
      expect(reserveAttempt).toBe(2);
      expect(service.port).toBe(fallbackPort);
      expect(isPidAlive(service.pid)).toBe(true);
      expect(listenerPidsForPort(blockedPortLease)).not.toContain(service.pid);
      expect(listenerPidsForPort(fallbackPort)).toContain(service.pid);
    } finally {
      await new Promise<void>((resolve) => blockedPortServer.close(() => resolve()));
      killProcessTreeGroup(service.pid);
      await waitForPidExit(service.pid, 1_000);
    }
  }, 20_000);

  it('degrades malformed tracked process-state and preserves pid, port, and sidecar', async () => {
    const webPort = await reserveTcpPort();
    const fixture = setupRealCommonFixture({ webPort });
    tempRoots.push(fixture.tempRoot);

    const webPid = spawnDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'web',
      port: webPort,
      label: 'local-manual-web-malformed-state',
    });

    try {
      await sleep(500);
      mkdirSync(fixture.localManualRoot, { recursive: true });
      writeFileSync(fixture.webPidFile, `${webPid}\n`, 'utf8');
      writeFileSync(fixture.webPortFile, `${webPort}\n`, 'utf8');
      writeFileSync(fixture.webReadyFile, 'ready\n', 'utf8');
      writeFileSync(fixture.webProcessFile, '{not-json', 'utf8');

      execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"
            init_local_manual_env
            setup_local_manual_runtime_evidence
            stop_local_manual_processes
          `,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ENV_FILE: fixture.envFile,
            BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
            RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          },
          stdio: 'pipe',
        },
      );

      expect(isPidAlive(webPid)).toBe(true);
      expect(existsSync(fixture.webPidFile)).toBe(true);
      expect(existsSync(fixture.webPortFile)).toBe(true);
      expect(existsSync(fixture.webProcessFile)).toBe(true);
      expect(existsSync(fixture.webReadyFile)).toBe(false);
      expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"reason": "tracked_state_invalid"');
    } finally {
      killProcessTreeGroup(webPid);
    }
  }, 20_000);

  it('fails closed for live web/api pids when tracked process-state evidence is missing', async () => {
    const fixture = setupRealCommonFixture();
    tempRoots.push(fixture.tempRoot);

    const webService = await spawnReadyDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'web',
      label: 'local-manual-web-legacy-adopt',
    });
    const apiService = await spawnReadyDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'api',
      cwd: path.join(repoRoot, 'packages/api-entry-node'),
      label: 'local-manual-api-legacy-adopt',
    });
    const webPid = webService.pid;
    const apiPid = apiService.pid;
    const webPort = webService.port;
    const apiPort = apiService.port;

    try {
      writeFileSync(
        fixture.envFile,
        `PORT_API=${apiPort}
PORT_WEB=${webPort}
`,
        'utf8',
      );
      mkdirSync(fixture.localManualRoot, { recursive: true });
      writeFileSync(fixture.webPidFile, `${webPid}\n`, 'utf8');
      writeFileSync(fixture.webReadyFile, 'ready\n', 'utf8');
      writeFileSync(fixture.apiPidFile, `${apiPid}\n`, 'utf8');
      writeFileSync(fixture.apiReadyFile, 'ready\n', 'utf8');

      expect(listenerPidsForPort(webPort)).toContain(webPid);
      expect(listenerPidsForPort(apiPort)).toContain(apiPid);

      const output = execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"
            init_local_manual_env
            setup_local_manual_runtime_evidence
            printf 'web_classification=%s\\n' "$(local_manual_classify_tracked_service_authority web)"
            printf 'api_classification=%s\\n' "$(local_manual_classify_tracked_service_authority api)"
            printf 'web_process_state=%s\\n' "$(if [[ -f "${fixture.webProcessFile}" ]]; then echo present; else echo missing; fi)"
            printf 'api_process_state=%s\\n' "$(if [[ -f "${fixture.apiProcessFile}" ]]; then echo present; else echo missing; fi)"
            stop_local_manual_processes
          `,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ENV_FILE: fixture.envFile,
            BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
            RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      expect(output).toContain('web_classification=unverified|tracked_state_missing');
      expect(output).toContain('api_classification=unverified|tracked_state_missing');
      expect(output).toContain('web_process_state=missing');
      expect(output).toContain('api_process_state=missing');
      expect(isPidAlive(webPid)).toBe(true);
      expect(isPidAlive(apiPid)).toBe(true);
      expect(existsSync(fixture.webProcessFile)).toBe(false);
      expect(existsSync(fixture.apiProcessFile)).toBe(false);
      expect(readFileSync(fixture.webPidFile, 'utf8')).toBe(`${webPid}\n`);
      expect(readFileSync(fixture.apiPidFile, 'utf8')).toBe(`${apiPid}\n`);
      expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"reason": "tracked_state_missing"');
      expect(readFileSync(fixture.apiEvidenceFile, 'utf8')).toContain('"reason": "tracked_state_missing"');
    } finally {
      killProcessTreeGroup(webPid);
      killProcessTreeGroup(apiPid);
    }
  }, 20_000);

  it('preserves tracked web/api pid files and records degraded evidence when tracked pids were reused by unrelated live processes', async () => {
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const fixture = setupRealCommonFixture({ apiPort, webPort });
    tempRoots.push(fixture.tempRoot);

    const unrelatedWebPid = spawnDetachedSiblingProcess('web-unrelated-live-process');
    const unrelatedApiPid = spawnDetachedSiblingProcess('api-unrelated-live-process');

    try {
      await sleep(250);
      mkdirSync(fixture.localManualRoot, { recursive: true });
      writeFileSync(fixture.webPidFile, `${unrelatedWebPid}\n`, 'utf8');
      writeFileSync(fixture.apiPidFile, `${unrelatedApiPid}\n`, 'utf8');
      writeFileSync(fixture.webReadyFile, 'ready\n', 'utf8');
      writeFileSync(fixture.apiReadyFile, 'ready\n', 'utf8');

      execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"
            init_local_manual_env
            setup_local_manual_runtime_evidence
            stop_local_manual_processes
          `,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ENV_FILE: fixture.envFile,
            BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
            RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          },
          stdio: 'pipe',
        },
      );

      expect(isPidAlive(unrelatedWebPid)).toBe(true);
      expect(isPidAlive(unrelatedApiPid)).toBe(true);
      expect(readFileSync(fixture.webPidFile, 'utf8')).toBe(`${unrelatedWebPid}\n`);
      expect(readFileSync(fixture.apiPidFile, 'utf8')).toBe(`${unrelatedApiPid}\n`);
      expect(existsSync(fixture.webReadyFile)).toBe(false);
      expect(existsSync(fixture.apiReadyFile)).toBe(false);
      expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"authority": "unverified"');
      expect(readFileSync(fixture.apiEvidenceFile, 'utf8')).toContain('"authority": "unverified"');
      expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"action": "mark_degraded"');
      expect(readFileSync(fixture.apiEvidenceFile, 'utf8')).toContain('"action": "mark_degraded"');
    } finally {
      killProcessTreeGroup(unrelatedWebPid);
      killProcessTreeGroup(unrelatedApiPid);
    }
  }, 20_000);

  it('degrades web/api stop when the tracked pid sidecars have token mismatches and preserves pid, port, and process state', async () => {
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const fixture = setupRealCommonFixture({ apiPort, webPort });
    tempRoots.push(fixture.tempRoot);

    const webPid = spawnDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'web',
      port: webPort,
      label: 'local-manual-web-token-mismatch',
    });
    const apiPid = spawnDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'api',
      port: apiPort,
      cwd: path.join(repoRoot, 'packages/api-entry-node'),
      label: 'local-manual-api-token-mismatch',
    });

    try {
      await sleep(500);
      mkdirSync(fixture.localManualRoot, { recursive: true });
      writeFileSync(fixture.webPidFile, `${webPid}\n`, 'utf8');
      writeFileSync(fixture.apiPidFile, `${apiPid}\n`, 'utf8');
      writeFileSync(fixture.webReadyFile, 'ready\n', 'utf8');
      writeFileSync(fixture.apiReadyFile, 'ready\n', 'utf8');
      writeFileSync(fixture.webPortFile, `${webPort}\n`, 'utf8');
      writeFileSync(fixture.apiPortFile, `${apiPort}\n`, 'utf8');
      writeProcessStateFile({
        file: fixture.webProcessFile,
        kind: 'web',
        pid: webPid,
        port: webPort,
        token: 'wrong-web-token',
        tokenSource: 'linux_boot_id_proc_stat',
      });
      writeProcessStateFile({
        file: fixture.apiProcessFile,
        kind: 'api',
        pid: apiPid,
        port: apiPort,
        token: 'wrong-api-token',
        tokenSource: 'linux_boot_id_proc_stat',
        cwd: path.join(repoRoot, 'packages/api-entry-node'),
      });

      execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"
            init_local_manual_env
            setup_local_manual_runtime_evidence
            stop_local_manual_processes
          `,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ENV_FILE: fixture.envFile,
            BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
            RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          },
          stdio: 'pipe',
        },
      );

      expect(isPidAlive(webPid)).toBe(true);
      expect(isPidAlive(apiPid)).toBe(true);
      expect(readFileSync(fixture.webPidFile, 'utf8')).toBe(`${webPid}\n`);
      expect(readFileSync(fixture.apiPidFile, 'utf8')).toBe(`${apiPid}\n`);
      expect(readFileSync(fixture.webPortFile, 'utf8')).toBe(`${webPort}\n`);
      expect(readFileSync(fixture.apiPortFile, 'utf8')).toBe(`${apiPort}\n`);
      expect(existsSync(fixture.webReadyFile)).toBe(false);
      expect(existsSync(fixture.apiReadyFile)).toBe(false);
      expect(existsSync(fixture.webProcessFile)).toBe(true);
      expect(existsSync(fixture.apiProcessFile)).toBe(true);
      expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"reason": "tracked_pid_reused"');
      expect(readFileSync(fixture.apiEvidenceFile, 'utf8')).toContain('"reason": "tracked_pid_reused"');
    } finally {
      killProcessTreeGroup(webPid);
      killProcessTreeGroup(apiPid);
    }
  }, 20_000);

  it('does not legacy-adopt a live web pid into process-state before stop-line cleanup', async () => {
    const webPort = await reserveTcpPort();
    const fixture = setupRealCommonFixture({ webPort });
    tempRoots.push(fixture.tempRoot);

    const webPid = spawnDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'web',
      port: webPort,
      label: 'local-manual-web-legacy-adopt',
    });

    try {
      await sleep(500);
      mkdirSync(fixture.localManualRoot, { recursive: true });
      writeFileSync(fixture.webPidFile, `${webPid}\n`, 'utf8');
      writeFileSync(fixture.webReadyFile, 'ready\n', 'utf8');
      writeFileSync(fixture.webPortFile, `${webPort}\n`, 'utf8');

      const result = execBashCapture({
        script: `
          source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"
          init_local_manual_env
          setup_local_manual_runtime_evidence
          if stop_local_manual_tracked_service_owner_aware web; then
            printf 'status=0\\n'
          else
            status=$?
            printf 'status=%s\\n' "\${status}"
          fi
          if [[ -f "${fixture.webProcessFile}" ]]; then
            printf 'web_process=present\\n'
          else
            printf 'web_process=missing\\n'
          fi
        `,
        cwd: repoRoot,
        env: {
          ...process.env,
          ENV_FILE: fixture.envFile,
          BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
          RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('status=0');
      expect(result.stdout).toContain('web_process=missing');
      expect(existsSync(fixture.webProcessFile)).toBe(false);
      expect(readFileSync(fixture.webPidFile, 'utf8')).toBe(`${webPid}\n`);
      expect(existsSync(fixture.webReadyFile)).toBe(false);
      expect(readFileSync(fixture.webEvidenceFile, 'utf8')).toContain('"reason": "tracked_state_missing"');
    } finally {
      killProcessTreeGroup(webPid);
    }
  }, 20_000);

  it('removes stale web/api pid files without killing anything when tracked pids are dead', async () => {
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const fixture = setupRealCommonFixture({ apiPort, webPort });
    tempRoots.push(fixture.tempRoot);

    const staleWebPid = spawnDetachedSiblingProcess('web-stale-pid');
    const staleApiPid = spawnDetachedSiblingProcess('api-stale-pid');

    try {
      await sleep(250);
      killProcessTreeGroup(staleWebPid);
      killProcessTreeGroup(staleApiPid);
      expect(await waitForPidExit(staleWebPid)).toBe(true);
      expect(await waitForPidExit(staleApiPid)).toBe(true);

      mkdirSync(fixture.localManualRoot, { recursive: true });
      writeFileSync(fixture.webPidFile, `${staleWebPid}\n`, 'utf8');
      writeFileSync(fixture.webPortFile, `${webPort}\n`, 'utf8');
      writeFileSync(fixture.apiPidFile, `${staleApiPid}\n`, 'utf8');
      writeFileSync(fixture.apiPortFile, `${apiPort}\n`, 'utf8');
      writeFileSync(fixture.webReadyFile, 'ready\n', 'utf8');
      writeFileSync(fixture.apiReadyFile, 'ready\n', 'utf8');
      writeProcessStateFile({
        file: fixture.webProcessFile,
        kind: 'web',
        pid: staleWebPid,
        port: webPort,
      });
      writeProcessStateFile({
        file: fixture.apiProcessFile,
        kind: 'api',
        pid: staleApiPid,
        port: apiPort,
      });

      execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"
            init_local_manual_env
            setup_local_manual_runtime_evidence
            stop_local_manual_processes
          `,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ENV_FILE: fixture.envFile,
            BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
            RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          },
          stdio: 'pipe',
        },
      );

      expect(existsSync(fixture.webPidFile)).toBe(false);
      expect(existsSync(fixture.apiPidFile)).toBe(false);
      expect(existsSync(fixture.webPortFile)).toBe(false);
      expect(existsSync(fixture.apiPortFile)).toBe(false);
      expect(existsSync(fixture.webProcessFile)).toBe(false);
      expect(existsSync(fixture.apiProcessFile)).toBe(false);
      expect(existsSync(fixture.webReadyFile)).toBe(false);
      expect(existsSync(fixture.apiReadyFile)).toBe(false);
      expect(existsSync(fixture.webEvidenceFile)).toBe(false);
      expect(existsSync(fixture.apiEvidenceFile)).toBe(false);
    } finally {
      killProcessTreeGroup(staleWebPid);
      killProcessTreeGroup(staleApiPid);
    }
  }, 20_000);

  it('deletes stale tracked web process sidecar files together with stale pid, ready, and port state', () => {
    const fixture = setupCommonFixture();
    tempRoots.push(fixture.tempRoot);

    writeProcessStateFile({
      file: fixture.webProcessFile,
      kind: 'web',
      pid: 999999,
      port: 3001,
      token: 'stale-token',
      tokenSource: 'linux_boot_id_proc_stat',
    });

    execFileSync(
      'bash',
      [
        '-lc',
        `
          source "${fixture.commonScript}"
          init_local_manual_env
          printf '999999\\n' > "${fixture.webPidFile}"
          printf 'ready\\n' > "${fixture.webReadyFile}"
          printf '3001\\n' > "${fixture.webPortFile}"
          stop_local_manual_tracked_service_owner_aware web
          if [[ -f "${fixture.webPidFile}" ]]; then
            printf 'web_pid=present\\n'
          else
            printf 'web_pid=missing\\n'
          fi
          if [[ -f "${fixture.webReadyFile}" ]]; then
            printf 'web_ready=present\\n'
          else
            printf 'web_ready=missing\\n'
          fi
          if [[ -f "${fixture.webPortFile}" ]]; then
            printf 'web_port=present\\n'
          else
            printf 'web_port=missing\\n'
          fi
          if [[ -f "${fixture.webProcessFile}" ]]; then
            printf 'web_process=present\\n'
          else
            printf 'web_process=missing\\n'
          fi
        `,
      ],
      {
        cwd: fixture.tempRoot,
        env: {
          ...process.env,
          LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          PATH: `${path.join(fixture.tempRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(existsSync(fixture.webPidFile)).toBe(false);
    expect(existsSync(fixture.webReadyFile)).toBe(false);
    expect(existsSync(fixture.webPortFile)).toBe(false);
    expect(existsSync(fixture.webProcessFile)).toBe(false);
  });

  it('treats api workspace child with tracked process-state evidence as a verified current_active local-manual process and stops it without killing an unrelated sibling', async () => {
    const apiPort = await reserveTcpPort();
    const fixture = setupRealCommonFixture({ apiPort });
    tempRoots.push(fixture.tempRoot);

    const apiPid = spawnDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'api',
      port: apiPort,
      cwd: path.join(repoRoot, 'packages/api-entry-node'),
      label: 'local-manual-api-workspace-child',
    });
    const siblingPid = spawnDetachedSiblingProcess('local-manual-api-workspace-child-unrelated-sibling');

    try {
      await sleep(500);
      mkdirSync(fixture.localManualRoot, { recursive: true });
      writeFileSync(fixture.apiPidFile, `${apiPid}\n`, 'utf8');
      writeFileSync(fixture.apiReadyFile, 'ready\n', 'utf8');
      writeProcessStateFile({
        file: fixture.apiProcessFile,
        kind: 'api',
        pid: apiPid,
        port: apiPort,
        token: readLinuxBootProcessIdentityToken(apiPid),
        tokenSource: 'linux_boot_id_proc_stat',
        cwd: path.join(repoRoot, 'packages/api-entry-node'),
      });

      const output = execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"
            init_local_manual_env
            setup_local_manual_runtime_evidence
            printf 'classification=%s\\n' "$(local_manual_classify_tracked_service_authority api)"
            stop_local_manual_processes
            if [[ -f "${fixture.apiPidFile}" ]]; then
              printf 'api_pid=present\\n'
            else
              printf 'api_pid=missing\\n'
            fi
          `,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ENV_FILE: fixture.envFile,
            BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
            RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      expect(output).toContain('classification=current_active|tracked_local_manual_api');
      expect(output).toContain('api_pid=missing');
      expect(await waitForPidExit(apiPid)).toBe(true);
      expect(isPidAlive(siblingPid)).toBe(true);
      expect(existsSync(fixture.apiPidFile)).toBe(false);
      expect(existsSync(fixture.apiReadyFile)).toBe(false);
      expect(existsSync(fixture.apiEvidenceFile)).toBe(false);
    } finally {
      killProcessTreeGroup(apiPid);
      killProcessTreeGroup(siblingPid);
    }
  }, 20_000);

  it('only stops local-manual web/api processes that carry verified tracked process-state evidence and leaves unrelated siblings alive', async () => {
    const apiPort = await reserveTcpPort();
    const webPort = await reserveTcpPort();
    const fixture = setupRealCommonFixture({ apiPort, webPort });
    tempRoots.push(fixture.tempRoot);

    const webPid = spawnDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'web',
      port: webPort,
      label: 'local-manual-web',
    });
    const apiPid = spawnDetachedServiceProcess({
      tempRoot: fixture.tempRoot,
      kind: 'api',
      port: apiPort,
      cwd: path.join(repoRoot, 'packages/api-entry-node'),
      label: 'local-manual-api',
    });
    const siblingPid = spawnDetachedSiblingProcess('local-manual-sibling-unrelated');

    try {
      await sleep(500);
      mkdirSync(fixture.localManualRoot, { recursive: true });
      writeFileSync(fixture.webPidFile, `${webPid}\n`, 'utf8');
      writeFileSync(fixture.apiPidFile, `${apiPid}\n`, 'utf8');
      writeFileSync(fixture.webReadyFile, 'ready\n', 'utf8');
      writeFileSync(fixture.apiReadyFile, 'ready\n', 'utf8');
      writeProcessStateFile({
        file: fixture.webProcessFile,
        kind: 'web',
        pid: webPid,
        port: webPort,
        token: readLinuxBootProcessIdentityToken(webPid),
        tokenSource: 'linux_boot_id_proc_stat',
      });
      writeProcessStateFile({
        file: fixture.apiProcessFile,
        kind: 'api',
        pid: apiPid,
        port: apiPort,
        token: readLinuxBootProcessIdentityToken(apiPid),
        tokenSource: 'linux_boot_id_proc_stat',
        cwd: path.join(repoRoot, 'packages/api-entry-node'),
      });

      execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"
            init_local_manual_env
            setup_local_manual_runtime_evidence
            stop_local_manual_processes
          `,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ENV_FILE: fixture.envFile,
            BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
            RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          },
          stdio: 'pipe',
        },
      );

      expect(await waitForPidExit(webPid)).toBe(true);
      expect(await waitForPidExit(apiPid)).toBe(true);
      expect(isPidAlive(siblingPid)).toBe(true);
      expect(existsSync(fixture.webPidFile)).toBe(false);
      expect(existsSync(fixture.apiPidFile)).toBe(false);
      expect(existsSync(fixture.webReadyFile)).toBe(false);
      expect(existsSync(fixture.apiReadyFile)).toBe(false);
    } finally {
      killProcessTreeGroup(webPid);
      killProcessTreeGroup(apiPid);
      killProcessTreeGroup(siblingPid);
    }
  }, 20_000);

  it('stop_line only stops the owned live runner tree and leaves an unrelated sibling alive on the real common + owner-janitor path', async () => {
    const fixture = setupRealCommonFixture();
    tempRoots.push(fixture.tempRoot);

    const ownedRunnerRootPid = spawnDetachedOwnedRunnerTree(fixture.tempRoot);
    const siblingPid = spawnDetachedSiblingProcess();

    try {
      await sleep(300);
      mkdirSync(path.dirname(fixture.runnerPidFile), { recursive: true });
      writeFileSync(fixture.runnerPidFile, `${ownedRunnerRootPid}\n`, 'utf8');
      writeFileSync(fixture.runnerReadyFile, 'ready\n', 'utf8');

      execFileSync(
        'bash',
        [
          '-lc',
          `
            source "${path.join(repoRoot, 'scripts/local-manual/common.sh')}"
            init_local_manual_env
            setup_local_manual_runtime_evidence
            stop_local_manual_processes
          `,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ENV_FILE: fixture.envFile,
            BACKEND_REAL_STATE_DIR: fixture.backendRealRoot,
            RUNTIME_LINES_ROOT: fixture.runtimeLinesRoot,
            LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION: '1',
          },
          stdio: 'pipe',
        },
      );

      expect(await waitForPidExit(ownedRunnerRootPid)).toBe(true);
      expect(isPidAlive(siblingPid)).toBe(true);
      expect(existsSync(fixture.runnerPidFile)).toBe(false);
      expect(existsSync(fixture.runnerReadyFile)).toBe(false);
    } finally {
      killProcessTreeGroup(ownedRunnerRootPid);
      killProcessTreeGroup(siblingPid);
    }
  }, 20_000);
});
