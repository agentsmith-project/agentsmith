import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rawHistoricalConnectedGrep = /grep\s+(-q\s+)?['"]\\?\[notebook-codex-runner\\?\]\s+connected['"]/;

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), 'utf8');
}

function writeExecutable(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function stageBundledKubectlFixture(tempRoot: string): string {
  const releaseRoot = path.join(tempRoot, 'release');
  mkdirSync(releaseRoot, { recursive: true });
  writeFileSync(path.join(releaseRoot, 'VERSION'), 'release_id=test-release\n', 'utf8');
  writeExecutable(
    path.join(releaseRoot, 'tools', 'kubectl'),
    '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
  );
  return releaseRoot;
}

function runBash(script: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', ['-lc', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

function runRuntimeProxyArgs(env: NodeJS.ProcessEnv = {}): string[] {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'deploy-runtime-proxy-'));
  try {
    const releaseRoot = stageBundledKubectlFixture(tempRoot);
    const result = runBash(
      `
        source scripts/lib/common.sh
        mapfile -t runtime_proxy_env_args < <(docker_run_runtime_proxy_env_args)
        printf '%s\n' "\${runtime_proxy_env_args[@]}"
      `,
      {
        HOME: tempRoot,
        RELEASE_ROOT: releaseRoot,
        ...env,
      },
    );

    expect(result.status).toBe(0);
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runRuntimeNoProxy(env: NodeJS.ProcessEnv = {}): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'deploy-runtime-no-proxy-'));
  try {
    const releaseRoot = stageBundledKubectlFixture(tempRoot);
    const result = runBash(
      `
        source scripts/lib/common.sh
        printf '%s\n' "$(compose_runtime_no_proxy https://sandbox-manager.example.test http://cache.example.test:8080)"
      `,
      {
        HOME: tempRoot,
        RELEASE_ROOT: releaseRoot,
        ...env,
      },
    );

    expect(result.status).toBe(0);
    return result.stdout.trim();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runBootstrapRuntimeProxyReuseCheck(envListing: string, env: NodeJS.ProcessEnv = {}): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'bootstrap-runtime-proxy-'));
  try {
    const releaseRoot = stageBundledKubectlFixture(tempRoot);
    const result = runBash(
      `
        source scripts/lib/common.sh
        source scripts/lib/bootstrap-common.sh

        docker() {
          if [[ "$1" == "inspect" && "$2" == "-f" ]]; then
            cat <<'EOF'
${envListing}
EOF
            return 0
          fi
          printf 'unexpected docker invocation: %s\\n' "$*" >&2
          return 1
        }

        EXTERNAL_RUNNER_CONTAINER_NAME=test-external-runner
        if external_runner_has_expected_runtime_proxy_env; then
          printf 'match\\n'
        else
          printf 'mismatch\\n'
        fi
      `,
      {
        HOME: tempRoot,
        RELEASE_ROOT: releaseRoot,
        ...env,
      },
    );

    expect(result.status).toBe(0);
    return result.stdout.trim();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('deploy runner lifecycle gates', () => {
  it('keeps external Docker runner checks on the shared lifecycle parser instead of raw historical grep', async () => {
    const bootstrapCommon = await readRepoFile('scripts/lib/bootstrap-common.sh');
    const runtimeVerification = await readRepoFile('scripts/lib/runtime-verification.sh');
    const upgradeStatus = await readRepoFile('scripts/cluster-deploy/upgrade-status.sh');

    for (const source of [bootstrapCommon, runtimeVerification, upgradeStatus]) {
      expect(source).toContain('runner-lifecycle-log.sh');
      expect(source).toContain('runner_lifecycle_logs_connected');
      expect(source).not.toMatch(rawHistoricalConnectedGrep);
    }
  });

  it('keeps local-manual runner health on the same lifecycle parser used by external Docker runner checks', async () => {
    const localManualCommon = await readRepoFile('scripts/local-manual/common.sh');

    expect(localManualCommon).toContain('runner-lifecycle-log.sh');
    expect(localManualCommon).toContain('runner_lifecycle_latest_log_transition_file');
    expect(localManualCommon).not.toContain('current_state="stale"');
    expect(localManualCommon).not.toMatch(rawHistoricalConnectedGrep);
  });

  it('keeps rendered env and Docker runtime launches on a shared runtime proxy helper', async () => {
    const bootstrapCommon = await readRepoFile('scripts/lib/bootstrap-common.sh');
    const clusterVerify = await readRepoFile('scripts/cluster-deploy/verify.sh');
    const demoRender = await readRepoFile('scripts/demo-deploy/render-env.sh');
    const clusterRender = await readRepoFile('scripts/cluster-deploy/render-env.sh');
    const deployCommon = await readRepoFile('scripts/lib/deploy-common.sh');

    expect(deployCommon).toContain('docker_run_runtime_proxy_env_args');
    expect(deployCommon).toContain('compose_runtime_proxy_env');
    expect(deployCommon).toContain('runtime_proxy_mode');
    expect(deployCommon).toContain('runtime_proxy_env_fingerprint');

    expect(bootstrapCommon).toContain('docker_run_runtime_proxy_env_args');
    expect(clusterVerify).toContain('docker_run_runtime_proxy_env_args');
    expect(demoRender).toContain('compose_runtime_proxy_env');
    expect(clusterRender).toContain('compose_runtime_proxy_env');
  });

  it('renders docker runtime proxy env args from sanitized, inherit, and custom runtime proxy truth', () => {
    expect(
      runRuntimeProxyArgs({
        RUNTIME_PROXY_MODE: 'sanitized',
        HTTP_PROXY: 'http://ambient-http.example:8080',
        HTTPS_PROXY: 'http://ambient-https.example:8443',
        ALL_PROXY: 'socks5://ambient-all.example:1080',
      }),
    ).toEqual([
      '-e',
      'HTTP_PROXY=',
      '-e',
      'HTTPS_PROXY=',
      '-e',
      'ALL_PROXY=',
      '-e',
      'http_proxy=',
      '-e',
      'https_proxy=',
      '-e',
      'all_proxy=',
    ]);

    expect(
      runRuntimeProxyArgs({
        RUNTIME_PROXY_MODE: 'inherit',
        HTTP_PROXY: 'http://inherit-http.example:8080',
        HTTPS_PROXY: 'http://inherit-https.example:8443',
        ALL_PROXY: 'socks5://inherit-all.example:1080',
      }),
    ).toEqual([
      '-e',
      'HTTP_PROXY=http://inherit-http.example:8080',
      '-e',
      'HTTPS_PROXY=http://inherit-https.example:8443',
      '-e',
      'ALL_PROXY=socks5://inherit-all.example:1080',
      '-e',
      'http_proxy=http://inherit-http.example:8080',
      '-e',
      'https_proxy=http://inherit-https.example:8443',
      '-e',
      'all_proxy=socks5://inherit-all.example:1080',
    ]);

    expect(
      runRuntimeProxyArgs({
        RUNTIME_PROXY_MODE: 'custom',
        RUNTIME_HTTP_PROXY: 'http://custom-http.example:8080',
        RUNTIME_HTTPS_PROXY: 'http://custom-https.example:8443',
        RUNTIME_ALL_PROXY: 'socks5://custom-all.example:1080',
        HTTP_PROXY: 'http://ambient-http.example:8080',
        HTTPS_PROXY: 'http://ambient-https.example:8443',
        ALL_PROXY: 'socks5://ambient-all.example:1080',
      }),
    ).toEqual([
      '-e',
      'HTTP_PROXY=http://custom-http.example:8080',
      '-e',
      'HTTPS_PROXY=http://custom-https.example:8443',
      '-e',
      'ALL_PROXY=socks5://custom-all.example:1080',
      '-e',
      'http_proxy=http://custom-http.example:8080',
      '-e',
      'https_proxy=http://custom-https.example:8443',
      '-e',
      'all_proxy=socks5://custom-all.example:1080',
    ]);
  });

  it('keeps NO_PROXY merged with runtime additions and derived compose hosts', () => {
    const noProxy = runRuntimeNoProxy({
      RUNTIME_PROXY_MODE: 'custom',
      RUNTIME_ADDITIONAL_NO_PROXY: 'ops.internal,registry.internal',
      NO_PROXY: 'corp.internal',
    });

    expect(noProxy).toContain('corp.internal');
    expect(noProxy).toContain('ops.internal');
    expect(noProxy).toContain('registry.internal');
    expect(noProxy).toContain('postgres');
    expect(noProxy).toContain('minio');
    expect(noProxy).toContain('sandbox-manager.example.test');
    expect(noProxy).toContain('cache.example.test');
  });

  it('marks external runner runtime proxy env as stale when proxy values drift but NO_PROXY stays the same', async () => {
    const bootstrapCommon = await readRepoFile('scripts/lib/bootstrap-common.sh');

    expect(bootstrapCommon).toContain('external_runner_has_expected_runtime_proxy_env');
    expect(bootstrapCommon).toContain('proxy environment is stale');

    const driftResult = runBootstrapRuntimeProxyReuseCheck(
      [
        'HTTP_PROXY=http://old-http.example:8080',
        'HTTPS_PROXY=http://old-https.example:8443',
        'ALL_PROXY=socks5://old-all.example:1080',
        'http_proxy=http://old-http.example:8080',
        'https_proxy=http://old-https.example:8443',
        'all_proxy=socks5://old-all.example:1080',
        'NO_PROXY=shared.internal',
        'no_proxy=shared.internal',
      ].join('\n'),
      {
        RUNTIME_PROXY_MODE: 'custom',
        RUNTIME_HTTP_PROXY: 'http://new-http.example:8080',
        RUNTIME_HTTPS_PROXY: 'http://new-https.example:8443',
        RUNTIME_ALL_PROXY: 'socks5://new-all.example:1080',
        NO_PROXY: 'shared.internal',
        no_proxy: 'shared.internal',
      },
    );

    expect(driftResult).toBe('mismatch');
  });
});
