import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type CapturedEnv = Record<string, string>;

const tempRoots: string[] = [];

function writeExecutable(filePath: string, content: string): void {
  writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o755 });
}

function parseCapturedEnv(filePath: string): CapturedEnv {
  const entries = readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)] as const;
    });

  return Object.fromEntries(entries);
}

function runStartManagerAndCaptureEnv(extraStateEnv = ''): CapturedEnv {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-sandbox-control-'));
  tempRoots.push(tempRoot);

  const binDir = path.join(tempRoot, 'bin');
  const internalDir = path.join(tempRoot, 'internal');
  const sandboxRoot = path.join(tempRoot, 'sandbox');
  const managerServiceDir = path.join(sandboxRoot, 'manager-service');
  const stateFile = path.join(tempRoot, 'sandbox-control.env');
  const captureFile = path.join(tempRoot, 'manager-env.capture');
  const configPath = path.join(tempRoot, 'sandbox-manager.yaml');

  mkdirSync(binDir, { recursive: true });
  mkdirSync(internalDir, { recursive: true });
  mkdirSync(managerServiceDir, { recursive: true });

  writeExecutable(
    path.join(binDir, 'curl'),
    `#!/usr/bin/env bash
if [[ -f "\${AFSCP_CAPTURE_READY_FILE}" ]]; then
  exit 0
fi
exit 7
`,
  );
  writeExecutable(
    path.join(binDir, 'lsof'),
    `#!/usr/bin/env bash
exit 0
`,
  );
  writeExecutable(
    path.join(binDir, 'setsid'),
    `#!/usr/bin/env bash
exec "$@"
`,
  );
  writeExecutable(
    path.join(binDir, 'go'),
    `#!/usr/bin/env bash
if [[ "$1" != "run" || "$2" != "./cmd/manager" ]]; then
  printf 'unexpected go command: %s\\n' "$*" >&2
  exit 2
fi
{
  printf 'AFSCP_INTERNAL_BASE_URL=%s\\n' "\${AFSCP_INTERNAL_BASE_URL:-}"
  printf 'AFSCP_ORCHESTRATOR_TOKEN=%s\\n' "\${AFSCP_ORCHESTRATOR_TOKEN:-}"
  printf 'AFSCP_CALLER_SERVICE=%s\\n' "\${AFSCP_CALLER_SERVICE:-}"
  printf 'AFSCP_ACTOR_TYPE=%s\\n' "\${AFSCP_ACTOR_TYPE:-}"
  printf 'AFSCP_ACTOR_ID=%s\\n' "\${AFSCP_ACTOR_ID:-}"
  printf 'CONFIG_PATH=%s\\n' "\${CONFIG_PATH:-}"
} > "\${AFSCP_CAPTURE_READY_FILE}"
`,
  );

  writeFileSync(
    configPath,
    `afscp:
  baseUrl: http://yaml-only.invalid
  callerService: yaml-only-manager
  serviceToken: yaml-only-token
  actor:
    type: yaml
    id: yaml-only-actor
`,
    'utf8',
  );

  writeFileSync(
    stateFile,
    `ROOT_DIR="${tempRoot}"
SANDBOX_ROOT="${sandboxRoot}"
INTERNAL_REAL_DIR="${internalDir}"
CONFIG_PATH="${configPath}"
SANDBOX_PORT="28081"
SANDBOX_SERVICE_KEY_VALUE="sandbox-service-key"
K8S_NAMESPACE="agentsmith"
SANDBOX_LOG="${path.join(internalDir, 'sandbox-manager.log')}"
AFSCP_STORAGE_CSI_DRIVER="csi.juicefs.com"
AFSCP_STORAGE_CAPACITY="1Pi"
AFSCP_STORAGE_CLASS_NAME="juicefs-sc"
AFSCP_STORAGE_CSI_MOUNT_OPTIONS=""
AFSCP_STORAGE_CSI_SUBDIR=""
AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT=""
AFSCP_STORAGE_CSI_MOUNT_IMAGE=""
AFSCP_BASE_URL="http://127.0.0.1:28090"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="agentsmith-sandbox-manager"
AFSCP_ORCHESTRATOR_SERVICE_TOKEN="state-orchestrator-token"
AFSCP_ORCHESTRATOR_ACTOR_TYPE="system"
AFSCP_ORCHESTRATOR_ACTOR_ID="agentsmith-local-manager"
AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="http://minio.internal:9000"
MINIO_ACCESS_KEY="minio-ak"
MINIO_SECRET_KEY="minio-sk"
MINIO_BUCKET="mbos-dev"
KUBECONFIG=""
${extraStateEnv}
`,
    'utf8',
  );

  const childEnv = {
    ...process.env,
    AFSCP_CAPTURE_READY_FILE: captureFile,
    INTERNAL_SANDBOX_REAL_STATE_FILE: stateFile,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
  };
  for (const key of [
    'AFSCP_INTERNAL_BASE_URL',
    'AFSCP_ORCHESTRATOR_TOKEN',
    'AFSCP_CALLER_SERVICE',
    'AFSCP_ACTOR_TYPE',
    'AFSCP_ACTOR_ID',
  ]) {
    delete childEnv[key];
  }

  execFileSync('bash', [path.join(repoRoot, 'scripts/lib/internal-sandbox-real-control.sh'), 'start-manager'], {
    cwd: repoRoot,
    env: childEnv,
    stdio: 'pipe',
  });

  return parseCapturedEnv(captureFile);
}

describe('internal sandbox real control', () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('maps local-manual AFSCP state values into the sandbox-manager env contract', () => {
    const capturedEnv = runStartManagerAndCaptureEnv();

    expect(capturedEnv.AFSCP_INTERNAL_BASE_URL).toBe('http://127.0.0.1:28090');
    expect(capturedEnv.AFSCP_ORCHESTRATOR_TOKEN).toBe('state-orchestrator-token');
    expect(capturedEnv.AFSCP_CALLER_SERVICE).toBe('agentsmith-sandbox-manager');
    expect(capturedEnv.AFSCP_ACTOR_TYPE).toBe('system');
    expect(capturedEnv.AFSCP_ACTOR_ID).toBe('agentsmith-local-manager');
    expect(capturedEnv.CONFIG_PATH).toMatch(/sandbox-manager\.yaml$/u);
  });

  it('prefers canonical sandbox-manager base URL and token env over legacy state aliases', () => {
    const capturedEnv = runStartManagerAndCaptureEnv(`
AFSCP_INTERNAL_BASE_URL="http://formal-afscp.internal:28090"
AFSCP_ORCHESTRATOR_TOKEN="formal-orchestrator-token"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="formal-sandbox-manager"
AFSCP_ACTOR_TYPE="service"
AFSCP_ACTOR_ID="formal-sandbox-actor"
`);

    expect(capturedEnv.AFSCP_INTERNAL_BASE_URL).toBe('http://formal-afscp.internal:28090');
    expect(capturedEnv.AFSCP_ORCHESTRATOR_TOKEN).toBe('formal-orchestrator-token');
    expect(capturedEnv.AFSCP_CALLER_SERVICE).toBe('formal-sandbox-manager');
    expect(capturedEnv.AFSCP_ACTOR_TYPE).toBe('service');
    expect(capturedEnv.AFSCP_ACTOR_ID).toBe('formal-sandbox-actor');
  });

  it('keeps the orchestrator caller when a product caller alias is also present', () => {
    const capturedEnv = runStartManagerAndCaptureEnv(`
AFSCP_CALLER_SERVICE="agentsmith-api"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="agentsmith-sandbox-manager"
AFSCP_ORCHESTRATOR_SERVICE_TOKEN="state-orchestrator-token"
`);

    expect(capturedEnv.AFSCP_ORCHESTRATOR_TOKEN).toBe('state-orchestrator-token');
    expect(capturedEnv.AFSCP_CALLER_SERVICE).toBe('agentsmith-sandbox-manager');
  });

  it('exposes only sandbox manager runtime commands', () => {
    const source = readFileSync('scripts/lib/internal-sandbox-real-control.sh', 'utf8');

    expect(source).toContain('start-manager) start_manager ;;');
    expect(source).toContain('stop-manager) stop_manager ;;');
    expect(source).not.toContain('./cmd/cleaner');
    expect(source).not.toContain('sandbox-cleaner');
    expect(source).not.toContain('start-cleaner');
    expect(source).not.toContain('stop-cleaner');
    expect(source).not.toContain('run-cleaner-once');
    expect(source).not.toContain('cleaner_pid=');
  });

  it('rejects the removed cleaner command instead of building a legacy cleaner binary', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-sandbox-control-no-cleaner-'));
    tempRoots.push(tempRoot);

    const stateFile = path.join(tempRoot, 'sandbox-control.env');
    const internalDir = path.join(tempRoot, 'internal');
    mkdirSync(internalDir, { recursive: true });
    writeFileSync(
      stateFile,
      `ROOT_DIR="${tempRoot}"
SANDBOX_ROOT="${tempRoot}/sandbox"
INTERNAL_REAL_DIR="${internalDir}"
SANDBOX_PORT="28081"
SANDBOX_SERVICE_KEY_VALUE="sandbox-service-key"
SANDBOX_LOG="${path.join(internalDir, 'sandbox-manager.log')}"
`,
      'utf8',
    );

    const result = spawnSync('bash', [path.join(repoRoot, 'scripts/lib/internal-sandbox-real-control.sh'), 'start-cleaner'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        INTERNAL_SANDBOX_REAL_STATE_FILE: stateFile,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unknown command: start-cleaner');
    expect(result.stderr).not.toContain('cmd/cleaner');
  });
});
