import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type ResetRunOptions = {
  env?: Record<string, string>;
  fixture?: ResetFixture;
};

type ResetFixture = ReturnType<typeof createFixture>;

function createFixture() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'backend-real-reset-'));
  const fakeBin = path.join(tempRoot, 'bin');
  const kubectlLog = path.join(tempRoot, 'kubectl.log');
  const npmLog = path.join(tempRoot, 'npm.log');
  const dockerLog = path.join(tempRoot, 'docker.log');
  const namespaceDeleted = path.join(tempRoot, 'namespace-deleted');

  mkdirSync(fakeBin, { recursive: true });

  writeFileSync(
    path.join(fakeBin, 'npm'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${npmLog}"
exit 0
`,
  );
  chmodSync(path.join(fakeBin, 'npm'), 0o755);

  writeFileSync(
    path.join(fakeBin, 'docker'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${dockerLog}"
exit 0
`,
  );
  chmodSync(path.join(fakeBin, 'docker'), 0o755);

  writeFileSync(
    path.join(fakeBin, 'kubectl'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${kubectlLog}"
case "$*" in
  "config current-context")
    printf '%s\\n' "\${FAKE_KUBE_CONTEXT:-prod-cluster}"
    exit 0
    ;;
  "get namespace agentsmith-sandbox -o jsonpath={.metadata.labels.app\\\\.kubernetes\\\\.io/managed-by}")
    printf '%s' "\${FAKE_NAMESPACE_OWNER_LABEL:-}"
    exit 0
    ;;
  "get namespace agentsmith-sandbox")
    [[ ! -f "${namespaceDeleted}" ]]
    exit $?
    ;;
  "delete namespace agentsmith-sandbox --ignore-not-found --wait=false")
    touch "${namespaceDeleted}"
    exit 0
    ;;
  "get pods -n kube-system -l app.kubernetes.io/managed-by=agentsmith -o name")
    printf '%s\\n' 'pod/juicefs-managed-juicefs-one'
    exit 0
    ;;
  "get pv -l app.kubernetes.io/managed-by=agentsmith -o name")
    printf '%s\\n' 'persistentvolume/juicefs-managed-pv'
    exit 0
    ;;
  "get persistentvolume juicefs-managed-pv")
    exit 1
    ;;
esac
exit 0
`,
  );
  chmodSync(path.join(fakeBin, 'kubectl'), 0o755);

  return {
    tempRoot,
    fakeBin,
    kubectlLog,
  };
}

function readLog(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function runReset(options: ResetRunOptions = {}) {
  const fixture = options.fixture ?? createFixture();
  const result = spawnSync('bash', [path.join(process.cwd(), 'scripts/backend-real-reset.sh')], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}:/usr/bin:/bin`,
      ROOT_DIR: process.cwd(),
      BACKEND_REAL_STATE_DIR: path.join(fixture.tempRoot, 'artifacts/backend-real/current'),
      BACKEND_REAL_RUNS_DIR: path.join(fixture.tempRoot, 'artifacts/backend-real/runs'),
      ...options.env,
    },
    encoding: 'utf8',
  });

  return {
    ...result,
    kubectlLog: readLog(fixture.kubectlLog),
  };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('backend-real reset Kubernetes safety guard', () => {
  it('fails closed when kubectl is available but the expected context guard is missing', () => {
    const result = runReset({
      env: {
        FAKE_KUBE_CONTEXT: 'prod-cluster',
        FAKE_NAMESPACE_OWNER_LABEL: 'agentsmith',
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('BACKEND_REAL_RESET_KUBE_CONTEXT');
    expect(result.kubectlLog).not.toMatch(/\bdelete\b|\bpatch\b/);
  });

  it('fails closed when the namespace lacks the required AgentSmith owner label', () => {
    const result = runReset({
      env: {
        BACKEND_REAL_RESET_KUBE_CONTEXT: 'kind-agentsmith',
        FAKE_KUBE_CONTEXT: 'kind-agentsmith',
        FAKE_NAMESPACE_OWNER_LABEL: '',
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('app.kubernetes.io/managed-by=agentsmith');
    expect(result.kubectlLog).toContain('get namespace agentsmith-sandbox -o jsonpath=');
    expect(result.kubectlLog).not.toMatch(/\bdelete\b|\bpatch\b/);
  });

  it('deletes only guarded AgentSmith-owned Kubernetes resources after context, namespace, and owner checks pass', () => {
    const result = runReset({
      env: {
        BACKEND_REAL_RESET_KUBE_CONTEXT: 'kind-agentsmith',
        FAKE_KUBE_CONTEXT: 'kind-agentsmith',
        FAKE_NAMESPACE_OWNER_LABEL: 'agentsmith',
      },
    });

    expect(result.status).toBe(0);
    expect(result.kubectlLog).toContain('config current-context');
    expect(result.kubectlLog).toContain('get namespace agentsmith-sandbox -o jsonpath=');
    expect(result.kubectlLog).toContain('delete pvc -l app.kubernetes.io/managed-by=agentsmith -n agentsmith-sandbox --ignore-not-found --wait=false');
    expect(result.kubectlLog).toContain('get pods -n kube-system -l app.kubernetes.io/managed-by=agentsmith -o name');
    expect(result.kubectlLog).toContain('get pv -l app.kubernetes.io/managed-by=agentsmith -o name');
    expect(result.kubectlLog).toContain('delete namespace agentsmith-sandbox --ignore-not-found --wait=false');
  });

  it('supports an explicit audited skip mode instead of an unsafe Kubernetes guard bypass', () => {
    const result = runReset({
      env: {
        BACKEND_REAL_RESET_KUBE_MODE: 'skip',
        FAKE_KUBE_CONTEXT: 'prod-cluster',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('BACKEND_REAL_RESET_KUBE_MODE=skip');
    expect(result.kubectlLog).not.toMatch(/\bdelete\b|\bpatch\b|current-context/);
  });

  it('stops backend-real-owned sandbox cleaner loops before deleting current state', async () => {
    const fixture = createFixture();
    const stateDir = path.join(fixture.tempRoot, 'artifacts/backend-real/current');
    const runtimeDir = path.join(stateDir, 'internal-agent-task');
    const cleanerBin = path.join(runtimeDir, 'sandbox-cleaner');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(path.join(runtimeDir, 'sandbox-control.env'), `INTERNAL_REAL_DIR="${runtimeDir}"\n`);

    const cleanerLoop = spawn(
      'bash',
      ['-lc', `while true; do : '${cleanerBin}'; sleep 60; done`],
      { detached: true, stdio: 'ignore' },
    );
    if (!cleanerLoop.pid) {
      throw new Error('failed to start sandbox cleaner fixture process');
    }
    const cleanerPid = cleanerLoop.pid;
    writeFileSync(path.join(runtimeDir, 'sandbox-cleaner.pid'), `${cleanerPid}\n`);

    try {
      const exited = new Promise((resolve) => {
        cleanerLoop.once('exit', resolve);
      });
      const result = runReset({
        fixture,
        env: {
          BACKEND_REAL_RESET_KUBE_MODE: 'skip',
        },
      });
      await Promise.race([exited, waitForProcessExit(cleanerPid)]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('stopping backend-real sandbox cleaner loops');
      expect(result.stdout).toContain(`stopping sandbox-cleaner pid=${cleanerPid}`);
      expect(processAlive(cleanerPid)).toBe(false);
      expect(existsSync(runtimeDir)).toBe(false);
    } finally {
      if (processAlive(cleanerPid)) {
        try {
          process.kill(-cleanerPid, 'SIGKILL');
        } catch {
          try {
            process.kill(cleanerPid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
      }
    }
  });

  it('documents the guarded Kubernetes reset contract in help output', () => {
    const fixture = createFixture();
    const stateDir = path.join(fixture.tempRoot, 'artifacts/backend-real/current');
    const result = spawnSync('bash', [path.join(process.cwd(), 'scripts/backend-real-reset.sh'), '--help'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${fixture.fakeBin}:/usr/bin:/bin`,
        BACKEND_REAL_STATE_DIR: stateDir,
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('BACKEND_REAL_RESET_KUBE_CONTEXT');
    expect(result.stdout).toContain('BACKEND_REAL_RESET_KUBE_MODE=skip');
    expect(result.stdout).toContain('app.kubernetes.io/managed-by=agentsmith');
    expect(readLog(fixture.kubectlLog)).toBe('');
    expect(existsSync(stateDir)).toBe(false);
  });
});
