import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkUnifiedDeployVocabulary } from './check-unified-deploy-vocabulary';

const CHECK_SCRIPT = 'tsx scripts/contracts/check-unified-deploy-vocabulary.ts';
const CHECK_NPM_SCRIPT = 'contracts:check-unified-deploy-vocabulary';
const GA_RELEASE_PLAN_PATH = 'docs/engineering/agentsmith-ga-release-plan-v1.md';
const RELEASE_KIT_SPLIT_PLAN_PATH = 'docs/engineering/release-kit-and-runner-repo-split-kiss-plan-v1.md';
const HISTORICAL_UNIFIED_DEPLOY_MILESTONE_PATH =
  'docs/engineering/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md';

const validDeployContract = `# Unified Deploy Contract

Status: current_deploy_contract

Operator-facing release language is online / airgap x use_existing / install_substrates.
install_substrates maps to internal substrate_source=kit_installed and requires release-kit namespace-scoped installer evidence plus explicit confirmation.
The kit_provided compatibility alias remains internal to transition-only diagnostics and is not a GA operator deployment_path.

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

AgentSmith deploy exposes local-kind and existing-cluster as pre-GA/local diagnostic entry names.
Formal release language is online / airgap x use_existing / install_substrates.
install_substrates requires release-kit namespace-scoped installer evidence plus explicit confirmation.
The kit_provided compatibility alias remains internal to transition-only diagnostics and is not a GA operator deployment_path.
`;

const validP0BoundaryDoc = `# Active Doc

Formal release language is online / airgap x use_existing / install_substrates.
install_substrates requires release-kit namespace-scoped installer evidence plus explicit confirmation.
The kit_provided compatibility alias remains internal to transition-only diagnostics and is not a GA operator deployment_path.

## Current vs P0 Handoff Boundary

The Docker-only local-kind unified deploy path is the current pre-GA focused diagnostic baseline, not a long-term deployment truth.
\`external_declared\` in P0 is schema, fixture, validator, and evidence boundary only.
It does not mean P2/P3 completed real Kubernetes, cloud, or airgap handoff support.
`;

const validReleaseHandoffBoundaryDoc = `# Active Release Doc

## Release Kit Handoff Boundary

npm run product:ready is AgentSmith product readiness / local complete / current product gate: product evidence, full visual, backend-real release, and terminal aggregate evidence. It is not a future deployment, package, or operator release verdict. Unified deploy and local-kind deploy commands are transition-only focused diagnostics / 过渡期专项诊断. Release-kit owns deployment, package, and operator runbook verdict through repo-local final GA gate/evidence; AgentSmith retains product readiness, images/release contract, local full test, and thin adapter.
`;

const minimalGaReleasePlanDoc = `# AgentSmith GA Release Plan

Status: implementation-ready

This is the current GA implementation plan for AgentSmith product readiness, release-kit final GA verdict, runner adoption, dependency image locks, operator runbooks, and deployment verification.

GA operator-facing release language is online / airgap x use_existing / install_substrates.
install_substrates requires release-kit namespace-scoped installer evidence plus explicit confirmation.
The kit_provided compatibility alias remains internal to transition-only diagnostics; it is not a GA operator deployment_path.

## GA Target

The GA plan defines online/install_substrates and airgap/install_substrates as required deployment paths through operator-inputs.
`;

const minimalReleaseKitSplitPlanDoc = `# Release Kit Split Plan

Status: pre_ga_reference

This pre-GA reference preserves the release-kit / runner repo split background and historical context.
It is not the current GA implementation plan.

## Reference Boundary

This reference keeps the pre-GA repo boundary and split background available for handoff readers.
Historical evidence belongs in the evidence log reference.
`;

type FixtureOptions = {
  deployContract?: string | null;
  packageJson?: string | null;
  activeDocOverrides?: Record<string, string | null>;
};

const ACTIVE_DOC_PATHS = [
  'README.md',
  GA_RELEASE_PLAN_PATH,
  RELEASE_KIT_SPLIT_PLAN_PATH,
  'docs/engineering/README.md',
  'docs/contracts/README.md',
  'docs/contracts/product-terminology.md',
  'docs/CURRENT_BASELINE.md',
  'docs/README.md',
  'docs/current-engineering-governance-model.md',
  'docs/testing/verification-campaigns-v1.md',
  'docs/user-guides/README.md',
  'docs/user-guides/local-runtime-flows.md',
  'docs/user-guides/release-readiness-checklist.md',
  'docs/user-guides/runtime-lines-matrix.md',
  'docs/user-guides/uxui-review-runbook.md',
  'docs/user-guides/unified-deploy-operations.md',
  'docs/agent-task-runner-runbook.md',
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

  if (path === GA_RELEASE_PLAN_PATH) {
    return minimalGaReleasePlanDoc;
  }

  if (path === RELEASE_KIT_SPLIT_PLAN_PATH) {
    return minimalReleaseKitSplitPlanDoc;
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

  it('does not require the historical unified deploy milestone as active deploy truth', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [HISTORICAL_UNIFIED_DEPLOY_MILESTONE_PATH]: null,
      },
    });

    expect(checkUnifiedDeployVocabulary({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('requires the GA release plan as the current implementation plan', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [GA_RELEASE_PLAN_PATH]: null,
      },
    });

    expect(failureText(root)).toContain(`${GA_RELEASE_PLAN_PATH} must exist`);
  });

  it.each([
    'Current operator-facing release language remains online / airgap x use_existing / kit_provided.',
    'Formal release language is online / airgap x use_existing / kit_provided.',
  ])('rejects GA kit_provided current operator-path wording: %s', (implementedClaim) => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [GA_RELEASE_PLAN_PATH]: `${minimalGaReleasePlanDoc}

## Drift

${implementedClaim}
`,
      },
    });

    expect(failureText(root)).toContain(
      'GA release plan must not describe kit_provided as the current operator-facing path.',
    );
  });

  it('allows GA install_substrates wording that keeps installer evidence explicit', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [GA_RELEASE_PLAN_PATH]: `${minimalGaReleasePlanDoc}

## Boundary

install_substrates is current only through operator-inputs packages, namespace-scoped installer evidence, and explicit confirmation.
install_substrates 当前只允许通过 operator-inputs、namespace-scoped installer evidence 和显式确认进入 GA 路径。
`,
      },
    });

    expect(checkUnifiedDeployVocabulary({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('allows the split KISS plan as a pre-GA reference instead of current deploy truth', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: minimalReleaseKitSplitPlanDoc,
      },
    });

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

  it('allows current existing-cluster diagnostic entry wording', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        'scripts/contracts/check-current-runtime-lines.ts': 'current deploy runtime truth must expose exactly local-kind and existing-cluster pre-GA/local diagnostic entry names',
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
    'README.md',
    'docs/CURRENT_BASELINE.md',
    'docs/current-engineering-governance-model.md',
    'docs/contracts/product-terminology.md',
    'docs/engineering/README.md',
    'docs/user-guides/local-runtime-flows.md',
    'docs/user-guides/README.md',
    'docs/user-guides/unified-deploy-operations.md',
    'docs/contracts/README.md',
    'DEVELOPMENT.md',
  ])('rejects kit_provided as a current operator-facing success path in %s', (path) => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [path]: `${validP0BoundaryDoc}

Formal release language is online / airgap x use_existing / kit_provided.
`,
      },
    });

    const text = failureText(root);

    expect(text).toContain('current operator-facing substrate strategy');
    expect(text).toContain('install_substrates');
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

  it.each([
    'docs/user-guides/release-readiness-checklist.md',
    'docs/user-guides/unified-deploy-operations.md',
  ])('rejects stale release-kit future handoff wording in %s', (path) => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [path]: `${validReleaseHandoffBoundaryDoc}

After release-kit functional repo is ready, release-kit owns deployment, package, and operator verdict.
`,
      },
    });

    const text = failureText(root);

    expect(text).toContain(`${path}:`);
    expect(text).toContain('current GA boundary');
    expect(text).toContain('future release-kit-ready condition');
  });

  it('does not require release-kit split plan positive governance narrative', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: minimalReleaseKitSplitPlanDoc,
      },
    });

    expect(checkUnifiedDeployVocabulary({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
  });

  it('rejects split plan wording that makes kind or local-kind a formal target', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: `${minimalReleaseKitSplitPlanDoc}
## Drift

local-kind is a formal release target and required operator prerequisite.
`,
      },
    });

    const text = failureText(root);

    expect(text).toContain('kind/local-kind formal release target or prerequisite');
  });

  it('rejects split plan wording that treats release-kit focused evidence as AgentSmith readiness', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: `${minimalReleaseKitSplitPlanDoc}
## Drift

release-kit focused evidence becomes AgentSmith release readiness and product gate evidence.
`,
      },
    });

    const text = failureText(root);

    expect(text).toContain('release-kit focused evidence as AgentSmith release readiness');
  });

  it('rejects split plan wording that connects deployment or operator verdicts back to release:ready', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: `${minimalReleaseKitSplitPlanDoc}
## Drift

\`npm run release:ready\` owns the deployment package operator verdict for release-kit.
`,
      },
    });

    const text = failureText(root);

    expect(text).toContain('deployment/operator verdict connected to release:ready');
  });

  it.each([
    [
      'kind/local-kind formal release target or prerequisite',
      'local-kind is a formal release target. It is not an operator prerequisite.',
    ],
    [
      'release-kit focused evidence as AgentSmith release readiness',
      'release-kit focused evidence becomes AgentSmith release readiness. It does not create an operator verdict.',
    ],
    [
      'deployment/operator verdict connected to release:ready',
      'The deployment operator verdict feeds AgentSmith release:ready. It is not the product readiness gate.',
    ],
  ])('rejects split plan mixed false-negative wording for %s', (label, content) => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: `${minimalReleaseKitSplitPlanDoc}
## Drift

${content}
`,
      },
    });

    expect(failureText(root)).toContain(label);
  });

  it('allows split plan wording that only states the forbidden claims as negated boundaries', () => {
    const root = writeFixtureRoot({
      activeDocOverrides: {
        [RELEASE_KIT_SPLIT_PLAN_PATH]: `${minimalReleaseKitSplitPlanDoc}
## Boundary

local-kind is not a formal release target or required operator prerequisite.
local-kind / kind 不在正式 release target 层。
release-kit focused evidence does not become AgentSmith release readiness.
\`npm run release:ready\` is not a deployment package operator verdict.
增加 fail-fast contract tests: tag-only image、缺 digest、缺 required flow、deploy template required_image_ids 与 image inventory 不一致、kind 被当成必需部署目标。
`,
      },
    });

    expect(checkUnifiedDeployVocabulary({ rootDir: root })).toEqual({
      ok: true,
      failures: [],
    });
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
