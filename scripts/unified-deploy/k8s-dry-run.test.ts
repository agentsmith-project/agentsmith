import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  runK8sDryRunProducer,
  type KubectlRunner,
} from './check-k8s-dry-run';
import { DEFAULT_SITE_ENV_PATH } from './render';

const tempRoots: string[] = [];
const fixturesDir = join(process.cwd(), 'scripts', 'unified-deploy', '__fixtures__');

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function writeKubeconfig(root: string): string {
  const kubeconfigPath = join(root, 'kubeconfig.yaml');
  writeFileSync(kubeconfigPath, 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\n', 'utf8');
  return kubeconfigPath;
}

describe('unified deploy k8s server-side dry-run producer', () => {
  it('fails closed and writes evidence when kubeconfig is missing', async () => {
    const home = tempDir('unified-k8s-dry-run-home-');
    const evidenceDir = tempDir('unified-k8s-dry-run-evidence-');
    const runner: KubectlRunner = async () => {
      throw new Error('kubectl must not be called without kubeconfig');
    };

    const result = await runK8sDryRunProducer({
      profiles: ['local-kind'],
      evidenceDir,
      env: {},
      homeDir: home,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
      runner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'kubeconfig',
        message: expect.stringContaining('server-side dry-run requires KUBECONFIG'),
      }),
    ]));
    expect(result.evidence.status).toBe('failed');
    expect(result.evidence.dry_run_scope).toEqual({
      manifest_group: 'app',
      mode: 'server',
      requires_existing_namespace: true,
      applies_resources: false,
    });
    expect(result.evidence.profiles[0]?.dry_run.status).toBe('skipped');
    expect(readFileSync(result.evidence.paths.report_path, 'utf8')).toContain('agentsmith.unified-deploy.k8s-dry-run.evidence/v1');
  });

  it('runs kubectl apply with server-side dry-run against rendered manifests only', async () => {
    const root = tempDir('unified-k8s-dry-run-');
    const evidenceDir = tempDir('unified-k8s-dry-run-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const calls: Array<{ command: string; args: string[]; input: string }> = [];
    const runner: KubectlRunner = async (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { exitCode: 0, stdout: 'dry-run ok', stderr: '' };
    };

    const result = await runK8sDryRunProducer({
      profiles: ['local-kind'],
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      runner,
    });

    expect(result.status).toBe('passed');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: 'kubectl',
      args: [
        '--kubeconfig',
        kubeconfigPath,
        '--request-timeout=20s',
        'apply',
        '--dry-run=server',
        '-f',
        '-',
      ],
    });
    expect(calls[0]?.input).toContain('Deployment');
    expect(calls[0]?.input).toContain('name: agentsmith-api');
    expect(calls[0]?.input).not.toContain('execution-gateway');
    expect(calls[0]?.input).not.toContain('API_REPLICAS');
    expect(calls[0]?.args).not.toContain('rollout');
    expect(calls[0]?.args).not.toContain('bootstrap');
    expect(result.evidence.profiles[0]?.manifest_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.evidence.profiles[0]?.manifest_summary.resources).toContain('Deployment/agentsmith-api');
    expect(result.evidence.profiles[0]?.dry_run.command).toBe('kubectl apply --dry-run=server -f -');
    expect(result.evidence.profiles[0]?.dry_run.scope_note).toContain('namespace');
  });

  it('captures kubectl server-side dry-run failures as failed producer evidence', async () => {
    const root = tempDir('unified-k8s-dry-run-');
    const evidenceDir = tempDir('unified-k8s-dry-run-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const runner: KubectlRunner = async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'Error from server (Forbidden): deployments.apps is forbidden',
    });

    const result = await runK8sDryRunProducer({
      profiles: ['existing-cluster'],
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      siteEnvPath: DEFAULT_SITE_ENV_PATH,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
      runner,
    });

    expect(result.status).toBe('failed');
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'existing-cluster:kubectl',
        message: expect.stringContaining('Forbidden'),
      }),
    ]));
    expect(result.evidence.profiles[0]?.dry_run.status).toBe('failed');
    expect(readFileSync(result.evidence.paths.report_path, 'utf8')).not.toContain('sentinel_pg_secret');
  });

  it('redacts rendered secret values from kubectl stdout and stderr evidence', async () => {
    const root = tempDir('unified-k8s-dry-run-');
    const evidenceDir = tempDir('unified-k8s-dry-run-evidence-');
    const kubeconfigPath = writeKubeconfig(root);
    const runner: KubectlRunner = async () => ({
      exitCode: 1,
      stdout: 'server echoed SUBSTRATE_POSTGRES_PASSWORD=sentinel_pg_secret',
      stderr: 'validation echoed sentinel_mongo_secret and postgresql://sentinel_pg_user:sentinel_pg_secret@substrate-postgresql:15432/sentinel_pg_db',
    });

    const result = await runK8sDryRunProducer({
      profiles: ['local-kind'],
      evidenceDir,
      env: { KUBECONFIG: kubeconfigPath },
      homeDir: root,
      substrateTruthPath: join(fixturesDir, 'substrate-truth.sentinel.env'),
      runner,
    });
    const reportText = readFileSync(result.evidence.paths.report_path, 'utf8');

    expect(result.status).toBe('failed');
    expect(reportText).not.toContain('sentinel_pg_secret');
    expect(reportText).not.toContain('sentinel_mongo_secret');
    expect(reportText).toContain('[REDACTED]');
  });
});
