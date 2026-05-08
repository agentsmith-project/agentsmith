import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkUnifiedDeployVocabulary } from './check-unified-deploy-vocabulary';

const CHECK_SCRIPT = 'tsx scripts/contracts/check-unified-deploy-vocabulary.ts';
const CHECK_NPM_SCRIPT = 'contracts:check-unified-deploy-vocabulary';

const validDeployContract = `# Unified Deploy Contract

Status: current_deploy_contract

## Runtime

- Substrate: Docker-only substrate.
- Identity: Keycloak substrate.
- llmup is app-managed and deployed as an AgentSmith app Kubernetes workload.
- api replicas=1.
- Route /api/v1 to api.
- Route /api/public to web.
- Route /api/system to web.
- No execution-gateway.
`;

const cleanActiveDoc = `# Active Doc

AgentSmith deploy uses local-kind and existing-cluster profiles.
`;

type FixtureOptions = {
  deployContract?: string | null;
  packageJson?: string | null;
  activeDocOverrides?: Record<string, string | null>;
};

const ACTIVE_DOC_PATHS = [
  'docs/contracts/README.md',
  'docs/contracts/product-terminology.md',
  'docs/CURRENT_BASELINE.md',
  'docs/user-guides/README.md',
  'docs/user-guides/unified-deploy-operations.md',
  'docs/engineering/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md',
  'DEVELOPMENT.md',
  'Makefile',
  'scripts/governance/current-workflow-manifest.ts',
  'scripts/governance/current-status-projection-schema.ts',
  'scripts/governance/current-governance-observability-manifest.ts',
] as const;

const fixtureRoots: string[] = [];

function writeText(root: string, relativePath: string, content: string): void {
  mkdirSync(join(root, relativePath, '..'), { recursive: true });
  writeFileSync(join(root, relativePath), content, 'utf8');
}

function writeFixtureRoot(options: FixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'unified-deploy-vocabulary-'));
  fixtureRoots.push(root);

  const deployContract = options.deployContract === undefined
    ? validDeployContract
    : options.deployContract;
  if (deployContract !== null) {
    writeText(root, 'docs/contracts/unified-deploy-contract.md', deployContract);
  }

  for (const path of ACTIVE_DOC_PATHS) {
    const override = options.activeDocOverrides?.[path];
    if (override === null) {
      continue;
    }

    writeText(root, path, override ?? cleanActiveDoc);
  }

  const packageJson = options.packageJson === undefined
    ? JSON.stringify({
      scripts: {
        [CHECK_NPM_SCRIPT]: CHECK_SCRIPT,
        'contracts:check': `npm run ${CHECK_NPM_SCRIPT}`,
      },
    }, null, 2)
    : options.packageJson;
  if (packageJson !== null) {
    writeText(root, 'package.json', packageJson);
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
  it('accepts the current unified deploy contract and clean active docs', () => {
    const root = writeFixtureRoot();

    expect(checkUnifiedDeployVocabulary({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('requires the current unified deploy contract document and marker', () => {
    const missingRoot = writeFixtureRoot({ deployContract: null });

    expect(failureText(missingRoot)).toContain('docs/contracts/unified-deploy-contract.md must exist');

    const unmarkedRoot = writeFixtureRoot({
      deployContract: validDeployContract.replace('current_deploy_contract', 'deploy_contract'),
    });

    expect(failureText(unmarkedRoot)).toContain('current_deploy_contract');
  });

  it('rejects split deploy wording in current deploy truth files', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        'docs/contracts/README.md': 'Read docs/contracts/unified-deploy-contract-v2.md as target-v2.',
      },
    });

    const text = failureText(root);

    expect(text).toContain('split deploy contract path');
    expect(text).toContain('split deploy naming');
  });

  it.each([
    ['removed deploy command family', 'Use demo-deploy for local installs.'],
    ['removed rehearsal command family', 'Run npm run rehearse:demo when release fails.'],
    ['split current-version wording', 'Keep current-v1 deployment contracts active.'],
    ['not-current deploy marker', 'Status: not_current_runtime_truth.'],
  ])('rejects %s in active docs', (_label, content) => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        'docs/user-guides/README.md': content,
      },
    });

    expect(failureText(root)).toContain('current deploy truth must not use');
  });

  it('reports missing substrate, routing, replica, and execution-gateway decisions', () => {
    const root = writeFixtureRoot({
      deployContract: `# Unified Deploy Contract

Status: current_deploy_contract

This intentionally omits the concrete deployment decisions.
`,
    });
    const text = failureText(root);

    expect(text).toContain('Docker-only substrate');
    expect(text).toContain('Keycloak substrate');
    expect(text).toContain('llmup app-managed workload');
    expect(text).toContain('api replicas=1');
    expect(text).toContain('/api/v1 routes to api');
    expect(text).toContain('/api/public and /api/system route to web');
    expect(text).toContain('no execution-gateway');
  });

  it.each([
    ['Keycloak app pod', '- Keycloak app pod runs inside the app workload.'],
    ['Kubernetes substrate', '- Substrate: Kubernetes substrate.'],
    ['api replicas > 1', '- api replicas=3 for high availability.'],
    ['execution-gateway', '- Route /api/v1 to execution-gateway.'],
  ])('rejects an active forbidden deploy claim for %s', (_label, forbiddenLine) => {
    const root = writeFixtureRoot({
      deployContract: `${validDeployContract}

## Drift

${forbiddenLine}
`,
    });

    expect(failureText(root)).toContain('current deploy contract must not state');
  });

  it('requires package wiring for the vocabulary checker', () => {
    const root = writeFixtureRoot({
      packageJson: JSON.stringify({
        scripts: {
          [CHECK_NPM_SCRIPT]: 'tsx scripts/contracts/other.ts',
          'contracts:check': 'npm run other',
        },
      }),
    });
    const text = failureText(root);

    expect(text).toContain(CHECK_SCRIPT);
    expect(text).toContain(`npm run ${CHECK_NPM_SCRIPT}`);
  });
});
