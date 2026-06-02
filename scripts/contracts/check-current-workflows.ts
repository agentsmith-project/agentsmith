import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  CURRENT_CI_WORKFLOW_MANIFEST,
  CURRENT_WORKFLOW_DOCUMENT_FILES,
  listCurrentGovernanceSurfaceInventory,
  listQuickHumanCurrentWorkflowCommands,
  type CurrentWorkflowCommand,
} from '../governance/current-workflow-manifest';

const rootDir = process.cwd();

type Rule = {
  pattern: RegExp;
  message: string;
  allowedFiles?: Set<string>;
};

const rules: Rule[] = [
  {
    pattern: /notebook-agent-demo-(up|down|status|check|restart-runner)/,
    message: 'legacy notebook-agent-demo command leaked into current path',
  },
  {
    pattern: /\bdemo-full-up\b|\bdemo-full-down\b/,
    message: 'legacy demo-full command leaked into current path',
  },
  {
    pattern: /\bmake dev-up\b|\bmake dev-down\b/,
    message: 'legacy dev-up/dev-down command leaked into current path',
  },
  {
    pattern:
      /\btest:mainline:strict\b|\btest:mainline:strict:real\b|\btest:governance:strict\b|\btest:visual:strict\b|\btest:smoke:real:notebook-mainline\b|\bgate:main\b|\bgate-main\b|\bworkspace-project-mainline-gate\.sh\b|\bgovernance-mainline-gate\.sh\b|\bsystem-notebook-real-smoke-gate\.sh\b|\bworkspace-project-mainline-engineering-checklist\.md\b|\bgovernance-mainline-engineering-checklist\.md\b/,
    message: 'legacy current command naming leaked into current path',
  },
  {
    pattern:
      /\btest:e2e:lane:mock:full\b(?!:with-visual)|\btest:members-governance\b|\btest:bundle:inputs\b|\btest:rendered-env\b|\bcontracts:check-engineering-sync\b/,
    message: 'duplicate workflow alias leaked into current path',
  },
];

const HUMAN_MARKDOWN_ONLY_PUSH_PATHS_IGNORE = [
  'docs/**/*.md',
  'README.md',
  'DEVELOPMENT.md',
  'DESIGN.md',
  'AGENTS.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
] as const;

const RUNNER_CONTRACT_BUILD_COMMAND = 'npm run build -w @mbos/agent-runner-contract';
const RUNNER_CONTRACT_ARTIFACT_NAME = 'agentsmith-runner-contract-artifact';
const RUNNER_CONTRACT_ARTIFACT_DOWNLOAD_PATH = 'artifacts/runner-contract-download';
const RUNNER_CONTRACT_PRODUCER_JOB_ID = 'produce-runner-contract-artifact';
const RUNNER_REPO_CONTRACT_HANDOFF_JOB_ID = 'runner-repo-contract-handoff';
const RUNNER_REPO_CONTRACT_HANDOFF_SCOPE_COMMAND = [
  'set -euo pipefail',
  'echo "This workflow only verifies cross-repo runner contract artifact handoff; it is not release readiness, runtime/image publication, runner adoption, signing, or attestation."',
].join('\n');
const RUNNER_REPO_CONTRACT_HANDOFF_COMMAND =
  'bash scripts/verify-release.sh --contract-consumer --artifact-root "$GITHUB_WORKSPACE/artifacts/runner-contract-download"';
const RUNNER_REPO_CHECKOUT_PATH = 'agentsmith-runner';
const RUNNER_REPO_REPOSITORY = 'agentsmith-project/agentsmith-runner';
const ENGINEERING_GOVERNANCE_REPORT_CHECKS_ARG = 'REPORT_CHECKS=typecheck,openapi-check,contracts-check';
const PRODUCT_READINESS_ARTIFACT_WORKFLOW_PATH = '.github/workflows/product-readiness-artifact.yml';
const PRODUCT_READINESS_ARTIFACT_JOB_ID = 'product-readiness';

const WORKFLOWS_WITH_HUMAN_MARKDOWN_ONLY_PUSH_IGNORES = new Set([
  '.github/workflows/image-publish.yml',
  '.github/workflows/quality-gates.yml',
]);

function listTrackedFiles(): string[] {
  const stdout = execFileSync('git', ['ls-files'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const currentPathFiles = new Set([
    ...CURRENT_WORKFLOW_DOCUMENT_FILES,
    'package.json',
    'playwright.config.ts',
    'docs/项目宪法.md',
  ]);

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => currentPathFiles.has(file));
}

function listTrackedWorkflowFiles(): string[] {
  const trackedStdout = execFileSync('git', ['ls-files', '.github/workflows/*.yml'], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const untrackedStdout = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '.github/workflows/*.yml'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  return [...new Set(`${trackedStdout}\n${untrackedStdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean))]
    .sort();
}

function listTrackedScriptFiles(): string[] {
  const stdout = execFileSync('git', ['ls-files', 'scripts'], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.sh') && existsSync(path.join(rootDir, line)))
    .sort();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseWorkflow(relativePath: string): Record<string, unknown> {
  return asRecord(YAML.parse(readFileSync(path.join(rootDir, relativePath), 'utf8')) as unknown);
}

function collectWorkflowTriggers(parsedWorkflow: Record<string, unknown>): string[] {
  const rawOn = parsedWorkflow.on ?? parsedWorkflow.true;
  if (typeof rawOn === 'string') {
    return [rawOn];
  }
  if (Array.isArray(rawOn)) {
    return asStringArray(rawOn).sort();
  }
  return Object.keys(asRecord(rawOn)).sort();
}

function collectWorkflowPushPathsIgnore(parsedWorkflow: Record<string, unknown>): string[] {
  const rawOn = parsedWorkflow.on ?? parsedWorkflow.true;
  const push = asRecord(asRecord(rawOn).push);
  return asStringArray(push['paths-ignore']);
}

function collectWorkflowJobIds(parsedWorkflow: Record<string, unknown>): string[] {
  return Object.keys(asRecord(parsedWorkflow.jobs)).sort();
}

function collectWorkflowDispatchStringInputNames(parsedWorkflow: Record<string, unknown>): string[] {
  const rawOn = parsedWorkflow.on ?? parsedWorkflow.true;
  const workflowDispatch = asRecord(asRecord(rawOn).workflow_dispatch);
  const inputs = asRecord(workflowDispatch.inputs);

  return Object.entries(inputs)
    .filter(([, input]) => {
      const inputRecord = asRecord(input);
      const inputType = inputRecord.type;
      return inputType === undefined || inputType === 'string';
    })
    .map(([name]) => name)
    .sort();
}

function collectDirectWorkflowDispatchInputRunInterpolations(
  relativePath: string,
  parsedWorkflow: Record<string, unknown>,
): string[] {
  const inputNames = collectWorkflowDispatchStringInputNames(parsedWorkflow);
  if (inputNames.length === 0) {
    return [];
  }

  const findings: string[] = [];
  for (const [jobId, rawJob] of Object.entries(asRecord(parsedWorkflow.jobs))) {
    const job = asRecord(rawJob);
    const steps = Array.isArray(job.steps) ? job.steps : [];

    for (const [stepIndex, rawStep] of steps.entries()) {
      const run = asRecord(rawStep).run;
      if (typeof run !== 'string') {
        continue;
      }

      for (const inputName of inputNames) {
        const inputExpression = new RegExp(
          String.raw`\$\{\{[^}]*\b(?:inputs|github\.event\.inputs)\.${escapeRegExp(inputName)}\b[^}]*\}\}`,
        );
        if (inputExpression.test(run)) {
          findings.push(`${relativePath}:${jobId}:steps[${stepIndex}] directly interpolates workflow_dispatch input ${inputName}`);
        }
      }
    }
  }

  return findings;
}

function collectJobRunCommands(parsedWorkflow: Record<string, unknown>, jobId: string): string {
  return collectJobRunCommandList(parsedWorkflow, jobId).join('\n');
}

function collectJobIf(parsedWorkflow: Record<string, unknown>, jobId: string): string {
  const job = asRecord(asRecord(parsedWorkflow.jobs)[jobId]);
  return typeof job.if === 'string' ? job.if.trim() : '';
}

function collectJobRunCommandList(parsedWorkflow: Record<string, unknown>, jobId: string): string[] {
  return collectJobSteps(parsedWorkflow, jobId)
    .map((step) => asRecord(step).run)
    .filter((run): run is string => typeof run === 'string')
    .map((run) => run.trim());
}

function collectJobSteps(parsedWorkflow: Record<string, unknown>, jobId: string): Record<string, unknown>[] {
  const job = asRecord(asRecord(parsedWorkflow.jobs)[jobId]);
  return Array.isArray(job.steps) ? job.steps.map(asRecord) : [];
}

function collectJobArtifactPaths(parsedWorkflow: Record<string, unknown>, jobId: string): string[] {
  const paths: string[] = [];

  for (const stepRecord of collectJobSteps(parsedWorkflow, jobId)) {
    if (stepRecord.uses !== 'actions/upload-artifact@v7') {
      continue;
    }

    const withRecord = asRecord(stepRecord.with);
    if (typeof withRecord.path !== 'string') {
      continue;
    }

    paths.push(
      ...withRecord.path
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }

  return paths.sort();
}

function readMakeTargetBlock(content: string, target: string): string {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${target}:`));
  if (start === -1) return '';

  const next = lines.findIndex((line, index) => index > start && /^[A-Za-z0-9_.-]+:/.test(line));
  return lines.slice(start, next === -1 ? lines.length : next).join('\n');
}

function renderMakeQuickDisplay(command: CurrentWorkflowCommand): string {
  return command.makeTarget ? `make ${command.makeTarget}` : command.command;
}

function extractMakeQuickHelpCommands(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.match(/^\s*@echo "  ((?:npm run|make) [^"]+)"$/)?.[1])
    .filter((command): command is string => Boolean(command));
}

function dependencyCallerKey(pathName: string, calls: readonly string[]): string {
  return `${pathName}:${calls.join('|')}`;
}

function collectDependencyCallerKeys(): string[] {
  const keys: string[] = [];
  const makefile = readFileSync(path.join(rootDir, 'Makefile'), 'utf8');

  if (readMakeTargetBlock(makefile, 'deps-up').includes('integration:deps:up')) {
    keys.push(dependencyCallerKey('Makefile', ['integration:deps:up']));
  }
  if (readMakeTargetBlock(makefile, 'deps-ready').includes('scripts/integration-deps-ready.ts')) {
    keys.push(dependencyCallerKey('Makefile', ['scripts/integration-deps-ready.ts']));
  }
  if (/^deps-bootstrap:\s*deps-up\s+deps-ready/m.test(makefile)) {
    keys.push(dependencyCallerKey('Makefile', ['deps-up', 'deps-ready']));
  }

  for (const scriptPath of listTrackedScriptFiles()) {
    const content = readFileSync(path.join(rootDir, scriptPath), 'utf8');
    if (/\bnpm run integration:deps:up\b/.test(content)) {
      keys.push(dependencyCallerKey(scriptPath, ['integration:deps:up']));
    }
    if (/\bmake\s+deps-ready\b/.test(content)) {
      keys.push(dependencyCallerKey(scriptPath, ['make deps-ready']));
    }
    if (/\bmake\s+deps-bootstrap\b/.test(content)) {
      keys.push(dependencyCallerKey(scriptPath, ['make deps-bootstrap']));
    }
  }

  return keys.sort();
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function assertArrayEqual(
  actual: readonly string[],
  expected: readonly string[],
  message: string,
  failures: string[],
): void {
  const actualText = sorted(actual).join('\n');
  const expectedText = sorted(expected).join('\n');
  if (actualText !== expectedText) {
    failures.push(`${message}; expected [${sorted(expected).join(', ')}], got [${sorted(actual).join(', ')}]`);
  }
}

function assertQualityGateJobBuildsRunnerContractBeforeColdExecution(
  parsedWorkflow: Record<string, unknown>,
  jobId: string,
  gateCommand: string,
  failures: string[],
): void {
  const runCommands = collectJobRunCommandList(parsedWorkflow, jobId);
  const installIndex = runCommands.indexOf('npm ci');
  const buildIndex = runCommands.indexOf(RUNNER_CONTRACT_BUILD_COMMAND);
  const gateIndex = runCommands.indexOf(gateCommand);
  const playwrightIndex = runCommands.findIndex((command) => command.startsWith('npx playwright install '));
  const label = `.github/workflows/quality-gates.yml:${jobId}`;

  if (installIndex === -1) {
    failures.push(`${label} must install dependencies with npm ci before cold gate execution`);
  }
  if (buildIndex === -1) {
    failures.push(`${label} must run ${RUNNER_CONTRACT_BUILD_COMMAND} after npm ci in cold CI`);
  }
  if (gateIndex === -1) {
    failures.push(`${label} must run ${gateCommand}`);
  }
  if (installIndex >= 0 && buildIndex >= 0 && installIndex >= buildIndex) {
    failures.push(`${label} must run ${RUNNER_CONTRACT_BUILD_COMMAND} after npm ci`);
  }
  if (buildIndex >= 0 && playwrightIndex >= 0 && buildIndex >= playwrightIndex) {
    failures.push(`${label} must run ${RUNNER_CONTRACT_BUILD_COMMAND} before Playwright install`);
  }
  if (buildIndex >= 0 && gateIndex >= 0 && buildIndex >= gateIndex) {
    failures.push(`${label} must run ${RUNNER_CONTRACT_BUILD_COMMAND} before ${gateCommand}`);
  }
}

function assertQualityGateVisualLaneManualOptIn(
  parsedWorkflow: Record<string, unknown>,
  failures: string[],
): void {
  const label = '.github/workflows/quality-gates.yml:lane-visual';
  const jobIf = collectJobIf(parsedWorkflow, 'lane-visual');
  const workflow = CURRENT_CI_WORKFLOW_MANIFEST.find(
    (entry) => entry.path === '.github/workflows/quality-gates.yml',
  );
  const job = workflow?.jobs.find((entry) => entry.id === 'lane-visual');

  if (!jobIf.includes("github.event_name == 'workflow_dispatch'")) {
    failures.push(`${label} if condition must run only from workflow_dispatch`);
  }
  if (!jobIf.includes('inputs.run_visual_lane')) {
    failures.push(`${label} if condition must require inputs.run_visual_lane`);
  }
  if (jobIf.includes("github.event_name == 'push'")) {
    failures.push(`${label} must not run by default on push`);
  }
  if (job?.blockingFor.includes('push') === true) {
    failures.push(`${label} manifest blockingFor must not include push`);
  }
  if (
    job !== undefined
    && (job.blockingFor.length !== 2
      || !job.blockingFor.includes('manual')
      || !job.blockingFor.includes('product_readiness'))
  ) {
    failures.push(`${label} manifest blockingFor must stay scoped to manual and product_readiness`);
  }
}

function assertProductReadinessArtifactSecretsStayProcessScoped(failures: string[]): void {
  const workflowPath = PRODUCT_READINESS_ARTIFACT_WORKFLOW_PATH;
  const jobId = PRODUCT_READINESS_ARTIFACT_JOB_ID;
  const label = `${workflowPath}:${jobId}`;
  const workflowSource = readFileSync(path.join(rootDir, workflowPath), 'utf8');
  const parsedWorkflow = parseWorkflow(workflowPath);
  const parsedJob = asRecord(asRecord(parsedWorkflow.jobs)[jobId]);
  const jobEnv = asRecord(parsedJob.env);
  const runCommands = collectJobRunCommands(parsedWorkflow, jobId);
  const stepNames = collectJobSteps(parsedWorkflow, jobId)
    .map((step) => step.name)
    .filter((name): name is string => typeof name === 'string');

  if (jobEnv.PRESET_ENDPOINT_API_KEY !== '${{ secrets.PRESET_ENDPOINT_API_KEY || secrets.BACKEND_REAL_API_KEY }}') {
    failures.push(`${label} must pass PRESET_ENDPOINT_API_KEY through job env from GitHub Actions secrets`);
  }
  if (!runCommands.includes(
    'npm run product:ready -- --release-contract artifacts/product-readiness/input/agentsmith-release-contract.json',
  )) {
    failures.push(`${label} must run product:ready with the downloaded release contract`);
  }
  if (stepNames.includes('Materialize backend-real endpoint env')) {
    failures.push(`${label} must not materialize backend-real endpoint env into the checkout worktree`);
  }
  if (workflowSource.includes('.env.backend-real')) {
    failures.push(`${label} must not write or read a checkout-relative .env.backend-real in CI`);
  }
  if (/>\s*(?:\.\/)?\.env(?:\.[A-Za-z0-9_-]+)?\b/u.test(runCommands)) {
    failures.push(`${label} must not redirect secrets into checkout-relative .env files`);
  }
  if (/\b(?:printf|cat|tee|touch|install|cp|mv)\b[^\n]*(?:\.\/)?\.env\.backend-real\b/u.test(runCommands)) {
    failures.push(`${label} must keep backend-real endpoint secrets process-scoped, not file-materialized`);
  }
}

function assertJobBuildsRunnerContractBeforeColdExecution(
  parsedWorkflow: Record<string, unknown>,
  workflowPath: string,
  jobId: string,
  targetCommand: string,
  failures: string[],
): void {
  const runCommands = collectJobRunCommandList(parsedWorkflow, jobId);
  const installIndex = runCommands.indexOf('npm ci');
  const buildIndex = runCommands.indexOf(RUNNER_CONTRACT_BUILD_COMMAND);
  const targetIndex = runCommands.indexOf(targetCommand);
  const label = `${workflowPath}:${jobId}`;

  if (installIndex === -1) {
    failures.push(`${label} must install dependencies with npm ci before cold CI execution`);
  }
  if (buildIndex === -1) {
    failures.push(`${label} must run ${RUNNER_CONTRACT_BUILD_COMMAND} after npm ci in cold CI`);
  }
  if (targetIndex === -1) {
    failures.push(`${label} must run ${targetCommand}`);
  }
  if (installIndex >= 0 && buildIndex >= 0 && installIndex >= buildIndex) {
    failures.push(`${label} must run ${RUNNER_CONTRACT_BUILD_COMMAND} after npm ci`);
  }
  if (buildIndex >= 0 && targetIndex >= 0 && buildIndex >= targetIndex) {
    failures.push(`${label} must run ${RUNNER_CONTRACT_BUILD_COMMAND} before ${targetCommand}`);
  }
}

function assertRunnerRepoContractHandoff(
  parsedWorkflow: Record<string, unknown>,
  workflowPath: string,
  failures: string[],
): void {
  const label = `${workflowPath}:${RUNNER_REPO_CONTRACT_HANDOFF_JOB_ID}`;
  const job = asRecord(asRecord(parsedWorkflow.jobs)[RUNNER_REPO_CONTRACT_HANDOFF_JOB_ID]);
  const steps = collectJobSteps(parsedWorkflow, RUNNER_REPO_CONTRACT_HANDOFF_JOB_ID);
  const runCommands = collectJobRunCommandList(parsedWorkflow, RUNNER_REPO_CONTRACT_HANDOFF_JOB_ID);
  const expectedRunCommands = [
    RUNNER_REPO_CONTRACT_HANDOFF_SCOPE_COMMAND,
    RUNNER_REPO_CONTRACT_HANDOFF_COMMAND,
  ];
  const [downloadStep = {}, checkoutStep = {}, setupNodeStep = {}, nonReadinessStep = {}, consumerStep = {}] = steps;
  const downloadWith = asRecord(downloadStep.with);
  const checkoutWith = asRecord(checkoutStep.with);
  const setupNodeWith = asRecord(setupNodeStep.with);
  const nonReadinessRun = typeof nonReadinessStep.run === 'string'
    ? nonReadinessStep.run.trim()
    : nonReadinessStep.run;
  const consumerRun = typeof consumerStep.run === 'string'
    ? consumerStep.run.trim()
    : consumerStep.run;

  if (Object.keys(job).length === 0) {
    failures.push(`${label} must exist as the focused runner repo handoff consumer gate`);
  }
  if (job.needs !== RUNNER_CONTRACT_PRODUCER_JOB_ID) {
    failures.push(`${label} must need ${RUNNER_CONTRACT_PRODUCER_JOB_ID}`);
  }
  if (steps.length !== 5) {
    failures.push(`${label} must contain exactly five focused steps: download artifact, checkout runner repo, setup node, non-readiness scope, runner consumer`);
  }
  if (
    runCommands.length !== expectedRunCommands.length
    || runCommands.some((command, index) => command !== expectedRunCommands[index])
  ) {
    failures.push(`${label} run steps must be exactly the non-readiness scope block followed by ${RUNNER_REPO_CONTRACT_HANDOFF_COMMAND}`);
  }
  if (
    downloadStep.name !== 'Download runner contract artifact'
    || downloadStep.uses !== 'actions/download-artifact@v7'
    || downloadStep.run !== undefined
    || downloadWith.name !== RUNNER_CONTRACT_ARTIFACT_NAME
    || downloadWith.path !== RUNNER_CONTRACT_ARTIFACT_DOWNLOAD_PATH
  ) {
    failures.push(`${label} step[0] must only download ${RUNNER_CONTRACT_ARTIFACT_NAME} to ${RUNNER_CONTRACT_ARTIFACT_DOWNLOAD_PATH}`);
  }
  if (
    checkoutStep.name !== 'Checkout agentsmith-runner'
    || checkoutStep.uses !== 'actions/checkout@v6'
    || checkoutStep.run !== undefined
    || checkoutWith.repository !== RUNNER_REPO_REPOSITORY
    || checkoutWith.path !== RUNNER_REPO_CHECKOUT_PATH
  ) {
    failures.push(`${label} step[1] must only checkout ${RUNNER_REPO_REPOSITORY} into ${RUNNER_REPO_CHECKOUT_PATH}`);
  }
  if (
    setupNodeStep.name !== 'Setup Node'
    || setupNodeStep.uses !== 'actions/setup-node@v6'
    || setupNodeStep.run !== undefined
    || setupNodeWith['node-version'] !== '24.14.1'
  ) {
    failures.push(`${label} step[2] must only setup Node 24.14.1 for the runner repo consumer`);
  }
  if (
    nonReadinessStep.name !== 'Non-readiness handoff scope'
    || nonReadinessStep.uses !== undefined
    || nonReadinessStep['working-directory'] !== undefined
    || nonReadinessRun !== RUNNER_REPO_CONTRACT_HANDOFF_SCOPE_COMMAND
  ) {
    failures.push(`${label} step[3] must only declare the non-readiness handoff scope`);
  }
  if (
    consumerStep.name !== 'Verify runner repo contract consumer'
    || consumerStep.uses !== undefined
    || consumerStep['working-directory'] !== RUNNER_REPO_CHECKOUT_PATH
    || consumerRun !== RUNNER_REPO_CONTRACT_HANDOFF_COMMAND
  ) {
    failures.push(`${label} step[4] must only run the runner repo contract consumer from ${RUNNER_REPO_CHECKOUT_PATH}`);
  }
}

const failures: string[] = [];
const governanceSurfaceInventory = listCurrentGovernanceSurfaceInventory();
const makefile = readFileSync(path.join(rootDir, 'Makefile'), 'utf8');
const makeQuickHelpWorkflowBlock = readMakeTargetBlock(makefile, 'quick-help');
const expectedQuickHelpCommands = listQuickHumanCurrentWorkflowCommands().map(renderMakeQuickDisplay);
const actualQuickHelpCommands = extractMakeQuickHelpCommands(makeQuickHelpWorkflowBlock);

assertArrayEqual(
  actualQuickHelpCommands,
  expectedQuickHelpCommands,
  'make quick-help must expose only public human entrypoints',
  failures,
);
if (/\binternal adapters?\b/i.test(makeQuickHelpWorkflowBlock)) {
  failures.push('make quick-help must not explain internal adapters in the public quick path');
}
if (/\blocal-manual adapter\b/i.test(makeQuickHelpWorkflowBlock)) {
  failures.push('make quick-help must not expose local-manual adapter wording in the public quick path');
}

for (const relativePath of listTrackedFiles()) {
  const absPath = path.join(rootDir, relativePath);
  let content = '';
  try {
    content = readFileSync(absPath, 'utf8');
  } catch {
    continue;
  }

  for (const rule of rules) {
    if (!rule.pattern.test(content)) {
      continue;
    }
    if (rule.allowedFiles?.has(relativePath)) {
      continue;
    }
    failures.push(`${relativePath}: ${rule.message}`);
  }
}

assertArrayEqual(
  CURRENT_CI_WORKFLOW_MANIFEST.map((workflow) => workflow.path),
  listTrackedWorkflowFiles(),
  'active GitHub workflow files must be declared in CURRENT_CI_WORKFLOW_MANIFEST',
  failures,
);

assertArrayEqual(
  governanceSurfaceInventory.dependencyStartupReadinessCallers.map((caller) => (
    dependencyCallerKey(caller.path, caller.calls)
  )),
  collectDependencyCallerKeys(),
  'lean governance inventory must identify every dependency startup/readiness caller',
  failures,
);

if (!governanceSurfaceInventory.evidenceAuthorityRoots.some((root) => root.authority === 'campaign')) {
  failures.push('lean governance inventory must include campaign authority roots');
}
if (!governanceSurfaceInventory.evidenceAuthorityRoots.some((root) => root.authority === 'standalone_diagnostic')) {
  failures.push('lean governance inventory must include standalone diagnostic roots');
}
if (governanceSurfaceInventory.publicHumanEntrypoints.length === 0) {
  failures.push('lean governance inventory must include public human entrypoints');
}

for (const workflow of CURRENT_CI_WORKFLOW_MANIFEST) {
  const parsedWorkflow = parseWorkflow(workflow.path);
  const workflowName = parsedWorkflow.name;
  if (workflowName !== workflow.workflowName) {
    failures.push(`${workflow.path} workflow name must match CI workflow manifest: ${workflow.workflowName}`);
  }

  for (const finding of collectDirectWorkflowDispatchInputRunInterpolations(workflow.path, parsedWorkflow)) {
    failures.push(`${finding}; pass workflow_dispatch string inputs through env before shell use`);
  }

  assertArrayEqual(
    workflow.triggers,
    collectWorkflowTriggers(parsedWorkflow),
    `${workflow.path} triggers must match CI workflow manifest`,
    failures,
  );

  if (WORKFLOWS_WITH_HUMAN_MARKDOWN_ONLY_PUSH_IGNORES.has(workflow.path)) {
    assertArrayEqual(
      collectWorkflowPushPathsIgnore(parsedWorkflow),
      HUMAN_MARKDOWN_ONLY_PUSH_PATHS_IGNORE,
      `${workflow.path} push paths-ignore must ignore only human markdown docs`,
      failures,
    );
  }

  assertArrayEqual(
    workflow.jobs.map((job) => job.id),
    collectWorkflowJobIds(parsedWorkflow),
    `${workflow.path} jobs must match CI workflow manifest`,
    failures,
  );

  for (const job of workflow.jobs) {
    assertArrayEqual(
      job.artifactPaths,
      collectJobArtifactPaths(parsedWorkflow, job.id),
      `${workflow.path}:${job.id} artifact paths must match CI workflow manifest`,
      failures,
    );

    if (job.requiresSecrets && job.requiredSecrets.length === 0) {
      failures.push(`${workflow.path}:${job.id} requires secrets but declares no requiredSecrets`);
    }
    if (job.evidenceRequired && job.artifactPaths.length === 0) {
      failures.push(`${workflow.path}:${job.id} requires evidence but publishes no artifacts`);
    }
    if (
      !job.gateId
      && !job.laneId
      && job.role !== 'integration_lane'
      && job.role !== 'contract_gate'
      && job.role !== 'artifact_producer'
    ) {
      failures.push(`${workflow.path}:${job.id} must declare a gateId or laneId for traceable CI truth`);
    }
  }
}

const engineeringWorkflow = CURRENT_CI_WORKFLOW_MANIFEST.find(
  (workflow) => workflow.path === '.github/workflows/engineering-gate.yml',
);
const engineeringJob = engineeringWorkflow?.jobs.find((job) => job.id === 'engineering-gate');
if (engineeringWorkflow?.role !== 'backend_real_regression' || engineeringWorkflow.scheduled !== true) {
  failures.push('engineering-gate.yml must be modeled as a scheduled backend-real regression workflow');
}
if (
  engineeringWorkflow?.productReadinessBlocking !== false
  || engineeringWorkflow?.blockingFor.includes('product_readiness') === true
  || engineeringWorkflow?.blockingFor.includes('handoff') === true
  || engineeringJob?.productReadinessBlocking !== false
  || engineeringJob?.blockingFor.includes('product_readiness') === true
  || engineeringJob?.blockingFor.includes('handoff') === true
) {
  failures.push('engineering-gate.yml must remain a scheduled/manual backend-real regression signal, not product readiness / handoff');
}
if (engineeringJob?.laneId !== 'lane-backend-real-core') {
  failures.push('engineering-gate.yml must bind its scheduled job to lane-backend-real-core');
}
if (!engineeringJob?.artifactPaths.includes('artifacts/backend-real/runs/**')) {
  failures.push('engineering-gate.yml must publish run-scoped backend-real evidence');
}
if (!engineeringJob?.artifactPaths.includes('artifacts/mock-lane/runs/**')) {
  failures.push('engineering-gate.yml must publish run-scoped mock-lane evidence produced by backend-real core');
}

const engineeringRunCommands = collectJobRunCommands(
  parseWorkflow('.github/workflows/engineering-gate.yml'),
  'engineering-gate',
);
if (!engineeringRunCommands.includes('npm run lane:backend-real:core')) {
  failures.push('engineering-gate.yml must run npm run lane:backend-real:core');
}
if (engineeringRunCommands.includes('make verify-governance')) {
  failures.push('engineering-gate.yml must not claim backend-real coverage while running make verify-governance');
}
const engineeringGovernanceReportCommands = engineeringRunCommands
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('make governance-report'));
const engineeringGovernanceReportChecksArePinned =
  engineeringGovernanceReportCommands.length === 2
  && engineeringGovernanceReportCommands.every((command) => command.includes(ENGINEERING_GOVERNANCE_REPORT_CHECKS_ARG));
if (!engineeringGovernanceReportChecksArePinned) {
  failures.push(
    `engineering-gate.yml governance report step must pass ${ENGINEERING_GOVERNANCE_REPORT_CHECKS_ARG} in every branch`,
  );
}

assertQualityGateJobBuildsRunnerContractBeforeColdExecution(
  parseWorkflow('.github/workflows/quality-gates.yml'),
  'lane-visual',
  'npm run lane:visual',
  failures,
);
assertQualityGateVisualLaneManualOptIn(
  parseWorkflow('.github/workflows/quality-gates.yml'),
  failures,
);
assertProductReadinessArtifactSecretsStayProcessScoped(failures);

const runnerContractArtifactWorkflowPath = '.github/workflows/runner-contract-artifact.yml';
const runnerContractArtifactWorkflow = parseWorkflow(runnerContractArtifactWorkflowPath);
assertJobBuildsRunnerContractBeforeColdExecution(
  runnerContractArtifactWorkflow,
  runnerContractArtifactWorkflowPath,
  RUNNER_CONTRACT_PRODUCER_JOB_ID,
  'npx tsx scripts/governance/runner-contract-artifact.ts',
  failures,
);
assertJobBuildsRunnerContractBeforeColdExecution(
  runnerContractArtifactWorkflow,
  runnerContractArtifactWorkflowPath,
  'consume-runner-contract-artifact',
  'npx tsx scripts/contracts/check-agent-runner-contract-artifact.ts --artifact-root artifacts/runner-contract-download',
  failures,
);
assertRunnerRepoContractHandoff(
  runnerContractArtifactWorkflow,
  runnerContractArtifactWorkflowPath,
  failures,
);

if (failures.length > 0) {
  console.error('[contracts] current workflow check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[contracts] current workflow check passed');
