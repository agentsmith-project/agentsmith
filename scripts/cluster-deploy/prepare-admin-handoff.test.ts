import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function writeExecutable(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function stageToolPath(tempRoot: string): string {
  const binDir = path.join(tempRoot, 'bin');
  writeExecutable(path.join(binDir, 'kubectl'), '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n');
  writeExecutable(path.join(binDir, 'kind'), '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n');
  return binDir;
}

function siteEnvContent(releaseId?: string): string {
  return [
    releaseId === undefined ? undefined : `RELEASE_ID=${releaseId}`,
    'CLUSTER_DEPLOY_MODE=semi-auto',
    'INTERNAL_AGENT_K8S_NAMESPACE=agentsmith-sandbox',
    'INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME=juicefs-sc',
    'PUBLIC_WEB_BASE_URL=https://mbos.example',
    'PUBLIC_API_BASE_URL=https://mbos.example/api/v1',
    'PUBLIC_KEYCLOAK_BASE_URL=https://mbos.example/keycloak',
    'SANDBOX_MANAGER_INGRESS_HOST=sandbox.example',
    'SANDBOX_MANAGER_PUBLIC_BASE_URL=https://sandbox.example',
    'CLIENT_PUBLIC_POSTGRES_HOST=postgres.example',
    'CLIENT_PUBLIC_POSTGRES_PORT=5432',
    'CLIENT_PUBLIC_MINIO_ENDPOINT=https://minio.example',
    'K8S_EXTERNAL_POSTGRES_HOST=postgres.cluster.example',
    'K8S_EXTERNAL_POSTGRES_PORT=5432',
    'K8S_EXTERNAL_MINIO_HOST=minio.cluster.example',
    'K8S_EXTERNAL_MINIO_PORT=9000',
    'SANDBOX_MANAGER_NODE_SELECTOR_JSON={}',
    'SANDBOX_MANAGER_TOLERATIONS_JSON=[]',
    'INTERNAL_AGENT_WORKLOAD_NODE_SELECTOR_JSON={}',
    'INTERNAL_AGENT_WORKLOAD_TOLERATIONS_JSON=[]',
    '',
  ].filter((line): line is string => line !== undefined).join('\n');
}

function stagePrepareAdminHandoffFixture(tempRoot: string, siteEnv: string): { deployRoot: string; releaseRoot: string } {
  const deployRoot = path.join(tempRoot, 'cluster-deploy-root');
  const releaseRoot = path.join(tempRoot, 'release');

  mkdirSync(path.join(deployRoot, 'config'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'env'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'tools'), { recursive: true });
  writeFileSync(path.join(releaseRoot, 'VERSION'), 'release_id=version-release\n', 'utf8');
  writeFileSync(path.join(deployRoot, 'config', 'site.env'), siteEnv, 'utf8');

  return { deployRoot, releaseRoot };
}

function runPrepareAdminHandoff(tempRoot: string, deployRoot: string, releaseRoot: string) {
  const baseEnv = { ...process.env };
  for (const key of [
    'CLUSTER_DEPLOY_ROOT',
    'DEPLOY_ROOT',
    'DEPLOY_ROOT_DEFAULT',
    'RELEASE_ID',
    'RELEASE_ROOT',
  ]) {
    delete baseEnv[key];
  }

  return spawnSync('bash', [path.join(repoRoot, 'scripts', 'cluster-deploy', 'prepare-admin-handoff.sh')], {
    cwd: repoRoot,
    env: {
      ...baseEnv,
      CLUSTER_DEPLOY_ROOT: deployRoot,
      HOME: tempRoot,
      PATH: `${stageToolPath(tempRoot)}:${process.env.PATH ?? ''}`,
      RELEASE_ROOT: releaseRoot,
    },
    encoding: 'utf8',
  });
}

describe('prepare-admin-handoff release id truth', () => {
  it('fails closed when site.env carries a stale RELEASE_ID', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'prepare-admin-handoff-stale-release-id-'));
    try {
      const { deployRoot, releaseRoot } = stagePrepareAdminHandoffFixture(tempRoot, siteEnvContent('stale-release'));
      const result = runPrepareAdminHandoff(tempRoot, deployRoot, releaseRoot);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('RELEASE_ID does not match VERSION release_id');
      expect(result.stderr).not.toContain('stale-release');
      expect(result.stderr).not.toContain('version-release');
      expect(existsSync(path.join(deployRoot, 'admin-handoff', 'SUMMARY.md'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses VERSION release_id when site.env RELEASE_ID matches', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'prepare-admin-handoff-matching-release-id-'));
    try {
      const { deployRoot, releaseRoot } = stagePrepareAdminHandoffFixture(tempRoot, siteEnvContent('version-release'));
      const result = runPrepareAdminHandoff(tempRoot, deployRoot, releaseRoot);

      expect(result.status).toBe(0);
      const summary = readFileSync(path.join(deployRoot, 'admin-handoff', 'SUMMARY.md'), 'utf8');
      expect(summary).toContain('- release: version-release');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses VERSION release_id when site.env omits RELEASE_ID', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'prepare-admin-handoff-no-release-id-'));
    try {
      const { deployRoot, releaseRoot } = stagePrepareAdminHandoffFixture(tempRoot, siteEnvContent());
      const result = runPrepareAdminHandoff(tempRoot, deployRoot, releaseRoot);

      expect(result.status).toBe(0);
      const summary = readFileSync(path.join(deployRoot, 'admin-handoff', 'SUMMARY.md'), 'utf8');
      expect(summary).toContain('- release: version-release');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
