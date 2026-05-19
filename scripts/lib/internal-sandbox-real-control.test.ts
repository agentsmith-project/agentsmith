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

function runStartAsbcpAndCaptureEnv(extraStateEnv = ''): CapturedEnv {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-sandbox-control-'));
  tempRoots.push(tempRoot);

  const binDir = path.join(tempRoot, 'bin');
  const internalDir = path.join(tempRoot, 'internal');
  const stateFile = path.join(tempRoot, 'sandbox-control.env');
  const captureFile = path.join(tempRoot, 'asbcp-env.capture');
  const configPath = path.join(tempRoot, 'asbcp.yaml');
  const asbcpImage = 'ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:test@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  mkdirSync(binDir, { recursive: true });
  mkdirSync(internalDir, { recursive: true });

  writeExecutable(
    path.join(binDir, 'curl'),
    `#!/usr/bin/env bash
if [[ -f "\${ASBCP_CAPTURE_READY_FILE}" ]]; then
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
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  exit 0
fi
if [[ "$1" == "rm" ]]; then
  exit 0
fi
if [[ "$1" == "inspect" ]]; then
  printf 'true\\n'
  exit 0
fi
if [[ "$1" != "run" ]]; then
  printf 'unexpected docker command: %s\\n' "$*" >&2
  exit 2
fi
shift
{
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      -e)
        printf '%s\\n' "$2"
        shift 2
        ;;
      -v)
        printf 'VOLUME=%s\\n' "$2"
        shift 2
        ;;
      --name)
        printf 'CONTAINER_NAME=%s\\n' "$2"
        shift 2
        ;;
      --rm)
        shift
        ;;
      --network)
        shift 2
        ;;
      *)
        if [[ "$1" == *@sha256:* ]]; then
          printf 'IMAGE=%s\\n' "$1"
        fi
        shift
        ;;
    esac
  done
} > "\${ASBCP_CAPTURE_READY_FILE}"
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
INTERNAL_REAL_DIR="${internalDir}"
ASBCP_IMAGE="${asbcpImage}"
ASBCP_IMAGE_LOCK_PATH="${path.join(tempRoot, 'asbcp-image.lock')}"
ASBCP_CONFIG_PATH="${configPath}"
ASBCP_PORT="28081"
ASBCP_INTERNAL_BASE_URL="http://127.0.0.1:28081"
ASBCP_SERVICE_KEY_VALUE="sandbox-service-key"
K8S_NAMESPACE="agentsmith"
ASBCP_LOG="${path.join(internalDir, 'asbcp.log')}"
AFSCP_STORAGE_CSI_DRIVER="csi.juicefs.com"
AFSCP_STORAGE_CAPACITY="1Pi"
AFSCP_STORAGE_CLASS_NAME="juicefs-sc"
AFSCP_STORAGE_CSI_MOUNT_OPTIONS=""
AFSCP_STORAGE_CSI_SUBDIR=""
AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT=""
AFSCP_STORAGE_CSI_MOUNT_IMAGE=""
AFSCP_BASE_URL="http://127.0.0.1:28090"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="agentsmith-sandbox-control-plane"
AFSCP_ORCHESTRATOR_SERVICE_TOKEN="state-orchestrator-token"
AFSCP_ORCHESTRATOR_ACTOR_TYPE="system"
AFSCP_ORCHESTRATOR_ACTOR_ID="agentsmith-local-asbcp"
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
    ASBCP_CAPTURE_READY_FILE: captureFile,
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

  execFileSync('bash', [path.join(repoRoot, 'scripts/lib/internal-sandbox-real-control.sh'), 'start-asbcp'], {
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

  it('maps local-manual AFSCP state values into the ASBCP image env contract', () => {
    const capturedEnv = runStartAsbcpAndCaptureEnv();

    expect(capturedEnv.ASBCP_CONFIG_PATH).toBe('/etc/asbcp/asbcp-config.yaml');
    expect(capturedEnv.ASBCP_SERVICE_KEYS).toBe('sandbox-service-key');
    expect(capturedEnv.ASBCP_WORKLOAD_NAMESPACE).toBe('agentsmith');
    expect(capturedEnv.ASBCP_AFSCP_INTERNAL_BASE_URL).toBe('http://127.0.0.1:28090');
    expect(capturedEnv.ASBCP_AFSCP_ORCHESTRATOR_TOKEN).toBe('state-orchestrator-token');
    expect(capturedEnv.ASBCP_AFSCP_CALLER_SERVICE).toBe('agentsmith-sandbox-control-plane');
    expect(capturedEnv.ASBCP_AFSCP_ACTOR_TYPE).toBe('system');
    expect(capturedEnv.ASBCP_AFSCP_ACTOR_ID).toBe('agentsmith-local-asbcp');
    expect(capturedEnv.VOLUME).toMatch(/asbcp\.yaml:\/etc\/asbcp\/asbcp-config\.yaml:ro$/u);
    expect(capturedEnv.IMAGE).toMatch(/agentsmith-sandbox-control-plane:test@sha256:[a-f0-9]{64}$/u);
  });

  it('prefers canonical ASBCP AFSCP env over product caller aliases', () => {
    const capturedEnv = runStartAsbcpAndCaptureEnv(`
AFSCP_INTERNAL_BASE_URL="http://formal-afscp.internal:28090"
AFSCP_ORCHESTRATOR_TOKEN="formal-orchestrator-token"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="formal-asbcp"
AFSCP_ACTOR_TYPE="service"
AFSCP_ACTOR_ID="formal-sandbox-actor"
`);

    expect(capturedEnv.ASBCP_AFSCP_INTERNAL_BASE_URL).toBe('http://formal-afscp.internal:28090');
    expect(capturedEnv.ASBCP_AFSCP_ORCHESTRATOR_TOKEN).toBe('formal-orchestrator-token');
    expect(capturedEnv.ASBCP_AFSCP_CALLER_SERVICE).toBe('formal-asbcp');
    expect(capturedEnv.ASBCP_AFSCP_ACTOR_TYPE).toBe('service');
    expect(capturedEnv.ASBCP_AFSCP_ACTOR_ID).toBe('formal-sandbox-actor');
  });

  it('keeps the orchestrator caller when a product caller alias is also present', () => {
    const capturedEnv = runStartAsbcpAndCaptureEnv(`
AFSCP_CALLER_SERVICE="agentsmith-api"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="agentsmith-sandbox-control-plane"
AFSCP_ORCHESTRATOR_SERVICE_TOKEN="state-orchestrator-token"
`);

    expect(capturedEnv.ASBCP_AFSCP_ORCHESTRATOR_TOKEN).toBe('state-orchestrator-token');
    expect(capturedEnv.ASBCP_AFSCP_CALLER_SERVICE).toBe('agentsmith-sandbox-control-plane');
  });

  it('exposes only ASBCP image runtime commands', () => {
    const source = readFileSync('scripts/lib/internal-sandbox-real-control.sh', 'utf8');

    expect(source).toContain('start-asbcp) start_asbcp ;;');
    expect(source).toContain('stop-asbcp) stop_asbcp ;;');
    expect(source).toContain('restart-asbcp) stop_asbcp; start_asbcp ;;');
    expect(source).not.toContain('start-manager');
    expect(source).not.toContain('stop-manager');
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
INTERNAL_REAL_DIR="${internalDir}"
ASBCP_PORT="28081"
ASBCP_SERVICE_KEY_VALUE="sandbox-service-key"
ASBCP_LOG="${path.join(internalDir, 'asbcp.log')}"
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

  it('rejects the removed manager command alias', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-sandbox-control-no-manager-'));
    tempRoots.push(tempRoot);

    const stateFile = path.join(tempRoot, 'sandbox-control.env');
    const internalDir = path.join(tempRoot, 'internal');
    mkdirSync(internalDir, { recursive: true });
    writeFileSync(
      stateFile,
      `ROOT_DIR="${tempRoot}"
INTERNAL_REAL_DIR="${internalDir}"
ASBCP_PORT="28081"
ASBCP_SERVICE_KEY_VALUE="sandbox-service-key"
ASBCP_LOG="${path.join(internalDir, 'asbcp.log')}"
`,
      'utf8',
    );

    const result = spawnSync('bash', [path.join(repoRoot, 'scripts/lib/internal-sandbox-real-control.sh'), 'start-manager'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        INTERNAL_SANDBOX_REAL_STATE_FILE: stateFile,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unknown command: start-manager');
  });
});
