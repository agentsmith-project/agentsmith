import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parsePostDeployProductSmokeInputDoctorCliOptions,
  runPostDeployProductSmokeInputDoctor,
} from './input-doctor';

const tempRoots: string[] = [];
const RELEASE_CONTRACT_FIXTURE_PATH = join(
  process.cwd(),
  'scripts/governance/__fixtures__/release-boundary/release-contract.valid.json',
);
const SUBSTRATE_TRUTH_FIXTURE_PATH = join(
  process.cwd(),
  'scripts/governance/__fixtures__/release-boundary/substrate-connection.external-declared.valid.json',
);
const RUNTIME_SUBSTRATE_ENV_FIXTURE_PATH = join(
  process.cwd(),
  'scripts/unified-deploy/__fixtures__/substrate-truth.valid.env',
);

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

function writeText(root: string, name: string, value: string): string {
  const target = join(root, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value, 'utf8');
  return target;
}

function writeJson(root: string, name: string, value: unknown): string {
  return writeText(root, name, `${JSON.stringify(value, null, 2)}\n`);
}

function cloneJsonFixture(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function writeReleaseContract(root: string): string {
  return writeJson(root, 'release-contract/agentsmith-release-contract.json', cloneJsonFixture(RELEASE_CONTRACT_FIXTURE_PATH));
}

function writeSubstrateTruth(
  root: string,
  mutate: (truth: Record<string, unknown>) => void = () => undefined,
): string {
  const truth = cloneJsonFixture(SUBSTRATE_TRUTH_FIXTURE_PATH);
  mutate(truth);
  return writeJson(root, 'deployment-target/substrate-truth.json', truth);
}

function writeSiteEnv(
  root: string,
  overrides: Record<string, string> = {},
): string {
  return writeText(
    root,
    'deployment-target/site.env',
    [
      'UNIFIED_DEPLOY_PROFILE=existing_kubernetes/external_declared/online',
      'PUBLIC_BASE_URL=https://agentsmith.release.example.com',
      'PUBLIC_API_BASE_URL=https://agentsmith.release.example.com/api/v1',
      'RUNNER_PUBLIC_API_BASE_URL=wss://agentsmith.release.example.com/api/v1',
      ...Object.entries(overrides).map(([key, value]) => `${key}=${value}`),
      '',
    ].join('\n'),
  );
}

async function runDoctor(root: string, paths: {
  releaseContractPath?: string;
  siteEnvPath?: string;
  substrateTruthPath?: string;
  runtimeSubstrateEnvPath?: string;
  runtimeSubstrateEnvSource?: string;
  env?: Record<string, string | undefined>;
} = {}) {
  return runPostDeployProductSmokeInputDoctor({
    releaseContractPath: paths.releaseContractPath ?? writeReleaseContract(root),
    siteEnvPath: paths.siteEnvPath ?? writeSiteEnv(root),
    substrateTruthPath: paths.substrateTruthPath ?? writeSubstrateTruth(root),
    ...(paths.runtimeSubstrateEnvPath
      ? { runtimeSubstrateEnvPath: paths.runtimeSubstrateEnvPath }
      : {
          runtimeSubstrateEnvSource: paths.runtimeSubstrateEnvSource
            ?? readFileSync(RUNTIME_SUBSTRATE_ENV_FIXTURE_PATH, 'utf8'),
        }),
    ...(paths.env ? { env: paths.env } : {}),
  });
}

describe('post-deploy product smoke input doctor', () => {
  it('passes with neutral substrate connection truth bound to the selected handoff target', async () => {
    const root = tempDir('post-deploy-smoke-doctor-valid-');

    await expect(runDoctor(root)).resolves.toMatchObject({
      status: 'passed',
      target: {
        target_cluster: 'existing_kubernetes',
        substrate_source: 'external_declared',
        distribution: 'online',
      },
    });
  });

  it('accepts runtime substrate env projection from the CLI path option', async () => {
    const root = tempDir('post-deploy-smoke-doctor-runtime-path-');
    const options = parsePostDeployProductSmokeInputDoctorCliOptions([
      '--release-contract',
      writeReleaseContract(root),
      '--site-env',
      writeSiteEnv(root),
      '--substrate-truth',
      writeSubstrateTruth(root),
      '--runtime-substrate-env',
      RUNTIME_SUBSTRATE_ENV_FIXTURE_PATH,
    ]);

    await expect(runPostDeployProductSmokeInputDoctor({
      ...options,
      env: {},
    })).resolves.toMatchObject({ status: 'passed' });
  });

  it('rejects Docker substrate env input before product flows run', async () => {
    const root = tempDir('post-deploy-smoke-doctor-docker-env-');
    const substrateTruthPath = writeText(
      root,
      'deployment-target/substrate-truth.json',
      [
        'SUBSTRATE_TRUTH_SCHEMA_VERSION=agentsmith.docker-substrate.truth/v1',
        'SUBSTRATE_POSTGRES_HOST=172.19.0.1',
        '',
      ].join('\n'),
    );

    await expect(runDoctor(root, { substrateTruthPath })).rejects.toThrow(
      /Docker substrate env is not accepted for GA handoff/u,
    );
  });

  it('rejects Docker substrate schema even when the file is JSON', async () => {
    const root = tempDir('post-deploy-smoke-doctor-docker-schema-');
    const substrateTruthPath = writeJson(root, 'deployment-target/substrate-truth.json', {
      schema_version: 'agentsmith.docker-substrate.truth/v1',
      values: {},
    });

    await expect(runDoctor(root, { substrateTruthPath })).rejects.toThrow(
      /Docker substrate schema is not accepted for GA handoff/u,
    );
  });

  it('rejects local-kind defaults as GA handoff input', async () => {
    const root = tempDir('post-deploy-smoke-doctor-local-kind-');
    const siteEnvPath = writeSiteEnv(root, {
      UNIFIED_DEPLOY_PROFILE: 'local-kind',
      PUBLIC_BASE_URL: 'http://agentsmith.localtest.me:29180',
    });

    await expect(runDoctor(root, { siteEnvPath })).rejects.toThrow(
      /local-kind defaults are not accepted/u,
    );
  });

  it('rejects raw secret env values in site env', async () => {
    const root = tempDir('post-deploy-smoke-doctor-raw-secret-');
    const siteEnvPath = writeSiteEnv(root, {
      MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN: 'llmup-admin-token',
    });

    await expect(runDoctor(root, { siteEnvPath })).rejects.toThrow(
      /site_env must not persist raw secret env values/u,
    );
  });

  it('rejects target axes mismatch between site env and neutral substrate truth', async () => {
    const root = tempDir('post-deploy-smoke-doctor-mismatch-');
    const siteEnvPath = writeSiteEnv(root, {
      UNIFIED_DEPLOY_PROFILE: 'existing_kubernetes/external_declared/airgap',
    });

    await expect(runDoctor(root, { siteEnvPath })).rejects.toThrow(
      /site_env target axes must match substrate_truth target axes/u,
    );
  });

  it('fails fast when neutral handoff input has no runtime substrate env projection', async () => {
    const root = tempDir('post-deploy-smoke-doctor-missing-runtime-');

    await expect(runDoctor(root, {
      runtimeSubstrateEnvSource: '',
      env: {},
    })).rejects.toThrow(
      /product-flow runtime substrate env projection is required for neutral GA handoff/u,
    );
  });
});
