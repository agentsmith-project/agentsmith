import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

type CapturedEnv = Record<string, string>;

const tempRoots: string[] = [];
const ASBCP_DIGEST_A = 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const ASBCP_DIGEST_B = 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const ASBCP_CANONICAL_V1_IMAGE = `ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v1.0.0@${ASBCP_DIGEST_A}`;
const ASBCP_CANONICAL_V1_WRONG_DIGEST_IMAGE = `ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:v1.0.0@${ASBCP_DIGEST_B}`;

function asbcpImageLockContent(image: string): string {
  return [
    'asbcp_version=v1.0.0',
    `asbcp_source_image=${image}`,
    'asbcp_release_url=https://github.com/agentsmith-project/agentsmith-sandbox-control-plane/releases/tag/v1.0.0',
    'asbcp_commit_sha=1234567890abcdef1234567890abcdef12345678',
    '',
  ].join('\n');
}

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
  const kubeconfigPath = path.join(tempRoot, 'host-kind.kubeconfig');
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
        case "$2" in
          *:/etc/asbcp/asbcp-config.yaml:ro)
            printf 'CONFIG_VOLUME=%s\\n' "$2"
            source_path="\${2%%:/etc/asbcp/asbcp-config.yaml:ro}"
            source_dir="$(dirname "$source_path")"
            printf 'CONFIG_VOLUME_SOURCE=%s\\n' "$source_path"
            printf 'CONFIG_VOLUME_DIR=%s\\n' "$source_dir"
            printf 'CONFIG_VOLUME_DIR_MODE=%s\\n' "$(stat -c '%a' "$source_dir")"
            printf 'CONFIG_VOLUME_MODE=%s\\n' "$(stat -c '%a' "$source_path")"
            printf 'CONFIG_VOLUME_GID=%s\\n' "$(stat -c '%g' "$source_path")"
            ;;
          *:/etc/asbcp/kubeconfig:ro)
            printf 'KUBECONFIG_VOLUME=%s\\n' "$2"
            source_path="\${2%%:/etc/asbcp/kubeconfig:ro}"
            source_dir="$(dirname "$source_path")"
            printf 'KUBECONFIG_VOLUME_SOURCE=%s\\n' "$source_path"
            printf 'KUBECONFIG_VOLUME_DIR=%s\\n' "$source_dir"
            printf 'KUBECONFIG_VOLUME_DIR_MODE=%s\\n' "$(stat -c '%a' "$source_dir")"
            printf 'KUBECONFIG_VOLUME_MODE=%s\\n' "$(stat -c '%a' "$source_path")"
            printf 'KUBECONFIG_VOLUME_GID=%s\\n' "$(stat -c '%g' "$source_path")"
            ;;
          *)
            printf 'VOLUME=%s\\n' "$2"
            ;;
        esac
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
      --user)
        printf 'CONTAINER_USER=%s\\n' "$2"
        shift 2
        ;;
      --group-add)
        printf 'CONTAINER_GROUP_ADD=%s\\n' "$2"
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
  chmodSync(configPath, 0o600);
  writeFileSync(kubeconfigPath, 'apiVersion: v1\nkind: Config\n', { encoding: 'utf8', mode: 0o600 });
  chmodSync(kubeconfigPath, 0o600);

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
KUBECONFIG="${kubeconfigPath}"
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

function runStartAsbcpAndCaptureLogWithSecretEcho(): string {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-sandbox-control-log-'));
  tempRoots.push(tempRoot);

  const binDir = path.join(tempRoot, 'bin');
  const internalDir = path.join(tempRoot, 'internal');
  const stateFile = path.join(tempRoot, 'sandbox-control.env');
  const configPath = path.join(tempRoot, 'asbcp.yaml');
  const kubeconfigPath = path.join(tempRoot, 'host-kind.kubeconfig');
  const logPath = path.join(internalDir, 'asbcp.log');
  const readyFile = path.join(tempRoot, 'asbcp-ready.marker');

  mkdirSync(binDir, { recursive: true });
  mkdirSync(internalDir, { recursive: true });
  writeFileSync(configPath, 'version: 1\n', 'utf8');
  writeFileSync(kubeconfigPath, 'apiVersion: v1\nkind: Config\n', { encoding: 'utf8', mode: 0o600 });
  chmodSync(kubeconfigPath, 0o600);

  writeExecutable(
    path.join(binDir, 'curl'),
    `#!/usr/bin/env bash
[[ -f "${readyFile}" ]] && exit 0
exit 7
`,
  );
  writeExecutable(path.join(binDir, 'lsof'), '#!/usr/bin/env bash\nexit 0\n');
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
  exit 0
fi
printf 'boot ASBCP_SERVICE_KEYS=sandbox-service-key ASBCP_AFSCP_ORCHESTRATOR_TOKEN=state-orchestrator-token\\n'
touch "${readyFile}"
sleep 0.1
`,
  );

  writeFileSync(
    stateFile,
    `ROOT_DIR="${tempRoot}"
INTERNAL_REAL_DIR="${internalDir}"
ASBCP_IMAGE="ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:test@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
ASBCP_CONFIG_PATH="${configPath}"
ASBCP_PORT="28082"
ASBCP_INTERNAL_BASE_URL="http://127.0.0.1:28082"
ASBCP_SERVICE_KEY_VALUE="sandbox-service-key"
K8S_NAMESPACE="agentsmith"
ASBCP_LOG="${logPath}"
AFSCP_INTERNAL_BASE_URL="http://127.0.0.1:28090"
AFSCP_ORCHESTRATOR_TOKEN="state-orchestrator-token"
KUBECONFIG="${kubeconfigPath}"
`,
    'utf8',
  );

  execFileSync('bash', [path.join(repoRoot, 'scripts/lib/internal-sandbox-real-control.sh'), 'start-asbcp'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      INTERNAL_SANDBOX_REAL_STATE_FILE: stateFile,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    },
    stdio: 'pipe',
  });

  return readFileSync(logPath, 'utf8');
}

function runStartAsbcpWithImage(options: { image?: string; lockImage?: string }): ReturnType<typeof spawnSync> {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-sandbox-control-image-'));
  tempRoots.push(tempRoot);

  const binDir = path.join(tempRoot, 'bin');
  const internalDir = path.join(tempRoot, 'internal');
  const stateFile = path.join(tempRoot, 'sandbox-control.env');
  const configPath = path.join(tempRoot, 'asbcp.yaml');
  const kubeconfigPath = path.join(tempRoot, 'host-kind.kubeconfig');
  const lockPath = path.join(tempRoot, 'asbcp-image.lock');
  const dockerRunMarker = path.join(tempRoot, 'docker-run.marker');

  mkdirSync(binDir, { recursive: true });
  mkdirSync(internalDir, { recursive: true });
  writeFileSync(configPath, 'version: 1\n', 'utf8');
  writeFileSync(kubeconfigPath, 'apiVersion: v1\nkind: Config\n', { encoding: 'utf8', mode: 0o600 });
  chmodSync(kubeconfigPath, 0o600);
  if (options.lockImage !== undefined) {
    writeFileSync(lockPath, asbcpImageLockContent(options.lockImage), 'utf8');
  }

  writeExecutable(
    path.join(binDir, 'curl'),
    `#!/usr/bin/env bash
if [[ -f "${dockerRunMarker}" ]]; then
  exit 0
fi
exit 7
`,
  );
  writeExecutable(path.join(binDir, 'lsof'), '#!/usr/bin/env bash\nexit 0\n');
  writeExecutable(
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
if [[ "$1" == "run" ]]; then
  touch "${dockerRunMarker}"
fi
exit 0
`,
  );

  writeFileSync(
    stateFile,
    `ROOT_DIR="${tempRoot}"
INTERNAL_REAL_DIR="${internalDir}"
${options.image === undefined ? '' : `ASBCP_IMAGE="${options.image}"`}
ASBCP_IMAGE_LOCK_PATH="${lockPath}"
ASBCP_CONFIG_PATH="${configPath}"
ASBCP_PORT="28081"
ASBCP_INTERNAL_BASE_URL="http://127.0.0.1:28081"
ASBCP_SERVICE_KEY_VALUE="sandbox-service-key"
K8S_NAMESPACE="agentsmith"
ASBCP_LOG="${path.join(internalDir, 'asbcp.log')}"
AFSCP_INTERNAL_BASE_URL="http://127.0.0.1:28090"
AFSCP_ORCHESTRATOR_TOKEN="state-orchestrator-token"
KUBECONFIG="${kubeconfigPath}"
`,
    'utf8',
  );

  return spawnSync('bash', [path.join(repoRoot, 'scripts/lib/internal-sandbox-real-control.sh'), 'start-asbcp'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      INTERNAL_SANDBOX_REAL_STATE_FILE: stateFile,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function runStartAsbcpWithKubeconfigLine(kubeconfigLine: string): ReturnType<typeof spawnSync> {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-sandbox-control-kubeconfig-'));
  tempRoots.push(tempRoot);

  const internalDir = path.join(tempRoot, 'internal');
  const stateFile = path.join(tempRoot, 'sandbox-control.env');
  const configPath = path.join(tempRoot, 'asbcp.yaml');

  mkdirSync(internalDir, { recursive: true });
  writeFileSync(configPath, 'version: 1\n', 'utf8');
  writeFileSync(
    stateFile,
    `ROOT_DIR="${tempRoot}"
INTERNAL_REAL_DIR="${internalDir}"
ASBCP_IMAGE="ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:test@${ASBCP_DIGEST_A}"
ASBCP_CONFIG_PATH="${configPath}"
ASBCP_PORT="37981"
ASBCP_INTERNAL_BASE_URL="http://127.0.0.1:37981"
ASBCP_SERVICE_KEY_VALUE="sandbox-service-key"
K8S_NAMESPACE="agentsmith"
ASBCP_LOG="${path.join(internalDir, 'asbcp.log')}"
AFSCP_INTERNAL_BASE_URL="http://127.0.0.1:28090"
AFSCP_ORCHESTRATOR_TOKEN="state-orchestrator-token"
${kubeconfigLine}
`,
    'utf8',
  );

  return spawnSync('bash', [path.join(repoRoot, 'scripts/lib/internal-sandbox-real-control.sh'), 'start-asbcp'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      INTERNAL_SANDBOX_REAL_STATE_FILE: stateFile,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function runLocalManualAsbcpImageResolver(options: string | { image?: string; lockImage?: string }): ReturnType<typeof spawnSync> {
  const resolverOptions = typeof options === 'string' ? { image: options } : options;
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-asbcp-image-'));
  tempRoots.push(tempRoot);

  const backendRealRoot = path.join(tempRoot, 'backend-real', 'current');
  const envFile = path.join(tempRoot, '.env.local-manual');
  const internalEnvFile = path.join(tempRoot, 'local-manual-internal.env');
  const lockPath = path.join(tempRoot, 'asbcp-image.lock');

  mkdirSync(path.dirname(envFile), { recursive: true });
  writeFileSync(envFile, '', 'utf8');
  writeFileSync(internalEnvFile, '', 'utf8');
  if (resolverOptions.lockImage !== undefined) {
    writeFileSync(lockPath, asbcpImageLockContent(resolverOptions.lockImage), 'utf8');
  }

  return spawnSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        export ENV_FILE="${envFile}"
        export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
        export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1
        export LOCAL_MANUAL_INTERNAL_ENV_FILE="${internalEnvFile}"
        export ASBCP_IMAGE_LOCK_PATH="${lockPath}"
        source "${repoRoot}/scripts/local-manual/internal-common.sh"
        ${resolverOptions.image === undefined ? 'unset ASBCP_IMAGE' : `ASBCP_IMAGE="${resolverOptions.image}"`}
        resolve_local_manual_asbcp_image
      `,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
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
    expect(capturedEnv.CONFIG_VOLUME).toMatch(/asbcp-secrets\/asbcp-config\.yaml:\/etc\/asbcp\/asbcp-config\.yaml:ro$/u);
    expect(capturedEnv.CONFIG_VOLUME_DIR).toBe(capturedEnv.KUBECONFIG_VOLUME_DIR);
    expect(capturedEnv.CONFIG_VOLUME_DIR_MODE).toBe('700');
    expect(Number.parseInt(capturedEnv.CONFIG_VOLUME_DIR_MODE ?? '0', 8) & 0o007).toBe(0);
    expect(capturedEnv.CONFIG_VOLUME_MODE).toBe('640');
    expect(capturedEnv.CONFIG_VOLUME_GID).toBe(String(process.getgid?.()));
    expect(Number.parseInt(capturedEnv.CONFIG_VOLUME_MODE ?? '0', 8) & 0o004).toBe(0);
    expect(capturedEnv.KUBECONFIG).toBe('/etc/asbcp/kubeconfig');
    expect(capturedEnv.KUBECONFIG_VOLUME).toMatch(
      /asbcp-secrets\/asbcp-kubeconfig:\/etc\/asbcp\/kubeconfig:ro$/u,
    );
    expect(capturedEnv.KUBECONFIG_VOLUME_DIR_MODE).toBe('700');
    expect(Number.parseInt(capturedEnv.KUBECONFIG_VOLUME_DIR_MODE ?? '0', 8) & 0o007).toBe(0);
    expect(capturedEnv.KUBECONFIG_VOLUME_MODE).toBe('640');
    expect(capturedEnv.KUBECONFIG_VOLUME_GID).toBe(String(process.getgid?.()));
    expect(Number.parseInt(capturedEnv.KUBECONFIG_VOLUME_MODE ?? '0', 8) & 0o004).toBe(0);
    expect(capturedEnv.CONTAINER_USER).toBe('10001:10001');
    expect(capturedEnv.CONTAINER_GROUP_ADD).toBe(String(process.getgid?.()));
    expect(capturedEnv.IMAGE).toMatch(/agentsmith-sandbox-control-plane:test@sha256:[a-f0-9]{64}$/u);
  });

  it('cleans the private ASBCP kubeconfig projection on stop and startup failure', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-sandbox-control-cleanup-'));
    tempRoots.push(tempRoot);

    const binDir = path.join(tempRoot, 'bin');
    const internalDir = path.join(tempRoot, 'internal');
    const stateFile = path.join(tempRoot, 'sandbox-control.env');
    const configPath = path.join(tempRoot, 'asbcp.yaml');
    const kubeconfigPath = path.join(tempRoot, 'host-kind.kubeconfig');
    const projectedDir = path.join(internalDir, 'asbcp-secrets');
    const legacyProjectedPath = path.join(internalDir, 'asbcp-kubeconfig');

    mkdirSync(binDir, { recursive: true });
    mkdirSync(internalDir, { recursive: true });
    writeFileSync(configPath, 'version: 1\n', 'utf8');
    writeFileSync(kubeconfigPath, 'apiVersion: v1\nkind: Config\n', { encoding: 'utf8', mode: 0o600 });
    chmodSync(kubeconfigPath, 0o600);
    writeFileSync(
      stateFile,
      `ROOT_DIR="${tempRoot}"
INTERNAL_REAL_DIR="${internalDir}"
ASBCP_IMAGE="ghcr.io/agentsmith-project/agentsmith-sandbox-control-plane:test@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
ASBCP_CONFIG_PATH="${configPath}"
ASBCP_PORT="28083"
ASBCP_INTERNAL_BASE_URL="http://127.0.0.1:28083"
ASBCP_SERVICE_KEY_VALUE="sandbox-service-key"
K8S_NAMESPACE="agentsmith"
ASBCP_LOG="${path.join(internalDir, 'asbcp.log')}"
AFSCP_INTERNAL_BASE_URL="http://127.0.0.1:28090"
AFSCP_ORCHESTRATOR_TOKEN="state-orchestrator-token"
KUBECONFIG="${kubeconfigPath}"
`,
      'utf8',
    );

    writeExecutable(path.join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 7\n');
    writeExecutable(path.join(binDir, 'lsof'), '#!/usr/bin/env bash\nexit 0\n');
    writeExecutable(path.join(binDir, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
    writeExecutable(path.join(binDir, 'seq'), '#!/usr/bin/env bash\nprintf "1\\n"\n');
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
if [[ "$1" == "run" ]]; then
  exit 0
fi
exit 0
`,
    );

    const env = {
      ...process.env,
      INTERNAL_SANDBOX_REAL_STATE_FILE: stateFile,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };

    const failedStart = spawnSync('bash', [path.join(repoRoot, 'scripts/lib/internal-sandbox-real-control.sh'), 'start-asbcp'], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(failedStart.status).not.toBe(0);
    expect(statSync(projectedDir, { throwIfNoEntry: false })).toBeUndefined();
    expect(statSync(legacyProjectedPath, { throwIfNoEntry: false })).toBeUndefined();

    mkdirSync(projectedDir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(projectedDir, 'asbcp-kubeconfig'), 'apiVersion: v1\n', { encoding: 'utf8', mode: 0o640 });
    writeFileSync(path.join(projectedDir, '.agentsmith-asbcp-projection'), 'agentsmith-asbcp-projection\n', 'utf8');
    writeFileSync(legacyProjectedPath, 'apiVersion: v1\n', { encoding: 'utf8', mode: 0o644 });
    chmodSync(projectedDir, 0o700);
    chmodSync(path.join(projectedDir, 'asbcp-kubeconfig'), 0o640);
    chmodSync(legacyProjectedPath, 0o644);

    execFileSync('bash', [path.join(repoRoot, 'scripts/lib/internal-sandbox-real-control.sh'), 'stop-asbcp'], {
      cwd: repoRoot,
      env,
      stdio: 'pipe',
    });

    expect(statSync(projectedDir, { throwIfNoEntry: false })).toBeUndefined();
    expect(statSync(legacyProjectedPath, { throwIfNoEntry: false })).toBeUndefined();
  });

  it('does not clean an unsafe ASBCP projection override outside the canonical internal dir', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'internal-sandbox-control-unsafe-cleanup-'));
    tempRoots.push(tempRoot);

    const binDir = path.join(tempRoot, 'bin');
    const internalDir = path.join(tempRoot, 'internal');
    const unsafeDir = path.join(internalDir, '..', 'other');
    const stateFile = path.join(tempRoot, 'sandbox-control.env');
    const sentinelPath = path.join(unsafeDir, 'sentinel.txt');

    mkdirSync(binDir, { recursive: true });
    mkdirSync(internalDir, { recursive: true });
    mkdirSync(unsafeDir, { recursive: true });
    writeFileSync(path.join(unsafeDir, 'asbcp-kubeconfig'), 'do not delete\n', 'utf8');
    writeFileSync(sentinelPath, 'owned elsewhere\n', 'utf8');
    writeExecutable(path.join(binDir, 'docker'), '#!/usr/bin/env bash\nexit 0\n');
    writeExecutable(path.join(binDir, 'lsof'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(
      stateFile,
      `ROOT_DIR="${tempRoot}"
INTERNAL_REAL_DIR="${internalDir}"
ASBCP_PROJECTED_KUBECONFIG_DIR="${unsafeDir}"
ASBCP_PORT="28084"
ASBCP_SERVICE_KEY_VALUE="sandbox-service-key"
ASBCP_LOG="${path.join(internalDir, 'asbcp.log')}"
`,
      'utf8',
    );

    execFileSync('bash', [path.join(repoRoot, 'scripts/lib/internal-sandbox-real-control.sh'), 'stop-asbcp'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        INTERNAL_SANDBOX_REAL_STATE_FILE: stateFile,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
      stdio: 'pipe',
    });

    expect(readFileSync(sentinelPath, 'utf8')).toBe('owned elsewhere\n');
    expect(readFileSync(path.join(unsafeDir, 'asbcp-kubeconfig'), 'utf8')).toBe('do not delete\n');
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

  it('redacts ASBCP service key and AFSCP orchestrator token from launcher logs', () => {
    const log = runStartAsbcpAndCaptureLogWithSecretEcho();

    expect(log).toContain('[REDACTED]');
    expect(log).not.toContain('sandbox-service-key');
    expect(log).not.toContain('state-orchestrator-token');
  });

  it('fails closed before docker launch when ASBCP kubeconfig is missing or absent', () => {
    const missing = runStartAsbcpWithKubeconfigLine('KUBECONFIG="/tmp/agentsmith-missing-asbcp.kubeconfig"');
    const absent = runStartAsbcpWithKubeconfigLine('');

    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('KUBECONFIG not found: /tmp/agentsmith-missing-asbcp.kubeconfig');
    expect(absent.status).not.toBe(0);
    expect(absent.stderr).toContain('missing KUBECONFIG for ASBCP container projection');
  });

  it('rejects digest-pinned non-ASBCP images before launching the internal container', () => {
    const result = runStartAsbcpWithImage({
      image: 'ghcr.io/example/not-asbcp:v1.0.0@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ASBCP_IMAGE must use canonical agentsmith-sandbox-control-plane repository');
  });

  it('rejects same-tail ASBCP images from the wrong owner before launching the internal container', () => {
    const result = runStartAsbcpWithImage({
      image: `ghcr.io/example/agentsmith-sandbox-control-plane:v1.0.0@${ASBCP_DIGEST_A}`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ASBCP_IMAGE must use canonical ASBCP image repository');
  });

  it('rejects ASBCP_IMAGE overrides whose digest differs from the readable image lock', () => {
    const result = runStartAsbcpWithImage({
      image: ASBCP_CANONICAL_V1_WRONG_DIGEST_IMAGE,
      lockImage: ASBCP_CANONICAL_V1_IMAGE,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ASBCP_IMAGE digest must match asbcp-image.lock');
  });

  it('rejects digest-pinned non-ASBCP images resolved from the image lock', () => {
    const result = runStartAsbcpWithImage({
      lockImage: 'ghcr.io/example/not-asbcp:v1.0.0@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ASBCP_IMAGE must use canonical agentsmith-sandbox-control-plane repository');
  });

  it('rejects digest-pinned non-ASBCP images in the local-real resolver', () => {
    const result = runLocalManualAsbcpImageResolver(
      'ghcr.io/example/not-asbcp:v1.0.0@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ASBCP_IMAGE must use canonical agentsmith-sandbox-control-plane repository');
  });

  it('rejects ASBCP_IMAGE overrides with a digest that differs from the local-real image lock', () => {
    const result = runLocalManualAsbcpImageResolver({
      image: ASBCP_CANONICAL_V1_WRONG_DIGEST_IMAGE,
      lockImage: ASBCP_CANONICAL_V1_IMAGE,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ASBCP_IMAGE digest must match asbcp-image.lock');
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
