import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkUnifiedDeployVocabulary } from './check-unified-deploy-vocabulary';

const CHECK_SCRIPT = 'tsx scripts/contracts/check-unified-deploy-vocabulary.ts';
const CHECK_NPM_SCRIPT = 'contracts:check-unified-deploy-vocabulary';
const V1_AUTHORITY_CONTRACT_PATHS = [
  'docs/contracts/deployment-spec-v1.md',
  'docs/contracts/cluster-deployment-spec-v1.md',
  'docs/contracts/substrate-governance-and-runtime-lines-v1.md',
  'docs/contracts/address-truth-and-release-governance-v1.md',
  'docs/contracts/universal-proxy-integration-v1.md',
] as const;

const validTargetContract = `# Unified Deploy Contract V2

contract markers: target_v2_contract, not_current_runtime_truth

## Target v2 contract

- Substrate: Docker-only substrate.
- Identity: Keycloak substrate.
- llmup app-managed K8s workload is owned by the app layer.
- api replicas=1.
- Route /api/v1 to api.
- Route /api/public and /api/system to web.
- No execution-gateway.

## Current-v1 legacy migration notes

- current-v1 historical deployment lines: demo-deploy and cluster-deploy.
- Legacy env names DEMO_DEPLOY_MODE and CLUSTER_DEPLOY_MODE are superseded migration aliases only.
`;

const validDemoV1Contract = `# Demo Deployment Spec V1

Current-v1 boundary note: demo-deploy is current-v1 runtime truth only and is not the target-v2 unified deploy contract.
`;

const validClusterV1Contract = `# Cluster Deployment Spec V1

Current-v1 boundary note: cluster-deploy is current-v1 runtime truth only and is not the target-v2 unified deploy contract.
`;

function validAuthorityV1Contract(path: typeof V1_AUTHORITY_CONTRACT_PATHS[number]): string {
  return `# ${path}

Current-v1 boundary note: ${path} is current-v1 runtime truth only and is not the target-v2 unified deploy contract.
`;
}

type FixtureOptions = {
  targetContract?: string | null;
  demoV1Contract?: string | null;
  clusterV1Contract?: string | null;
  v1Contracts?: Partial<Record<typeof V1_AUTHORITY_CONTRACT_PATHS[number], string | null>>;
  packageJson?: string | null;
};

const fixtureRoots: string[] = [];

function writeFixtureRoot(options: FixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'unified-deploy-vocabulary-'));
  fixtureRoots.push(root);
  const contractsDir = join(root, 'docs', 'contracts');
  mkdirSync(contractsDir, { recursive: true });

  const targetContract = options.targetContract === undefined
    ? validTargetContract
    : options.targetContract;
  const demoV1Contract = options.demoV1Contract === undefined
    ? validDemoV1Contract
    : options.demoV1Contract;
  const clusterV1Contract = options.clusterV1Contract === undefined
    ? validClusterV1Contract
    : options.clusterV1Contract;
  const v1Contracts: Record<typeof V1_AUTHORITY_CONTRACT_PATHS[number], string | null> = {
    'docs/contracts/deployment-spec-v1.md': demoV1Contract,
    'docs/contracts/cluster-deployment-spec-v1.md': clusterV1Contract,
    'docs/contracts/substrate-governance-and-runtime-lines-v1.md': validAuthorityV1Contract('docs/contracts/substrate-governance-and-runtime-lines-v1.md'),
    'docs/contracts/address-truth-and-release-governance-v1.md': validAuthorityV1Contract('docs/contracts/address-truth-and-release-governance-v1.md'),
    'docs/contracts/universal-proxy-integration-v1.md': validAuthorityV1Contract('docs/contracts/universal-proxy-integration-v1.md'),
    ...options.v1Contracts,
  };
  const packageJson = options.packageJson === undefined
    ? JSON.stringify({
      scripts: {
        [CHECK_NPM_SCRIPT]: CHECK_SCRIPT,
        'contracts:check': `npm run ${CHECK_NPM_SCRIPT}`,
      },
    }, null, 2)
    : options.packageJson;

  if (targetContract !== null) {
    writeFileSync(
      join(contractsDir, 'unified-deploy-contract-v2.md'),
      targetContract,
      'utf8',
    );
  }
  for (const [relativePath, content] of Object.entries(v1Contracts)) {
    if (content === null) {
      continue;
    }

    writeFileSync(join(root, relativePath), content, 'utf8');
  }
  if (packageJson !== null) {
    writeFileSync(join(root, 'package.json'), packageJson, 'utf8');
  }

  return root;
}

function failureText(rootDir: string): string {
  const result = checkUnifiedDeployVocabulary({ rootDir });

  return result.failures
    .map((failure) => `${failure.path}:${failure.line ?? ''} ${failure.message}`)
    .join('\n');
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('checkUnifiedDeployVocabulary', () => {
  it('accepts the target-v2 vocabulary when legacy deployment terms stay in allowed contexts', () => {
    const root = writeFixtureRoot();

    expect(checkUnifiedDeployVocabulary({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('requires the target-v2 contract document and truth markers', () => {
    const missingRoot = writeFixtureRoot({ targetContract: null });
    const missingText = failureText(missingRoot);

    expect(missingText).toContain('unified deploy target-v2 contract must exist');

    const unmarkedRoot = writeFixtureRoot({
      targetContract: validTargetContract
        .replace('target_v2_contract, ', '')
        .replace('not_current_runtime_truth', 'runtime_truth'),
    });
    const unmarkedText = failureText(unmarkedRoot);

    expect(unmarkedText).toContain('target_v2_contract');
    expect(unmarkedText).toContain('not_current_runtime_truth');
  });

  it.each(V1_AUTHORITY_CONTRACT_PATHS)(
    'requires %s to carry a current-v1 boundary note',
    (contractPath) => {
      const root = writeFixtureRoot({
        v1Contracts: {
          [contractPath]: `# ${contractPath}\n\nLegacy notes without the boundary marker.\n`,
        },
      });
      const text = failureText(root);

      expect(text).toContain(contractPath);
      expect(text).toContain('current-v1 boundary note');
    },
  );

  it('reports every current-v1 authority contract that is missing the boundary note', () => {
    const root = writeFixtureRoot({
      v1Contracts: Object.fromEntries(
        V1_AUTHORITY_CONTRACT_PATHS.map((contractPath) => [
          contractPath,
          `# ${contractPath}\n\nLegacy notes without the boundary marker.\n`,
        ]),
      ),
    });
    const text = failureText(root);

    for (const contractPath of V1_AUTHORITY_CONTRACT_PATHS) {
      expect(text).toContain(contractPath);
    }
  });

  it('rejects legacy deployment terms outside the explicit target-v2 allowlist', () => {
    const root = writeFixtureRoot({
      targetContract: `${validTargetContract}

## Target v2 rollout

- Operators choose demo-deploy at install time.
`,
    });
    const text = failureText(root);

    expect(text).toContain('legacy deployment term');
    expect(text).toContain('allowed migration/current-v1/legacy/historical/negative/superseded contexts');
  });

  it('rejects demo/cluster as active future product modes even when the line mentions a legacy term', () => {
    const root = writeFixtureRoot({
      targetContract: `${validTargetContract}

## Legacy migration

- Active future product modes are demo-deploy and cluster-deploy.
`,
    });
    const text = failureText(root);

    expect(text).toContain('must not claim demo-deploy/cluster-deploy are active future product modes');
  });

  it('reports missing target-v2 substrate, routing, replica, and execution-gateway decisions', () => {
    const root = writeFixtureRoot({
      targetContract: `# Unified Deploy Contract V2

target_v2_contract
not_current_runtime_truth

## Target v2 contract

- This intentionally omits the concrete deployment decisions.
`,
    });
    const text = failureText(root);

    expect(text).toContain('Docker-only substrate');
    expect(text).toContain('Keycloak substrate');
    expect(text).toContain('llmup app-managed K8s workload');
    expect(text).toContain('api replicas=1');
    expect(text).toContain('/api/v1 to api');
    expect(text).toContain('/api/public and /api/system to web');
    expect(text).toContain('no execution-gateway');
  });

  it.each([
    ['Keycloak app pod', '- Keycloak app pod runs inside the unified app workload.'],
    ['K8s substrate', '- Substrate: K8s substrate.'],
    ['api replicas > 1', '- api replicas=3 for the unified target.'],
    ['execution-gateway', '- Route /api/v1 to execution-gateway.'],
  ])('rejects a target-v2 claim for %s', (_label, forbiddenLine) => {
    const root = writeFixtureRoot({
      targetContract: `${validTargetContract}

## Target v2 prohibited drift

${forbiddenLine}
`,
    });

    expect(failureText(root)).toContain('target-v2 must not state');
  });
});
