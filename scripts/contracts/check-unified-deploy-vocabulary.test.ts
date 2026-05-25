import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkUnifiedDeployVocabulary } from './check-unified-deploy-vocabulary';

const CHECK_SCRIPT = 'tsx scripts/contracts/check-unified-deploy-vocabulary.ts';
const CHECK_NPM_SCRIPT = 'contracts:check-unified-deploy-vocabulary';
const RELEASE_KIT_SPLIT_PLAN_PATH = 'docs/engineering/release-kit-and-runner-repo-split-kiss-plan-v1.md';

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

## Current vs P0 Handoff Boundary

The Docker-only local-kind unified deploy path is the current pre-GA focused diagnostic baseline, not a long-term deployment truth.
\`external_declared\` in P0 is schema, fixture, validator, and evidence boundary only.
It does not mean P2/P3 completed real Kubernetes, cloud, or airgap handoff support.
`;

const cleanActiveDoc = `# Active Doc

AgentSmith deploy uses local-kind and existing-cluster profiles.
`;

const validP0BoundaryDoc = `# Active Doc

## Current vs P0 Handoff Boundary

The Docker-only local-kind unified deploy path is the current pre-GA focused diagnostic baseline, not a long-term deployment truth.
\`external_declared\` in P0 is schema, fixture, validator, and evidence boundary only.
It does not mean P2/P3 completed real Kubernetes, cloud, or airgap handoff support.
`;

const validReleaseHandoffBoundaryDoc = `# Active Release Doc

## Release Kit Handoff Boundary

AgentSmith release:ready is product readiness / local complete / current product gate: product evidence, full visual, backend-real release, and terminal aggregate evidence. It is not a future deployment, package, or operator release verdict. Unified deploy and local-kind deploy commands are transition-only focused diagnostics / 过渡期专项诊断. After the release-kit functional repo is ready, release-kit owns deployment, package, and operator runbook verdict through repo-local gate and evidence; AgentSmith retains product readiness, images/release contract, local full test, and thin adapter.
`;

const releaseKitSplitPlanWithoutNewRepoBootstrapDoc = `# Release Kit Split Plan

Status: team_reviewed_p0_start_ready

## Current vs P0 Handoff Boundary

The Docker-only local-kind unified deploy path is the current pre-GA focused diagnostic baseline, not a long-term deployment truth.
\`external_declared\` in P0 is schema, fixture, validator, and evidence boundary only.
It does not mean P2/P3 completed real Kubernetes, cloud, or airgap handoff support.

## Release Contract Fields

\`deploy_template_package\` is a required AgentSmith release contract field.

## Source Boundary Handoff

\`contracts:check-release-kit-source-boundary\` defaults to the committed fixture only.
Run \`contracts:check-release-kit-source-boundary -- --scan-root <repo>\` for a real release-kit repo.
\`contracts:check-repo-split-bootstrap\` is not wired into total \`contracts:check\`; run it explicitly when creating a new repo or CI handoff.
`;

const validReleaseKitSplitPlanDoc = `${releaseKitSplitPlanWithoutNewRepoBootstrapDoc}
## New Repo Governance Bootstrap

AFSCP/ASBCP family reference is ASBCP-lite and non-normative reference only.
It is not a source dependency, contract dependency, or gate dependency.
New repos must start with a bootstrap-only/docs-governance-first PR, then repo-local team/owners start specialty work.
Minimum bootstrap pack: README.md, AGENTS.md, DEVELOPMENT.md or DEVELOPER.md guide, RELEASE_GATES or verify-release entrypoint, contracts/runbooks/ADR entrypoints.
Quick gate is not release readiness; formal release readiness is decided by the repo-local release gate.

## P2 / P5 Start Handoff

Before P2/P5 start, the new repo must have a bootstrap-only/docs-governance-first PR with the minimum bootstrap pack: README.md, AGENTS.md, DEVELOPMENT.md or DEVELOPER.md guide, RELEASE_GATES or verify-release entrypoint, contracts/runbooks/ADR entrypoints. Quick gate is not release readiness; formal release readiness is decided by the repo-local release gate.
`;

type FixtureOptions = {
  deployContract?: string | null;
  packageJson?: string | null;
  activeDocOverrides?: Record<string, string | null>;
};

const ACTIVE_DOC_PATHS = [
  'README.md',
  RELEASE_KIT_SPLIT_PLAN_PATH,
  'docs/engineering/README.md',
  'docs/contracts/README.md',
  'docs/contracts/product-terminology.md',
  'docs/CURRENT_BASELINE.md',
  'docs/README.md',
  'docs/current-engineering-governance-model.md',
  'docs/testing/verification-campaigns-v1.md',
  'docs/user-guides/README.md',
  'docs/user-guides/release-readiness-checklist.md',
  'docs/user-guides/runtime-lines-matrix.md',
  'docs/user-guides/uxui-review-runbook.md',
  'docs/user-guides/unified-deploy-operations.md',
  'docs/agent-task-runner-runbook.md',
  'docs/engineering/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md',
  'DEVELOPMENT.md',
  'AGENTS.md',
  '.env.local-manual.example',
  '.github/workflows/contracts-check.yml',
  '.gitignore',
  'Makefile',
  'scripts/workspace-project-default-gate.sh',
  'scripts/contracts/check-current-gates.ts',
  'scripts/contracts/check-current-runtime-lines.ts',
  'scripts/contracts/check-current-workflows.ts',
  'scripts/contracts/check-engineering-governance.ts',
  'scripts/governance/current-gate-manifest.ts',
  'scripts/governance/current-resource-lock-manifest.ts',
  'scripts/governance/current-runtime-line-manifest.ts',
  'scripts/governance/current-workflow-manifest.ts',
  'scripts/governance/current-verification-campaign-manifest.ts',
  'scripts/governance/current-status-projection-schema.ts',
  'scripts/governance/current-governance-observability-manifest.ts',
  'scripts/governance/release-campaign-execution.ts',
  'scripts/governance/release-ready.ts',
  'scripts/governance/release-summary.ts',
  'scripts/governance/run-current-verification-campaign.ts',
  'scripts/governance/run-verify.ts',
  'scripts/governance/verify-impact-selector.ts',
  'scripts/agent-task-terminal-matrix-real-gate.sh',
  'scripts/agent-task-terminal-real-smoke.sh',
  'scripts/local-manual/internal-common.sh',
  'scripts/local-manual/seed-agent-task-diagnostics.sh',
  'scripts/local-manual/verify-agent-task-diagnostics.sh',
] as const;

const fixtureRoots: string[] = [];

function defaultActiveDoc(path: string): string {
  if (
    path === 'docs/engineering/README.md'
    || path === 'docs/contracts/README.md'
    || path === 'docs/contracts/product-terminology.md'
    || path === 'docs/user-guides/runtime-lines-matrix.md'
  ) {
    return validP0BoundaryDoc;
  }

  if (path === 'docs/user-guides/unified-deploy-operations.md') {
    return `${validP0BoundaryDoc}
${validReleaseHandoffBoundaryDoc}`;
  }

  if (path === 'docs/user-guides/release-readiness-checklist.md') {
    return validReleaseHandoffBoundaryDoc;
  }

  if (path === RELEASE_KIT_SPLIT_PLAN_PATH) {
    return validReleaseKitSplitPlanDoc;
  }

  return cleanActiveDoc;
}

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

    writeText(root, path, override ?? defaultActiveDoc(path));
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

  it.each([
    'README.md',
    'docs/README.md',
    'docs/user-guides/release-readiness-checklist.md',
    'scripts/governance/current-gate-manifest.ts',
    'scripts/governance/current-verification-campaign-manifest.ts',
    'scripts/governance/release-ready.ts',
    'scripts/governance/verify-impact-selector.ts',
  ])('scans current release and governance surface %s for removed deploy vocabulary', (path) => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [path]: 'Operators should run demo-deploy before release.',
      },
    });

    expect(failureText(root)).toContain(`${path}:`);
  });

  it('allows only the retired local cluster-deploy scratch denylist in gitignore', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        '.gitignore': '.infra/cluster-deploy/\n',
      },
    });

    expect(checkUnifiedDeployVocabulary({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects the retired cluster-deploy scratch path outside the gitignore denylist', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        'docs/README.md': 'Keep .infra/cluster-deploy/ as an operator path.',
      },
    });

    expect(failureText(root)).toContain('current deploy truth must not use removed deploy command family');
  });

  it('allows current existing-cluster deploy profile wording', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        'scripts/contracts/check-current-runtime-lines.ts': 'current deploy runtime truth must expose exactly local-kind and existing-cluster deploy profiles',
      },
    });

    expect(checkUnifiedDeployVocabulary({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it.each([
    ['DEVELOPMENT.md', 'Agent task demo evidence should be seeded after local-real.'],
    ['docs/user-guides/uxui-review-runbook.md', 'Use app-shell demo for preview-only routes.'],
    ['scripts/governance/current-workflow-manifest.ts', 'create agent-task demo resources and start the host runner'],
    ['Makefile', './scripts/local-manual/seed-agent-task-demo.sh'],
  ])('rejects active generic demo wording in %s', (path, content) => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [path]: content,
      },
    });

    const text = failureText(root);

    expect(text).toContain(`${path}:`);
    expect(text).toContain('generic demo mental model');
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

  it('requires active docs to state the current versus P0 handoff boundary', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        'docs/user-guides/runtime-lines-matrix.md': cleanActiveDoc,
      },
    });

    const text = failureText(root);

    expect(text).toContain('P0/vNext handoff boundary');
    expect(text).toContain('external_declared');
  });

  it.each([
    'docs/user-guides/release-readiness-checklist.md',
    'docs/user-guides/unified-deploy-operations.md',
  ])('requires %s to state the transition release-kit handoff boundary', (path) => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [path]: `${path === 'docs/user-guides/unified-deploy-operations.md' ? validP0BoundaryDoc : '# Active Release Doc'}

\`npm run release:ready\` is the long-term final AgentSmith deployment package release verdict owner.
`,
      },
    });

    const text = failureText(root);

    expect(text).toContain(`${path}:`);
    expect(text).toContain('release-kit handoff boundary');
    expect(text).toContain('product readiness / local complete / current product gate');
    expect(text).toContain('transition-only focused diagnostics / 过渡期专项诊断');
    expect(text).toContain('deployment/package/operator verdict');
  });

  it('requires the split plan to document release-kit handoff-only checks', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: validP0BoundaryDoc,
      },
    });

    const text = failureText(root);

    expect(text).toContain('deploy_template_package');
    expect(text).toContain('--scan-root <repo>');
    expect(text).toContain('contracts:check-repo-split-bootstrap');
  });

  it('requires deploy_template_package to be marked required near the field', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: validReleaseKitSplitPlanDoc
          .replace('`deploy_template_package` is a required AgentSmith release contract field.', '`deploy_template_package` is an AgentSmith release contract field.')
          .replace('New repos must start with', 'This unrelated section must stay documented. New repos must start with'),
      },
    });

    const text = failureText(root);

    expect(text).toContain('deploy_template_package');
  });

  it('requires repo split bootstrap to say it is not wired into base contracts:check', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: validReleaseKitSplitPlanDoc
          .replace('`contracts:check-repo-split-bootstrap` is not wired into total `contracts:check`;', '`contracts:check-repo-split-bootstrap` is not wired into the aggregate check;'),
      },
    });

    const text = failureText(root);

    expect(text).toContain('contracts:check-repo-split-bootstrap');
  });

  it('rejects repo split bootstrap wording that says it is not optional while wired into total contracts:check', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: validReleaseKitSplitPlanDoc
          .replace('`contracts:check-repo-split-bootstrap` is not wired into total `contracts:check`;', '`contracts:check-repo-split-bootstrap` is not optional and wired into total `contracts:check`;'),
      },
    });

    const text = failureText(root);

    expect(text).toContain('contracts:check-repo-split-bootstrap');
  });

  it('requires AFSCP/ASBCP family reference to be ASBCP-lite or non-normative and not a source dependency', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: validReleaseKitSplitPlanDoc
          .replace(
            'AFSCP/ASBCP family reference is ASBCP-lite and non-normative reference only.\nIt is not a source dependency, contract dependency, or gate dependency.',
            'AFSCP/ASBCP family reference is reference only.\nIt is not a contract dependency or gate dependency.',
          ),
      },
    });

    const text = failureText(root);

    expect(text).toContain('AFSCP/ASBCP family reference');
  });

  it('requires the complete P0 handoff boundary in one markdown block', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        'docs/user-guides/runtime-lines-matrix.md': `# Active Doc

The Docker-only local-kind unified deploy path is the current pre-GA focused diagnostic baseline, not a long-term deployment truth.

\`external_declared\` in P0 is schema, fixture, validator, and evidence boundary only.

P2/P3 real Kubernetes, cloud, or airgap handoff is not complete.
`,
      },
    });

    const text = failureText(root);

    expect(text).toContain('P0/vNext handoff boundary');
  });

  it('requires the split plan to document new repo docs/governance-first bootstrap discipline', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: releaseKitSplitPlanWithoutNewRepoBootstrapDoc,
      },
    });

    const text = failureText(root);

    expect(text).toContain('AFSCP/ASBCP family reference');
    expect(text).toContain('bootstrap-only/docs-governance-first PR');
    expect(text).toContain('minimum bootstrap pack');
    expect(text).toContain('quick gate is not release readiness');
  });

  it('requires the minimum bootstrap pack contents near the minimum bootstrap pack', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: `${releaseKitSplitPlanWithoutNewRepoBootstrapDoc}
## New Repo Governance Bootstrap

AFSCP/ASBCP family reference is ASBCP-lite and non-normative reference only.
It is not a source dependency, contract dependency, or gate dependency.
New repos must start with a bootstrap-only/docs-governance-first PR, then repo-local team/owners start specialty work.
Minimum bootstrap pack: README.md, AGENTS.md, DEVELOPMENT.md or DEVELOPER.md guide, RELEASE_GATES or verify-release entrypoint.
Quick gate is not release readiness; formal release readiness is decided by the repo-local release gate.

## Other Future Work

contracts, runbooks, and ADR notes may be expanded later.
`,
      },
    });

    const text = failureText(root);

    expect(text).toContain('minimum bootstrap pack');
  });

  it('requires the split plan P2/P5 start handoff to explicitly check the minimum bootstrap pack', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: validReleaseKitSplitPlanDoc.replace(
          '## P2 / P5 Start Handoff\n\nBefore P2/P5 start, the new repo must have a bootstrap-only/docs-governance-first PR with the minimum bootstrap pack: README.md, AGENTS.md, DEVELOPMENT.md or DEVELOPER.md guide, RELEASE_GATES or verify-release entrypoint, contracts/runbooks/ADR entrypoints. Quick gate is not release readiness; formal release readiness is decided by the repo-local release gate.',
          '## Implementation Start Handoff\n\nBefore implementation start, the new repo can begin implementation after team review.',
        ),
      },
    });

    const text = failureText(root);

    expect(text).toContain('P2/P5 start');
    expect(text).toContain('minimum bootstrap pack');
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

  it.each([
    'demo:deploy',
    'cluster:deploy',
    'rehearse:demo',
    'rehearse:cluster',
  ])('rejects removed package script alias %s by script key', (scriptName) => {
    const root = writeFixtureRoot({
      packageJson: JSON.stringify({
        scripts: {
          [CHECK_NPM_SCRIPT]: CHECK_SCRIPT,
          'contracts:check': `npm run ${CHECK_NPM_SCRIPT}`,
          [scriptName]: 'echo legacy alias',
        },
      }, null, 2),
    });

    const text = failureText(root);

    expect(text).toContain('package.json script key');
    expect(text).toContain(scriptName);
  });
});
