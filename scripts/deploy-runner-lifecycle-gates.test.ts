import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rawHistoricalConnectedGrep = /grep\s+(-q\s+)?['"]\\?\[notebook-codex-runner\\?\]\s+connected['"]/;

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), 'utf8');
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

  it('keeps external Docker runtime launches on a shared proxy-sanitizing helper', async () => {
    const bootstrapCommon = await readRepoFile('scripts/lib/bootstrap-common.sh');
    const clusterVerify = await readRepoFile('scripts/cluster-deploy/verify.sh');
    const deployCommon = await readRepoFile('scripts/lib/deploy-common.sh');

    expect(deployCommon).toContain('docker_run_runtime_proxy_env_args');
    for (const proxyAssignment of [
      'HTTP_PROXY=',
      'HTTPS_PROXY=',
      'ALL_PROXY=',
      'http_proxy=',
      'https_proxy=',
      'all_proxy=',
    ]) {
      expect(deployCommon).toContain(proxyAssignment);
    }

    expect(bootstrapCommon).toContain('docker_run_runtime_proxy_env_args');
    expect(clusterVerify).toContain('docker_run_runtime_proxy_env_args');
  });
});
