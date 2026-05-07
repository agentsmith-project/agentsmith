import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rawHistoricalConnectedGrep = /grep\s+(-q\s+)?['"]\\?\[agent-task-runner\\?\]\s+connected['"]/;

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

function runRuntimeProxyFingerprint(env: NodeJS.ProcessEnv = {}): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-proxy-fingerprint-'));
  try {
    const releaseRoot = stageBundledKubectlFixture(tempRoot);
    const result = runBash(
      `
        source scripts/lib/common.sh
        printf '%s\\n' "$(runtime_proxy_env_fingerprint)"
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
  it('keeps Agent task runner checks on the shared lifecycle parser instead of raw log grep', async () => {
    const bootstrapCommon = await readRepoFile('scripts/lib/bootstrap-common.sh');
    const runtimeVerification = await readRepoFile('scripts/lib/runtime-verification.sh');
    const upgradeStatus = await readRepoFile('scripts/cluster-deploy/upgrade-status.sh');

    for (const source of [runtimeVerification]) {
      expect(source).toContain('runner-lifecycle-log.sh');
      expect(source).toContain('runner_lifecycle_logs_connected');
      expect(source).not.toMatch(rawHistoricalConnectedGrep);
    }
    expect(bootstrapCommon).not.toContain('external_runner_has_expected_runtime_proxy_env');
    expect(upgradeStatus).not.toMatch(rawHistoricalConnectedGrep);
  });

  it('keeps local-manual runner health on the same lifecycle parser used by deployment runner checks', async () => {
    const localManualCommon = await readRepoFile('scripts/local-manual/common.sh');

    expect(localManualCommon).toContain('runner-lifecycle-log.sh');
    expect(localManualCommon).toContain('runner_lifecycle_latest_log_transition_file');
    expect(localManualCommon).not.toContain('current_state="stale"');
    expect(localManualCommon).not.toMatch(rawHistoricalConnectedGrep);
  });

  it('keeps deploy bootstrap Keycloak redirect seeding on rendered public web bases instead of a single web URL', async () => {
    const bootstrapCommon = await readRepoFile('scripts/lib/bootstrap-common.sh');

    expect(bootstrapCommon).toContain('KEYCLOAK_REDIRECT_WEB_BASES="${INTEGRATION_PUBLIC_WEB_BASES:-${PUBLIC_WEB_BASE_URL}}"');
    expect(bootstrapCommon).toContain('INTEGRATION_PUBLIC_WEB_BASES="\'"${KEYCLOAK_REDIRECT_WEB_BASES}"\'"');
    expect(bootstrapCommon).not.toContain('INTEGRATION_PUBLIC_WEB_BASES="\'"${PUBLIC_WEB_BASE_URL}"\'"');
  });

  it('seeds managed Agent Runners through the target route without legacy runner payload fields', async () => {
    const bootstrapCommon = await readRepoFile('scripts/lib/bootstrap-common.sh');
    const initResources = await readRepoFile('scripts/agent-runner-init-resources.sh');

    expect(bootstrapCommon).toContain('/agent-runners');
    expect(initResources).toContain('agent-runner-seed-managed-runner.ts');

    for (const source of [bootstrapCommon, initResources]) {
      expect(source).not.toContain('/agents?page');
      expect(source).not.toContain('/agents/${');
      expect(source).not.toContain('mode:"managed"');
      expect(source).not.toContain("mode: 'internal'");
      expect(source).not.toContain('runner_runtime');
      expect(source).not.toContain('execution_preferences');
      expect(source).not.toContain('external_agent_id');
    }

    expect(initResources).toContain('AGENT_RUNNER_ID=');
    expect(initResources).toContain('state_set_string agent_runner.id');
    expect(initResources).toContain('AGENT_RUNNER_ID=${AGENT_RUNNER_ID}');
    expect(initResources).not.toContain('AGENT_ID=${AGENT_ID}');
  });

  it('seeds the project Agent task model setting from the Agent task Endpoint before runner use', async () => {
    const bootstrapCommon = await readRepoFile('scripts/lib/bootstrap-common.sh');
    const initResources = await readRepoFile('scripts/agent-runner-init-resources.sh');

    expect(bootstrapCommon).toContain('ensure_agent_task_model_setting "${ANTHROPIC_ENDPOINT_ID}"');
    expect(bootstrapCommon).toContain('${PROJECT_BASE}/agent-task-model-setting');
    expect(bootstrapCommon).toContain('expected_setting_revision');
    expect(initResources).toContain('AGENT_TASK_MODEL_SETTING_ENDPOINT_ID');
    expect(initResources).toContain('state_set_string agent_task_model_setting.endpoint_id');
  });

  it('checks preset Agent task file-library readiness without task runner selectors', async () => {
    const rootPresetCheck = await readRepoFile('scripts/check-preset-agent-task-file-library.sh');
    const demoPresetCheck = await readRepoFile('scripts/demo-deploy/check-preset-agent-task-file-library.sh');

    for (const source of [rootPresetCheck, demoPresetCheck]) {
      expect(source).toContain('/agent-runners?page=1&page_size=100');
      expect(source).not.toContain('/agents?page=1&page_size=100');
      expect(source).not.toContain('"agent_id"');
      expect(source).not.toContain('"runner_id"');
      expect(source).not.toContain('AGENT_ID');
      expect(source).toContain('AGENT_RUNNER_ID');
    }
  });

  it('keeps rendered env and Docker runtime launches on a shared runtime proxy helper', async () => {
    const clusterVerify = await readRepoFile('scripts/cluster-deploy/verify.sh');
    const demoRender = await readRepoFile('scripts/demo-deploy/render-env.sh');
    const clusterRender = await readRepoFile('scripts/cluster-deploy/render-env.sh');
    const deployCommon = await readRepoFile('scripts/lib/deploy-common.sh');

    expect(deployCommon).toContain('docker_run_runtime_proxy_env_args');
    expect(deployCommon).toContain('compose_runtime_proxy_env');
    expect(deployCommon).toContain('runtime_proxy_mode');
    expect(deployCommon).toContain('runtime_proxy_env_fingerprint');

    expect(clusterVerify).toContain('docker_run_runtime_proxy_env_args');
    expect(demoRender).toContain('compose_runtime_proxy_env');
    expect(clusterRender).toContain('compose_runtime_proxy_env');
  });

  it('does not pass formal external agent runtime env through deploy verification', async () => {
    const demoRender = await readRepoFile('scripts/demo-deploy/render-env.sh');
    const demoVerify = await readRepoFile('scripts/demo-deploy/verify.sh');
    const clusterRender = await readRepoFile('scripts/cluster-deploy/render-env.sh');
    const clusterVerify = await readRepoFile('scripts/cluster-deploy/verify.sh');

    for (const source of [demoRender, demoVerify, clusterRender, clusterVerify]) {
      expect(source).not.toContain('EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL');
      expect(source).not.toContain('EXTERNAL_AGENT_JUICEFS_');
      expect(source).not.toContain('DOCKER_MANUAL_AGENT_');
    }
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

  it('changes the runtime proxy fingerprint when proxy values drift even if NO_PROXY stays the same', () => {
    const oldFingerprint = runRuntimeProxyFingerprint({
      RUNTIME_PROXY_MODE: 'custom',
      RUNTIME_HTTP_PROXY: 'http://old-http.example:8080',
      RUNTIME_HTTPS_PROXY: 'http://old-https.example:8443',
      RUNTIME_ALL_PROXY: 'socks5://old-all.example:1080',
      NO_PROXY: 'shared.internal',
      no_proxy: 'shared.internal',
    });
    const newFingerprint = runRuntimeProxyFingerprint(
      {
        RUNTIME_PROXY_MODE: 'custom',
        RUNTIME_HTTP_PROXY: 'http://new-http.example:8080',
        RUNTIME_HTTPS_PROXY: 'http://new-https.example:8443',
        RUNTIME_ALL_PROXY: 'socks5://new-all.example:1080',
        NO_PROXY: 'shared.internal',
        no_proxy: 'shared.internal',
      },
    );

    expect(newFingerprint).not.toBe(oldFingerprint);
  });
});
