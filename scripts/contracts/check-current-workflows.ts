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
const PRODUCT_READINESS_RELEASE_CONTRACT_INPUT_DIR =
  '${{ runner.temp }}/agentsmith-product-readiness/input';
const PRODUCT_READINESS_RELEASE_CONTRACT_INPUT_PATH =
  '${{ runner.temp }}/agentsmith-product-readiness/input/agentsmith-release-contract.json';
const PRODUCT_READINESS_ARTIFACT_STAGE =
  'artifacts/product-readiness-artifact-stage';
const PRODUCT_READINESS_RUN_COMMAND =
  'npm run product:ready -- --release-contract "${RELEASE_CONTRACT_INPUT_PATH}"';
const PRODUCT_READINESS_CHECKOUT_INPUT_PATH = 'artifacts/product-readiness/input';
const PRODUCT_READINESS_HANDOFF_RELATIVE_PATHS = [
  'product-readiness/product-readiness-report.json',
  'summary.json',
  'gate-release-full/result.json',
] as const;
const PRODUCT_READINESS_ARTIFACT_PATHS = [
  '${{ env.PRODUCT_READINESS_ARTIFACT_STAGE }}/**',
] as const;
const POST_DEPLOY_PRODUCT_SMOKE_ARTIFACT_WORKFLOW_PATH =
  '.github/workflows/post-deploy-product-smoke-artifact.yml';
const POST_DEPLOY_PRODUCT_SMOKE_ARTIFACT_JOB_ID = 'post-deploy-product-smoke';
const POST_DEPLOY_PRODUCT_SMOKE_ONLINE_ARTIFACT_NAME =
  'agentsmith-post-deploy-product-smoke-report';
const POST_DEPLOY_PRODUCT_SMOKE_AIRGAP_ARTIFACT_NAME =
  'agentsmith-post-deploy-product-smoke-airgap-report';
const POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_INPUT_DIR =
  '${{ runner.temp }}/agentsmith-post-deploy-product-smoke/input/release-contract';
const POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_INPUT_DIR =
  '${{ runner.temp }}/agentsmith-post-deploy-product-smoke/input/site-env';
const POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_INPUT_DIR =
  '${{ runner.temp }}/agentsmith-post-deploy-product-smoke/input/substrate-truth';
const POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_INPUT_PATH =
  '${{ runner.temp }}/agentsmith-post-deploy-product-smoke/input/release-contract/agentsmith-release-contract.json';
const POST_DEPLOY_PRODUCT_SMOKE_RUN_COMMAND = 'npm run lane:unified-deploy:product-flows';
const POST_DEPLOY_PRODUCT_SMOKE_HANDOFF_RELATIVE_PATH =
  'post-deploy-product-smoke/post-deploy-product-smoke-report.json';
const POST_DEPLOY_PRODUCT_SMOKE_ARTIFACT_PATHS = [
  '${{ env.POST_DEPLOY_PRODUCT_SMOKE_ROOT }}/**',
] as const;

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
  const steps = collectJobSteps(parsedWorkflow, jobId);
  const downloadStep = steps.find((step) => step.name === 'Download release contract artifact');
  const verifyStep = steps.find((step) => step.name === 'Verify release contract input');
  const runStep = steps.find((step) => step.name === 'Run product readiness');
  const downloadWith = asRecord(downloadStep?.with);
  const verifyEnv = asRecord(verifyStep?.env);
  const runEnv = asRecord(runStep?.env);
  const runCommands = collectJobRunCommands(parsedWorkflow, jobId);
  const stepNames = steps
    .map((step) => step.name)
    .filter((name): name is string => typeof name === 'string');

  if (jobEnv.PRESET_ENDPOINT_API_KEY !== '${{ secrets.PRESET_ENDPOINT_API_KEY || secrets.BACKEND_REAL_API_KEY }}') {
    failures.push(`${label} must pass PRESET_ENDPOINT_API_KEY through job env from GitHub Actions secrets`);
  }
  if (jobEnv.PRODUCT_READINESS_ARTIFACT_STAGE !== PRODUCT_READINESS_ARTIFACT_STAGE) {
    failures.push(`${label} must stage product readiness artifacts under a bounded upload staging directory`);
  }
  if (typeof jobEnv.PRODUCT_READINESS_ARTIFACT_STAGE === 'string' && jobEnv.PRODUCT_READINESS_ARTIFACT_STAGE.includes('runner.temp')) {
    failures.push(`${label} artifact staging path must not use runner.temp in job env because runner context is unavailable before job dispatch`);
  }
  if (downloadWith.path !== PRODUCT_READINESS_RELEASE_CONTRACT_INPUT_DIR) {
    failures.push(`${label} must download release contract input to ${PRODUCT_READINESS_RELEASE_CONTRACT_INPUT_DIR}`);
  }
  if (typeof downloadWith.path === 'string' && /^artifacts\//u.test(downloadWith.path)) {
    failures.push(`${label} must not download release contract input into the checkout worktree`);
  }
  if (verifyEnv.RELEASE_CONTRACT_INPUT_PATH !== PRODUCT_READINESS_RELEASE_CONTRACT_INPUT_PATH) {
    failures.push(`${label} verify step release contract input path must point to runner.temp`);
  }
  if (runEnv.RELEASE_CONTRACT_INPUT_PATH !== PRODUCT_READINESS_RELEASE_CONTRACT_INPUT_PATH) {
    failures.push(`${label} product:ready step release contract input path must point to runner.temp`);
  }
  if (!runCommands.includes('test -f "${RELEASE_CONTRACT_INPUT_PATH}"')) {
    failures.push(`${label} must verify the runner.temp release contract input`);
  }
  if (!runCommands.includes(PRODUCT_READINESS_RUN_COMMAND)) {
    failures.push(`${label} must run product:ready with the runner.temp release contract input path`);
  }
  if (workflowSource.includes(PRODUCT_READINESS_CHECKOUT_INPUT_PATH)) {
    failures.push(`${label} must not reference checkout-relative product readiness input paths before preflight`);
  }
  if (/\b(?:printf|cat|tee|touch|install|cp|mv|mkdir)\b[^\n]*(?:artifacts\/product-readiness|agentsmith-release-contract\.json)/u.test(runCommands)) {
    failures.push(`${label} must not write preflight release contract input files into the checkout worktree`);
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

function assertProductReadinessArtifactFailureEvidenceUpload(failures: string[]): void {
  const workflowPath = PRODUCT_READINESS_ARTIFACT_WORKFLOW_PATH;
  const jobId = PRODUCT_READINESS_ARTIFACT_JOB_ID;
  const label = `${workflowPath}:${jobId}`;
  const workflow = CURRENT_CI_WORKFLOW_MANIFEST.find((entry) => entry.path === workflowPath);
  const job = workflow?.jobs.find((entry) => entry.id === jobId);
  const steps = collectJobSteps(parseWorkflow(workflowPath), jobId);
  const handoffStep = steps.find((step) => step.name === 'Verify product readiness handoff files');
  const stageStepIndex = steps.findIndex((step) => step.name === 'Stage product readiness artifact');
  const uploadStepIndex = steps.findIndex((step) => step.name === 'Upload product readiness artifact');
  const stageStep = stageStepIndex >= 0 ? steps[stageStepIndex] : undefined;
  const uploadStep = steps.find((step) => step.name === 'Upload product readiness artifact');
  const handoffRun = typeof handoffStep?.run === 'string' ? handoffStep.run : '';
  const stageRun = typeof stageStep?.run === 'string' ? stageStep.run : '';
  const uploadWith = asRecord(uploadStep?.with);
  const uploadPaths = typeof uploadWith.path === 'string'
    ? uploadWith.path.split('\n').map((line) => line.trim()).filter(Boolean)
    : [];
  const notes = job?.notes ?? '';

  if (job === undefined) {
    failures.push(`${label} must exist in CURRENT_CI_WORKFLOW_MANIFEST`);
  } else {
    assertArrayEqual(
      job.evidenceFamilies,
      ['product_readiness_report', 'test_results', 'playwright_report'],
      `${label} evidence families must include product readiness evidence plus test reports`,
      failures,
    );
    assertArrayEqual(
      job.artifactPaths,
      PRODUCT_READINESS_ARTIFACT_PATHS,
      `${label} artifact paths must upload the staged campaign evidence and test reports`,
      failures,
    );
    if (!/success-only file check/i.test(notes) || !/not a failed-run verdict/i.test(notes) || !/excluding runtime caches/i.test(notes)) {
      failures.push(`${label} notes must preserve success-only handoff semantics and runtime-cache staging boundary`);
    }
  }

  if (handoffStep === undefined) {
    failures.push(`${label} must keep the success-only handoff file check step`);
  } else {
    if (handoffStep.if !== 'success()') {
      failures.push(`${label} handoff file check must run only on success()`);
    }
    for (const relativePath of PRODUCT_READINESS_HANDOFF_RELATIVE_PATHS) {
      if (!handoffRun.includes(`test -f "\${RELEASE_CAMPAIGN_ROOT}/${relativePath}"`)) {
        failures.push(`${label} handoff file check must require ${relativePath}`);
      }
    }
  }

  if (stageStep === undefined) {
    failures.push(`${label} must stage product readiness artifacts before upload`);
  } else {
    if (stageStep.if !== 'always()') {
      failures.push(`${label} artifact staging must run with if: always() so failed-run evidence can be uploaded`);
    }
    if (uploadStepIndex < 0 || stageStepIndex > uploadStepIndex) {
      failures.push(`${label} artifact staging must run before upload`);
    }
    for (const requiredSnippet of [
      'rsync -a --prune-empty-dirs',
      "--exclude='**/afscp-juicefs-cache/'",
      "--exclude='**/next-dist/'",
      '"${PRODUCT_READINESS_ARTIFACT_STAGE}/release-runs/${RELEASE_CAMPAIGN_RUN_ID}/"',
      'rsync -a test-results/',
      'rsync -a playwright-report/',
    ]) {
      if (!stageRun.includes(requiredSnippet)) {
        failures.push(`${label} artifact staging must include ${requiredSnippet}`);
      }
    }
  }

  if (uploadStep === undefined) {
    failures.push(`${label} must keep the product readiness artifact upload step`);
    return;
  }
  if (uploadStep.if !== 'always()') {
    failures.push(`${label} artifact upload must run with if: always() so failed-run evidence is downloadable`);
  }
  if (uploadWith['if-no-files-found'] !== 'error') {
    failures.push(`${label} artifact upload must still fail when no evidence files exist`);
  }
  assertArrayEqual(
    uploadPaths,
    PRODUCT_READINESS_ARTIFACT_PATHS,
    `${label} artifact upload paths must include only the staged artifact directory`,
    failures,
  );
  if (uploadPaths.includes('${{ env.RELEASE_CAMPAIGN_ROOT }}/**')) {
    failures.push(`${label} artifact upload must not scan the live release campaign root`);
  }
}

function assertPostDeployProductSmokeArtifactHandoff(failures: string[]): void {
  const workflowPath = POST_DEPLOY_PRODUCT_SMOKE_ARTIFACT_WORKFLOW_PATH;
  const jobId = POST_DEPLOY_PRODUCT_SMOKE_ARTIFACT_JOB_ID;
  const label = `${workflowPath}:${jobId}`;
  const workflowSource = readFileSync(path.join(rootDir, workflowPath), 'utf8');
  const parsedWorkflow = parseWorkflow(workflowPath);
  const rawOn = parsedWorkflow.on ?? parsedWorkflow.true;
  const workflowDispatch = asRecord(asRecord(rawOn).workflow_dispatch);
  const workflowInputs = asRecord(workflowDispatch.inputs);
  const smokeArtifactInput = asRecord(workflowInputs.smoke_artifact_name);
  const substrateTruthFilenameInput = asRecord(workflowInputs.substrate_truth_filename);
  const smokeArtifactOptions = asStringArray(smokeArtifactInput.options);
  const workflow = CURRENT_CI_WORKFLOW_MANIFEST.find((entry) => entry.path === workflowPath);
  const job = workflow?.jobs.find((entry) => entry.id === jobId);
  const steps = collectJobSteps(parsedWorkflow, jobId);
  const parsedJob = asRecord(asRecord(parsedWorkflow.jobs)[jobId]);
  const jobEnv = asRecord(parsedJob.env);
  const releaseContractDownloadStep = steps.find((step) => step.name === 'Download release contract artifact');
  const siteEnvDownloadStep = steps.find((step) => step.name === 'Download site env artifact');
  const substrateTruthDownloadStep = steps.find((step) => step.name === 'Download substrate truth artifact');
  const validateStep = steps.find((step) => step.name === 'Validate required secrets and inputs');
  const verifyStep = steps.find((step) => step.name === 'Verify handoff inputs');
  const runStep = steps.find((step) => step.name === 'Run post-deploy product smoke');
  const handoffStep = steps.find((step) => step.name === 'Verify post-deploy product smoke handoff file');
  const uploadStep = steps.find((step) => step.name === 'Upload post-deploy product smoke artifact');
  const validateEnv = asRecord(validateStep?.env);
  const verifyEnv = asRecord(verifyStep?.env);
  const runEnv = asRecord(runStep?.env);
  const releaseContractDownloadWith = asRecord(releaseContractDownloadStep?.with);
  const siteEnvDownloadWith = asRecord(siteEnvDownloadStep?.with);
  const substrateTruthDownloadWith = asRecord(substrateTruthDownloadStep?.with);
  const uploadWith = asRecord(uploadStep?.with);
  const uploadPaths = typeof uploadWith.path === 'string'
    ? uploadWith.path.split('\n').map((line) => line.trim()).filter(Boolean)
    : [];
  const runCommands = collectJobRunCommands(parsedWorkflow, jobId);
  const validateRun = typeof validateStep?.run === 'string' ? validateStep.run : '';
  const verifyRun = typeof verifyStep?.run === 'string' ? verifyStep.run : '';
  const runStepCommand = typeof runStep?.run === 'string' ? runStep.run : '';
  const handoffRun = typeof handoffStep?.run === 'string' ? handoffStep.run : '';
  const notes = job?.notes ?? '';

  if (smokeArtifactInput.type !== 'choice') {
    failures.push(`${label} smoke_artifact_name must be a choice input`);
  }
  assertArrayEqual(
    smokeArtifactOptions,
    [POST_DEPLOY_PRODUCT_SMOKE_ONLINE_ARTIFACT_NAME, POST_DEPLOY_PRODUCT_SMOKE_AIRGAP_ARTIFACT_NAME],
    `${label} smoke_artifact_name choices must stay on the canonical online/airgap GA artifact names`,
    failures,
  );
  if (smokeArtifactInput.default !== POST_DEPLOY_PRODUCT_SMOKE_ONLINE_ARTIFACT_NAME) {
    failures.push(`${label} smoke_artifact_name default must be ${POST_DEPLOY_PRODUCT_SMOKE_ONLINE_ARTIFACT_NAME}`);
  }
  if (substrateTruthFilenameInput.default !== 'substrate-truth.json') {
    failures.push(`${label} substrate_truth_filename default must be substrate-truth.json`);
  }
  if (job === undefined) {
    failures.push(`${label} must exist in CURRENT_CI_WORKFLOW_MANIFEST`);
  } else {
    if (job.laneId !== 'lane-unified-deploy-product-flows') {
      failures.push(`${label} must bind to lane-unified-deploy-product-flows for traceable evidence`);
    }
    if (
      job.requiresSecrets !== true
      || !job.requiredSecrets.includes('PRESET_ENDPOINT_API_KEY')
      || !job.requiredSecrets.includes('PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV')
    ) {
      failures.push(`${label} must require PRESET_ENDPOINT_API_KEY and PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV for backend-real product smoke`);
    }
    assertArrayEqual(
      job.evidenceFamilies,
      ['post_deploy_product_smoke_report'],
      `${label} evidence families must identify the post-deploy product smoke report`,
      failures,
    );
    assertArrayEqual(
      job.artifactPaths,
      POST_DEPLOY_PRODUCT_SMOKE_ARTIFACT_PATHS,
      `${label} artifact paths must upload only the post-deploy product smoke evidence root`,
      failures,
    );
    if (!/online or airgap GA handoff artifact/i.test(notes) || !/not an AgentSmith product readiness verdict/i.test(notes)) {
      failures.push(`${label} notes must keep product smoke as a handoff producer, not a product readiness verdict`);
    }
  }
  if (jobEnv.PRESET_ENDPOINT_API_KEY !== '${{ secrets.PRESET_ENDPOINT_API_KEY || secrets.BACKEND_REAL_API_KEY }}') {
    failures.push(`${label} must pass PRESET_ENDPOINT_API_KEY through job env from GitHub Actions secrets`);
  }
  if (Object.hasOwn(jobEnv, 'RELEASE_CONTRACT_INPUT_PATH')
    || Object.hasOwn(jobEnv, 'SITE_ENV_INPUT_DIR')
    || Object.hasOwn(jobEnv, 'SUBSTRATE_TRUTH_INPUT_DIR')) {
    failures.push(`${label} runner.temp-derived paths must not live in job env because runner context is unavailable before job dispatch`);
  }
  if (verifyEnv.RELEASE_CONTRACT_INPUT_PATH !== POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_INPUT_PATH
    || runEnv.RELEASE_CONTRACT_INPUT_PATH !== POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_INPUT_PATH) {
    failures.push(`${label} release contract step env must point to runner.temp`);
  }
  if (verifyEnv.SITE_ENV_INPUT_DIR !== POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_INPUT_DIR
    || runEnv.SITE_ENV_INPUT_DIR !== POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_INPUT_DIR) {
    failures.push(`${label} site env step env must point to runner.temp`);
  }
  if (verifyEnv.SUBSTRATE_TRUTH_INPUT_DIR !== POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_INPUT_DIR
    || runEnv.SUBSTRATE_TRUTH_INPUT_DIR !== POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_INPUT_DIR) {
    failures.push(`${label} substrate truth step env must point to runner.temp`);
  }
  if (releaseContractDownloadWith.path !== POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_INPUT_DIR) {
    failures.push(`${label} must download release contract input to ${POST_DEPLOY_PRODUCT_SMOKE_RELEASE_CONTRACT_INPUT_DIR}`);
  }
  if (siteEnvDownloadWith.path !== POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_INPUT_DIR) {
    failures.push(`${label} must download site env input to ${POST_DEPLOY_PRODUCT_SMOKE_SITE_ENV_INPUT_DIR}`);
  }
  if (substrateTruthDownloadWith.path !== POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_INPUT_DIR) {
    failures.push(`${label} must download substrate truth input to ${POST_DEPLOY_PRODUCT_SMOKE_SUBSTRATE_TRUTH_INPUT_DIR}`);
  }
  if (workflowSource.includes('artifacts/post-deploy-product-smoke/input')) {
    failures.push(`${label} must not use checkout-relative post-deploy product smoke input paths`);
  }
  if (!validateRun.includes(POST_DEPLOY_PRODUCT_SMOKE_ONLINE_ARTIFACT_NAME)
    || !validateRun.includes(POST_DEPLOY_PRODUCT_SMOKE_AIRGAP_ARTIFACT_NAME)) {
    failures.push(`${label} validation step must enforce both canonical product smoke artifact names`);
  }
  if (!validateRun.includes('site_env_filename must be a simple filename')) {
    failures.push(`${label} validation step must keep site_env_filename constrained to a simple filename`);
  }
  if (!validateRun.includes('substrate_truth_filename must be a simple filename')) {
    failures.push(`${label} validation step must keep substrate_truth_filename constrained to a simple filename`);
  }
  if (!validateRun.includes('PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV secret is required as the request-scoped runtime-only substrate env projection')) {
    failures.push(`${label} validation step must require the runtime-only product-flow substrate env projection secret`);
  }
  if (validateEnv.UNIFIED_DEPLOY_PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV_SOURCE !== '${{ secrets.PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV }}') {
    failures.push(`${label} validation step must receive PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV as request env`);
  }
  if (!verifyRun.includes('test -f "${RELEASE_CONTRACT_INPUT_PATH}"')) {
    failures.push(`${label} must verify the runner.temp release contract input`);
  }
  if (!verifyRun.includes('test -f "${SITE_ENV_INPUT_PATH}"')) {
    failures.push(`${label} must verify the runner.temp site env input`);
  }
  if (!verifyRun.includes('test -f "${SUBSTRATE_TRUTH_INPUT_PATH}"')) {
    failures.push(`${label} must verify the runner.temp substrate truth input`);
  }
  if (!verifyRun.includes('npm run post-deploy-product-smoke:doctor --')
    || !verifyRun.includes('--release-contract="${RELEASE_CONTRACT_INPUT_PATH}"')
    || !verifyRun.includes('--site-env="${SITE_ENV_INPUT_PATH}"')
    || !verifyRun.includes('--substrate-truth="${SUBSTRATE_TRUTH_INPUT_PATH}"')) {
    failures.push(`${label} must run the post-deploy product smoke input doctor during handoff input verification`);
  }
  if (
    verifyEnv.UNIFIED_DEPLOY_PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV_SOURCE !== '${{ secrets.PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV }}'
    || runEnv.UNIFIED_DEPLOY_PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV_SOURCE !== '${{ secrets.PRODUCT_FLOW_RUNTIME_SUBSTRATE_ENV }}'
  ) {
    failures.push(`${label} must pass the runtime-only substrate env projection through request env, not artifacts`);
  }
  if (!runStepCommand.includes('UNIFIED_DEPLOY_RELEASE_CONTRACT="${RELEASE_CONTRACT_INPUT_PATH}"')
    || !runStepCommand.includes('UNIFIED_DEPLOY_RELEASE_SITE_ENV="${SITE_ENV_INPUT_PATH}"')
    || !runStepCommand.includes('UNIFIED_DEPLOY_RELEASE_SUBSTRATE_TRUTH="${SUBSTRATE_TRUTH_INPUT_PATH}"')
    || !runStepCommand.includes('UNIFIED_DEPLOY_RELEASE_ROOT_DIR="${POST_DEPLOY_PRODUCT_SMOKE_ROOT}"')
    || !runStepCommand.includes('SITE_ENV_INPUT_PATH="${SITE_ENV_INPUT_DIR}/${SITE_ENV_FILENAME}"')
    || !runStepCommand.includes('SUBSTRATE_TRUTH_INPUT_PATH="${SUBSTRATE_TRUTH_INPUT_DIR}/${SUBSTRATE_TRUTH_FILENAME}"')
    || !runCommands.includes(POST_DEPLOY_PRODUCT_SMOKE_RUN_COMMAND)) {
    failures.push(`${label} must run ${POST_DEPLOY_PRODUCT_SMOKE_RUN_COMMAND} with downloaded release contract, site env, substrate truth, and output root env`);
  }
  if (handoffStep === undefined) {
    failures.push(`${label} must keep the success-only post-deploy product smoke handoff file check step`);
  } else {
    if (handoffStep.if !== 'success()') {
      failures.push(`${label} handoff file check must run only on success()`);
    }
    if (!handoffRun.includes(`test -f "\${POST_DEPLOY_PRODUCT_SMOKE_ROOT}/${POST_DEPLOY_PRODUCT_SMOKE_HANDOFF_RELATIVE_PATH}"`)) {
      failures.push(`${label} handoff file check must require ${POST_DEPLOY_PRODUCT_SMOKE_HANDOFF_RELATIVE_PATH}`);
    }
  }
  if (uploadStep === undefined) {
    failures.push(`${label} must keep the post-deploy product smoke artifact upload step`);
    return;
  }
  if (uploadStep.if !== 'always()') {
    failures.push(`${label} artifact upload must run with if: always() so failed-run evidence is downloadable`);
  }
  if (uploadWith.name !== '${{ inputs.smoke_artifact_name }}') {
    failures.push(`${label} artifact upload name must come from the canonical smoke_artifact_name choice input`);
  }
  if (uploadWith['if-no-files-found'] !== 'error') {
    failures.push(`${label} artifact upload must still fail when no evidence files exist`);
  }
  assertArrayEqual(
    uploadPaths,
    POST_DEPLOY_PRODUCT_SMOKE_ARTIFACT_PATHS,
    `${label} artifact upload paths must include only the post-deploy product smoke evidence root`,
    failures,
  );
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
assertProductReadinessArtifactFailureEvidenceUpload(failures);
assertPostDeployProductSmokeArtifactHandoff(failures);

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
