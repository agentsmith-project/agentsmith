import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildVerificationPlan,
  publicRecommendedVerificationCommands,
  publicVerifyRunCommandForGoal,
  sanitizePublicVerificationText,
  verificationRunContractFailure,
  type BuildVerificationPlanInput,
  type VerificationGoal,
  type VerificationPlan,
} from './verify-impact-selector';
import {
  buildVerificationCatalog,
  writeVerificationCatalog,
} from './verification-catalog';
import { writeStoryAcceptanceReport } from './story-acceptance-report';
import { resolveMinimalLeaseStatusShadow } from './lease-status-shadow';
import {
  buildStatusProjection,
  renderShortFailureProjection,
  renderStatusProjectionLeaseShadowLines,
} from './status-projection';
import type { CurrentStatusProjection } from './current-status-projection-schema';
import {
  buildSentinelPreflightEnv,
  renderSentinelPreflightOutput,
  runSentinelPreflightSync,
  type SentinelPreflightResult,
  type SentinelProfile,
} from './sentinel-preflight';
import {
  defaultResourceOwnerPreflightEvidencePath,
  renderResourceOwnerPreflightSummary,
  runResourceOwnerPreflight,
  type ResourceOwnerPreflightResult,
} from './resource-owner-preflight';
import {
  buildGovernancePureCheckShadowAudit,
  PURE_CHECK_SHADOW_AUDIT_FILE_NAME,
} from './pure-check-shadow-audit';
import {
  evaluatePureCheckRuntimeShadowForVerifyRunSync,
  type PureCheckVerifyScriptExecution,
} from './pure-check-runtime-shadow';
import type { CurrentGateResultFailureClass } from './current-gate-result-schema';
import {
  createRunReadinessState,
} from './run-readiness-state';

export {
  buildVerificationPlan,
  type VerificationGoal,
  type VerificationMode,
  type VerificationPlan,
} from './verify-impact-selector';

type ParsedVerifyArgs = {
  goal: VerificationGoal;
  goalExplicit: boolean;
  run: boolean;
  status: boolean;
  json: boolean;
  reportRoot?: string;
  changedFiles?: string[];
  baseRef?: string;
};

type CliWriteStream = {
  write(chunk: string): unknown;
};

type NpmScriptResult = {
  status: number | null;
};

type NpmScriptRunContext = {
  reportRoot: string;
  repoRoot: string;
  gitSha: string;
  env: NodeJS.ProcessEnv;
};

type VerificationCliDependencies = {
  stdout?: CliWriteStream;
  stderr?: CliWriteStream;
  runNpmScript?: (script: string, context: NpmScriptRunContext) => NpmScriptResult;
  sentinelRunner?: (profile: SentinelProfile) => SentinelPreflightResult;
  ownerPreflight?: (evidencePath: string) => ResourceOwnerPreflightResult;
  pureCheckShadowRepoRoot?: string;
  pureCheckShadowGitSha?: string;
  pureCheckShadowToolchainIdentity?: Readonly<Record<string, string | null | undefined>>;
};

type ChangedFileDetection = {
  changedFiles: string[];
  failure?: string;
  warnings?: string[];
};

type BaseRefSource = 'explicit' | 'env' | 'github-pr' | 'implicit-local';

type BaseRefSelection = {
  ref: string;
  source: BaseRefSource;
};

type GitCommandResult = {
  args: readonly string[];
  status: number | null;
  stdout: string;
  stderr: string;
};

const PURE_CHECK_SHADOW_REPO_ROOT_ENV = 'AGENTSMITH_GOVERNANCE_CLAIM_STORE_ROOT';
const PURE_CHECK_SHADOW_GIT_SHA_ENV = 'AGENTSMITH_GOVERNANCE_CLAIM_STORE_GIT_SHA';
const VERIFY_REPORT_ROOT_ENV = 'AGENTSMITH_VERIFY_REPORT_ROOT';
const VERIFY_REPO_ROOT_ENV = 'AGENTSMITH_VERIFY_REPO_ROOT';
const VERIFY_GIT_SHA_ENV = 'AGENTSMITH_VERIFY_GIT_SHA';
const DEFAULT_GATE_REUSE_FAST_EVIDENCE_ENV = 'DEFAULT_GATE_REUSE_FAST_EVIDENCE';
const WORKSPACE_PROJECT_SKIP_FOCUSED_VISUAL_ENV = 'WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL';
const GOVERNANCE_SKIP_FOCUSED_VISUAL_ENV = 'GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL';
const BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE_ENV = 'BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE';
const DEFAULT_GATE_PROFILE_ENV = 'DEFAULT_GATE_PROFILE';
const SAME_RUN_REUSE_ENV_KEYS = [
  DEFAULT_GATE_REUSE_FAST_EVIDENCE_ENV,
  WORKSPACE_PROJECT_SKIP_FOCUSED_VISUAL_ENV,
  GOVERNANCE_SKIP_FOCUSED_VISUAL_ENV,
  BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE_ENV,
  DEFAULT_GATE_PROFILE_ENV,
] as const;

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function normalizeGoal(value: string | undefined): VerificationGoal {
  if (
    value === 'debug'
    || value === 'pr'
    || value === 'visual'
    || value === 'real'
    || value === 'release-real'
  ) {
    return value;
  }
  return 'pr';
}

function createVerificationRunId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function defaultReportRoot(runId = createVerificationRunId()): string {
  return path.join('artifacts', 'verification', runId);
}

function humanizeVerdict(verdict: string): string {
  if (verdict === 'not_evaluated_fail_closed') {
    return 'not evaluated (fail-closed)';
  }
  if (verdict === 'delegated_to_executed_verification_commands') {
    return 'delegated to the executed verification commands';
  }
  if (verdict === 'not_evaluated_next_action_required') {
    return 'not evaluated (next action required; no verify aliases executed)';
  }
  return verdict.replaceAll('_', ' ');
}

function cleanVerifyHumanText(value: string): string {
  return sanitizePublicVerificationText(value);
}

function uniqueRenderedRecommendedCommands(commands: readonly string[]): string[] {
  return publicRecommendedVerificationCommands(commands);
}

function renderRecommendedPlan(plan: VerificationPlan): string[] {
  if (plan.recommendedCommands.length === 0) {
    return ['No verify command is safe to run for this V4 plan; use the next action.'];
  }
  return uniqueRenderedRecommendedCommands(plan.recommendedCommands)
    .map((command, index) => `${index + 1}. ${command}`);
}

function renderRiskWarnings(plan: VerificationPlan): string {
  return `Risk warnings: ${plan.riskSummary.warnings.length > 0 ? cleanVerifyHumanText(plan.riskSummary.warnings.join('; ')) : '<none>'}`;
}

function includesText(values: readonly string[], pattern: RegExp): boolean {
  return values.some((value) => pattern.test(value));
}

const HEAVY_EVIDENCE_REASON_PATTERN =
  /release(?:\/| or )deploy|release or deploy operations|backend-real|visual|design-system|runner|context|credential|unmapped[- ]source|\bV[234]\b|verify:(?:visual|real|release-real)|--goal=(?:visual|real|release-real)|release:ready/i;
const NO_HEAVY_EVIDENCE_REASON_PATTERN =
  /docs-only|env-only|without visual or backend-real expansion/i;

function candidateHeavyEvidenceReasons(plan: VerificationPlan): string[] {
  return [
    ...plan.riskSummary.reasons,
    ...plan.riskSummary.warnings,
    plan.nextAction,
    ...plan.nextActions,
    `Required levels: ${plan.requiredLevels.join(', ')}`,
    `Required evidence: ${plan.requiredEvidence.join(', ')}`,
    `Recommended commands: ${plan.recommendedCommands.join(', ')}`,
    `Affected surfaces: ${plan.affectedSurfaces.join(', ')}`,
  ].filter((value) => value.trim().length > 0);
}

function selectHeavyEvidenceReason(plan: VerificationPlan, heavyRequired: boolean): string {
  const candidates = candidateHeavyEvidenceReasons(plan);
  const preferred = heavyRequired
    ? candidates.find((candidate) => (
        HEAVY_EVIDENCE_REASON_PATTERN.test(candidate)
        && !NO_HEAVY_EVIDENCE_REASON_PATTERN.test(candidate)
      ))
    : candidates.find((candidate) => NO_HEAVY_EVIDENCE_REASON_PATTERN.test(candidate));

  return cleanVerifyHumanText(
    preferred
      ?? (heavyRequired ? candidates.find((candidate) => HEAVY_EVIDENCE_REASON_PATTERN.test(candidate)) : undefined)
      ?? candidates[0]
      ?? plan.riskSummary.summary,
  );
}

function renderHeavyEvidenceDecision(plan: VerificationPlan): string {
  const visualRequired = plan.requiredLevels.includes('V2')
    || includesText(plan.requiredEvidence, /\bvisual\b/i)
    || includesText(plan.recommendedCommands, /\bverify:visual\b|--goal=visual\b/i);
  const backendRealRequired = plan.requiredLevels.includes('V3')
    || includesText(plan.requiredEvidence, /\bbackend-real\b/i)
    || includesText(plan.recommendedCommands, /\bverify:(?:real|release-real)\b|--goal=(?:real|release-real)\b|backend-real/i);
  const reason = selectHeavyEvidenceReason(plan, visualRequired || backendRealRequired);

  return `Heavy evidence: visual=${visualRequired ? 'yes' : 'no'}, backend-real=${backendRealRequired ? 'yes' : 'no'}; reason: ${reason}`;
}

export function renderVerificationPlan(plan: VerificationPlan): string {
  return [
    'AgentSmith Verification',
    '',
    `Goal: ${plan.goal}`,
    `Mode: ${plan.mode}`,
    `Report root: ${plan.reportRoot ?? '<not written>'}`,
    `Risk: ${plan.risk} conservative recommendation`,
    `Risk summary: ${plan.riskSummary.summary}`,
    renderRiskWarnings(plan),
    `Changed files: ${plan.changedFiles.length > 0 ? plan.changedFiles.join('; ') : '<none>'}`,
    `Affected stories: ${plan.affectedStories.join('; ')}`,
    `Affected surfaces: ${plan.affectedSurfaces.join('; ')}`,
    `Required levels: ${plan.requiredLevels.join(', ')}`,
    `Required evidence: ${plan.requiredEvidence.join(', ')}`,
    renderHeavyEvidenceDecision(plan),
    '',
    'Recommended plan:',
    ...renderRecommendedPlan(plan),
    '',
    `Next action: ${cleanVerifyHumanText(plan.nextAction)}`,
    ...(plan.nextActions.length > 1
      ? [
          'Next actions:',
          ...plan.nextActions.map((action, index) => `${index + 1}. ${cleanVerifyHumanText(action)}`),
        ]
      : []),
    `Final verdict: ${humanizeVerdict(plan.finalVerdict)}`,
    'Note: this is not release readiness and not a release verdict.',
    '',
  ].join('\n');
}

function renderProjectionValue(value: string | null): string {
  return value ? cleanVerifyHumanText(value) : '<none>';
}

function renderVerifyStatusProjection(projection: CurrentStatusProjection): string {
  const primaryBlocker = projection.primary_blocker
    ? `${projection.primary_blocker.owner} (${projection.primary_blocker.stage})`
    : '<none>';
  const deepestReason = projection.deepest_reason
    ? `${projection.deepest_reason.code}: ${projection.deepest_reason.summary}`
    : '<none>';

  return [
    'AgentSmith Verify Status',
    '',
    'Goal: verify',
    `Projection: ${projection.projection_kind.replaceAll('_', '-')}`,
    `Status: ${projection.presentation_status}`,
    `Phase: ${projection.phase}`,
    `Run ID: ${renderProjectionValue(projection.run_id)}`,
    `Primary blocker: ${primaryBlocker}`,
    `Deepest reason: ${deepestReason}`,
    `Safe next command: ${renderProjectionValue(projection.safe_next_command)}`,
    ...renderStatusProjectionLeaseShadowLines(projection),
    `Release decision produced: ${String(projection.release_decision_produced)}`,
    `Commands executed: ${String(projection.commands_executed)}`,
    `Authority aggregate: ${renderProjectionValue(projection.authority_paths.aggregate)}`,
    'Note: this status projection is read-only and does not produce a release verdict.',
    '',
  ].join('\n');
}

function writeVerifyPureCheckShadowAudit(args: {
  repoRoot: string;
  reportRoot: string;
  executedScripts: readonly string[];
  scriptExecutions?: readonly PureCheckVerifyScriptExecution[];
  generatedAt: string;
  gitSha: string;
  toolchainIdentity?: Readonly<Record<string, string | null | undefined>>;
}): string {
  const runtimeShadow = evaluatePureCheckRuntimeShadowForVerifyRunSync({
    repoRoot: args.repoRoot,
    reportRoot: args.reportRoot,
    executedScripts: args.executedScripts,
    scriptExecutions: args.scriptExecutions,
    generatedAt: args.generatedAt,
    gitSha: args.gitSha,
    toolchainIdentity: args.toolchainIdentity,
  });
  const audit = buildGovernancePureCheckShadowAudit({
    includeMissingChecks: false,
    generated_at: new Date().toISOString(),
    evaluations: runtimeShadow.evaluations,
  });
  const auditPath = path.join(args.reportRoot, PURE_CHECK_SHADOW_AUDIT_FILE_NAME);
  writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  return auditPath;
}

function parseArgs(argv: readonly string[]): ParsedVerifyArgs {
  let goal: VerificationGoal = 'pr';
  let goalExplicit = false;
  let run = false;
  let status = false;
  let json = false;
  let reportRoot: string | undefined;
  let changedFiles: string[] | undefined;
  let baseRef: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--run') {
      run = true;
    } else if (arg === '--status') {
      status = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--goal' && next) {
      goal = normalizeGoal(next);
      goalExplicit = true;
      index += 1;
    } else if (arg.startsWith('--goal=')) {
      goal = normalizeGoal(arg.slice('--goal='.length));
      goalExplicit = true;
    } else if (arg === '--dry-run') {
      run = false;
    } else if (arg === '--report-root' && next) {
      reportRoot = next;
      index += 1;
    } else if (arg.startsWith('--report-root=')) {
      reportRoot = arg.slice('--report-root='.length);
    } else if (arg === '--changed-file' && next) {
      changedFiles = [...(changedFiles ?? []), next];
      index += 1;
    } else if (arg.startsWith('--changed-file=')) {
      changedFiles = [...(changedFiles ?? []), arg.slice('--changed-file='.length)];
    } else if (arg === '--base-ref' && next) {
      baseRef = next;
      index += 1;
    } else if (arg.startsWith('--base-ref=')) {
      baseRef = arg.slice('--base-ref='.length);
    } else {
      throw new Error(`Unknown verify argument: ${arg}`);
    }
  }

  return {
    goal,
    goalExplicit,
    run,
    status,
    json,
    reportRoot,
    changedFiles,
    baseRef,
  };
}

function parseGitFileList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function runGit(args: readonly string[]): GitCommandResult {
  const result = spawnSync('git', [...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  return {
    args,
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function resolveVerifyGitSha(): string {
  const result = runGit(['rev-parse', 'HEAD']);
  if (result.status !== 0) {
    return 'unknown-git-sha';
  }
  const gitSha = result.stdout.trim().split(/\r?\n/)[0]?.trim();
  return gitSha && gitSha.length > 0 ? gitSha : 'unknown-git-sha';
}

function gitFailureMessage(result: GitCommandResult): string {
  const stderr = result.stderr.trim();
  return stderr || `git ${result.args.join(' ')} exited with status ${String(result.status)}`;
}

function baseRefUnavailableMessage(baseRef: BaseRefSelection, detail: string): string {
  return `base ref unavailable: ${baseRef.ref} (${detail})`;
}

function baseRefUnavailableDetection(baseRef: BaseRefSelection, detail: string): ChangedFileDetection {
  const message = baseRefUnavailableMessage(baseRef, detail);
  if (baseRef.source === 'implicit-local') {
    return {
      changedFiles: [],
      warnings: [
        `${message}; using goal default when no dirty working tree changes are present.`,
      ],
    };
  }
  return {
    changedFiles: [],
    failure: message,
  };
}

function selectBaseRef(options: ParsedVerifyArgs, env: NodeJS.ProcessEnv = process.env): BaseRefSelection {
  const explicitBaseRef = options.baseRef?.trim();
  if (explicitBaseRef) {
    return {
      ref: explicitBaseRef,
      source: 'explicit',
    };
  }

  const envBaseRef = env.VERIFY_BASE_REF?.trim();
  if (envBaseRef) {
    return {
      ref: envBaseRef,
      source: 'env',
    };
  }

  const githubBaseRef = env.GITHUB_BASE_REF?.trim();
  if (githubBaseRef) {
    return {
      ref: `origin/${githubBaseRef}`,
      source: 'github-pr',
    };
  }

  return {
    ref: 'origin/main',
    source: 'implicit-local',
  };
}

function addGitFileList(changedFiles: Set<string>, stdout: string): void {
  for (const filePath of parseGitFileList(stdout)) {
    changedFiles.add(filePath);
  }
}

function detectBaseDiffFiles(baseRef: BaseRefSelection, changedFiles: Set<string>): ChangedFileDetection {
  const verifyBaseResult = runGit(['rev-parse', '--verify', baseRef.ref]);
  if (verifyBaseResult.status !== 0) {
    return baseRefUnavailableDetection(baseRef, gitFailureMessage(verifyBaseResult));
  }

  const mergeBaseResult = runGit(['merge-base', 'HEAD', baseRef.ref]);
  if (mergeBaseResult.status !== 0) {
    return baseRefUnavailableDetection(baseRef, gitFailureMessage(mergeBaseResult));
  }

  const mergeBase = mergeBaseResult.stdout.trim().split(/\r?\n/)[0]?.trim();
  if (!mergeBase) {
    return baseRefUnavailableDetection(baseRef, `git merge-base HEAD ${baseRef.ref} returned an empty merge base`);
  }

  const baseDiffResult = runGit(['diff', '--name-only', `${mergeBase}..HEAD`]);
  if (baseDiffResult.status !== 0) {
    return {
      changedFiles: [],
      failure: gitFailureMessage(baseDiffResult),
    };
  }
  addGitFileList(changedFiles, baseDiffResult.stdout);

  return {
    changedFiles: [],
  };
}

function detectDirtyChangedFiles(changedFiles: Set<string>): ChangedFileDetection {
  const commands: readonly (readonly string[])[] = [
    ['diff', '--name-only'],
    ['diff', '--name-only', '--cached'],
    ['ls-files', '--others', '--exclude-standard'],
  ];

  for (const args of commands) {
    const result = runGit(args);
    if (result.status !== 0) {
      return {
        changedFiles: [],
        failure: gitFailureMessage(result),
      };
    }
    addGitFileList(changedFiles, result.stdout);
  }

  return {
    changedFiles: [],
  };
}

function detectChangedFilesFromGit(options: ParsedVerifyArgs): ChangedFileDetection {
  const changedFiles = new Set<string>();
  const warnings: string[] = [];
  const baseDiff = detectBaseDiffFiles(selectBaseRef(options), changedFiles);
  if (baseDiff.failure) {
    return baseDiff;
  }
  for (const warning of baseDiff.warnings ?? []) {
    warnings.push(warning);
  }

  const dirtyDiff = detectDirtyChangedFiles(changedFiles);
  if (dirtyDiff.failure) {
    return dirtyDiff;
  }
  for (const warning of dirtyDiff.warnings ?? []) {
    warnings.push(warning);
  }

  return {
    changedFiles: [...changedFiles].sort((left, right) => left.localeCompare(right)),
    warnings,
  };
}

function npmScriptFromCommand(command: string): string {
  return command.replace(/^npm run /, '');
}

function isInternalVerifyAdapterScript(script: string): boolean {
  return script.startsWith('verify:')
    || script.startsWith('gate:')
    || script.startsWith('lane:');
}

function internalVerifyCheckStepLabel(script: string): string {
  if (script === 'verify:quick') {
    return 'fast verification check step';
  }
  if (script === 'verify:default') {
    return 'default verification check step';
  }
  if (script === 'verify:visual') {
    return 'visual verification check step';
  }
  if (script === 'verify:real') {
    return 'backend-real verification check step';
  }
  if (script === 'verify:release-real') {
    return 'release backend-real verification check step';
  }
  if (script.startsWith('gate:')) {
    return 'gate verification check step';
  }
  if (script.startsWith('lane:')) {
    return 'lane verification check step';
  }
  return 'verification check step';
}

function sanitizedVerifyRunEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  for (const key of SAME_RUN_REUSE_ENV_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

function buildNpmScriptRunContext(args: {
  reportRoot: string;
  repoRoot: string;
  gitSha: string;
  readinessEnv?: NodeJS.ProcessEnv;
}): NpmScriptRunContext {
  return {
    reportRoot: args.reportRoot,
    repoRoot: args.repoRoot,
    gitSha: args.gitSha,
    env: {
      ...sanitizedVerifyRunEnv(process.env),
      [VERIFY_REPORT_ROOT_ENV]: args.reportRoot,
      [VERIFY_REPO_ROOT_ENV]: args.repoRoot,
      [VERIFY_GIT_SHA_ENV]: args.gitSha,
      [PURE_CHECK_SHADOW_REPO_ROOT_ENV]: args.repoRoot,
      [PURE_CHECK_SHADOW_GIT_SHA_ENV]: args.gitSha,
      ...(args.readinessEnv ?? {}),
    },
  };
}

function plannedNpmScripts(commands: readonly string[]): string[] {
  return commands.map(npmScriptFromCommand);
}

function plannedScriptRunsAfter(
  plannedScripts: readonly string[],
  currentScript: string,
  laterScript: string,
): boolean {
  const currentIndex = plannedScripts.indexOf(currentScript);
  const laterIndex = plannedScripts.indexOf(laterScript);
  return currentIndex >= 0 && laterIndex > currentIndex;
}

function buildSameRunEvidenceReuseEnv(args: {
  script: string;
  plannedScripts: readonly string[];
  executedScripts: readonly string[];
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (args.script === 'verify:default' && args.executedScripts.includes('verify:quick')) {
    env[DEFAULT_GATE_REUSE_FAST_EVIDENCE_ENV] = '1';
  }

  if (args.script === 'verify:default' && plannedScriptRunsAfter(args.plannedScripts, args.script, 'verify:visual')) {
    env[WORKSPACE_PROJECT_SKIP_FOCUSED_VISUAL_ENV] = '1';
    env[GOVERNANCE_SKIP_FOCUSED_VISUAL_ENV] = '1';
  }

  if (args.script === 'verify:real' && args.executedScripts.includes('verify:default')) {
    env[BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE_ENV] = '1';
  }

  return env;
}

function npmScriptRunContextForScript(args: {
  baseContext: NpmScriptRunContext;
  script: string;
  plannedScripts: readonly string[];
  executedScripts: readonly string[];
}): NpmScriptRunContext {
  return {
    ...args.baseContext,
    env: {
      ...args.baseContext.env,
      ...buildSameRunEvidenceReuseEnv({
        script: args.script,
        plannedScripts: args.plannedScripts,
        executedScripts: args.executedScripts,
      }),
    },
  };
}

function publicReportPlan(plan: VerificationPlan): VerificationPlan {
  return {
    ...plan,
    recommendedCommands: publicRecommendedVerificationCommands(plan.recommendedCommands),
  };
}

function defaultRunNpmScript(script: string, context: NpmScriptRunContext): NpmScriptResult {
  const result = spawnSync('npm', ['run', script], {
    cwd: process.cwd(),
    env: context.env,
    stdio: 'inherit',
  });
  return {
    status: result.status,
  };
}

function failureClassForNpmScriptResult(result: NpmScriptResult): CurrentGateResultFailureClass {
  return result.status === null ? 'infra_setup_failure' : 'product_regression';
}

function renderFailedNpmScriptSummary(args: {
  script: string;
  status: number | null;
  reportRoot: string;
  goal: VerificationGoal;
}): string {
  const exitStatus = args.status === null ? 'terminated without exit status' : `exit ${args.status}`;
  const governedRerun = publicVerifyRunCommandForGoal(args.goal);
  const internalAdapter = isInternalVerifyAdapterScript(args.script);
  const checkStepLabel = internalVerifyCheckStepLabel(args.script);
  const failureWhy = internalAdapter
    ? `internal ${checkStepLabel} for ${governedRerun} failed with ${exitStatus}.`
    : `${cleanVerifyHumanText(`npm run ${args.script}`)} failed with ${exitStatus}.`;
  const failedAdapterLine = internalAdapter
    ? `[verify] failed internal check step: ${checkStepLabel} (${exitStatus})`
    : `[verify] failed command: ${cleanVerifyHumanText(`npm run ${args.script}`)} (${exitStatus})`;
  return renderShortFailureProjection({
    verdict: 'FAILED',
    blocker: 'verify_alias_failed',
    stage: 'verify',
    why: failureWhy,
    rerunCommand: governedRerun,
    evidencePath: args.reportRoot,
  }) + [
    failedAdapterLine,
    `[verify] report root: ${args.reportRoot}`,
  ].join('\n') + '\n';
}

function scriptExecutionFromNpmResult(
  script: string,
  result: NpmScriptResult,
): PureCheckVerifyScriptExecution {
  const passed = result.status === 0;
  return {
    script,
    resultStatus: passed ? 'passed' : 'failed',
    failureClass: passed ? 'none' : failureClassForNpmScriptResult(result),
    exitCode: result.status,
  };
}

function defaultSentinelRunner(profile: SentinelProfile): SentinelPreflightResult {
  return runSentinelPreflightSync({
    profile,
    env: buildSentinelPreflightEnv({ profile }),
  });
}

function defaultOwnerPreflight(evidencePath: string): ResourceOwnerPreflightResult {
  return runResourceOwnerPreflight({
    target: 'verify-real',
    evidencePath,
  });
}

function verificationSentinelProfile(options: ParsedVerifyArgs): SentinelProfile | null {
  if (!options.run || !options.goalExplicit) {
    return null;
  }
  if (options.goal === 'real') {
    return 'verify-real';
  }
  if (options.goal === 'release-real') {
    return 'verify-release-real';
  }
  return null;
}

function buildPlanInput(options: ParsedVerifyArgs, reportRoot: string): BuildVerificationPlanInput {
  if (options.changedFiles) {
    return {
      goal: options.goal,
      goalExplicit: options.goalExplicit,
      run: options.run,
      reportRoot,
      changedFiles: options.changedFiles,
    };
  }

  const detected = detectChangedFilesFromGit(options);
  return {
    goal: options.goal,
    goalExplicit: options.goalExplicit,
    run: options.run,
    reportRoot,
    changedFiles: detected.changedFiles,
    changeDetectionFailure: detected.failure,
    changeDetectionWarnings: detected.warnings,
  };
}

export function runVerificationCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: VerificationCliDependencies = {},
): number {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const runNpmScript = dependencies.runNpmScript ?? defaultRunNpmScript;
  const sentinelRunner = dependencies.sentinelRunner ?? defaultSentinelRunner;
  const ownerPreflight = dependencies.ownerPreflight ?? defaultOwnerPreflight;

  try {
    const options = parseArgs(argv);
    if (options.json && !options.status) {
      throw new Error('--json is only supported with --status.');
    }
    if (options.status && options.run) {
      throw new Error('--status is read-only and cannot be combined with --run.');
    }
    if (options.status) {
      const projection = buildStatusProjection({
        goal: 'verify',
        leaseStatusShadow: resolveMinimalLeaseStatusShadow(),
      });
      stdout.write(options.json
        ? `${JSON.stringify(projection, null, 2)}\n`
        : renderVerifyStatusProjection(projection));
      return 0;
    }

    const reportRoot = options.reportRoot ?? defaultReportRoot();
    if (options.run && options.goalExplicit && options.goal === 'real') {
      const ownerPreflightEvidencePath = defaultResourceOwnerPreflightEvidencePath({
        target: 'verify-real',
        reportRoot,
      });
      const ownerPreflightResult = ownerPreflight(ownerPreflightEvidencePath);
      if (!ownerPreflightResult.ok) {
        stdout.write(renderResourceOwnerPreflightSummary(ownerPreflightResult, {
          rerunCommand: 'npm run verify -- --goal=real --run',
        }));
        return 1;
      }
    }
    const pureCheckShadowRepoRoot = dependencies.pureCheckShadowRepoRoot
      ?? process.env[PURE_CHECK_SHADOW_REPO_ROOT_ENV]
      ?? process.cwd();
    const generatedAt = new Date().toISOString();
    const catalog = buildVerificationCatalog({ generatedAt });
    const plan = buildVerificationPlan({
      ...buildPlanInput(options, reportRoot),
      generatedAt,
      catalog,
    });
    const catalogWriteResult = writeVerificationCatalog(catalog, reportRoot);
    const writeResult = writeStoryAcceptanceReport(publicReportPlan(plan), reportRoot, {
      verificationCatalogPath: catalogWriteResult.jsonPath,
    });

    stdout.write(renderVerificationPlan(plan));
    stdout.write(`Story acceptance report: ${writeResult.markdownPath}\n`);
    stdout.write(`Story acceptance report JSON: ${writeResult.jsonPath}\n`);
    stdout.write(`Verification catalog: ${catalogWriteResult.jsonPath}\n`);

    if (plan.mode === 'dry-run') {
      return 0;
    }

    const runContractFailure = verificationRunContractFailure({
      goal: options.goal,
      goalExplicit: options.goalExplicit,
      run: options.run,
      recommendedCommands: plan.recommendedCommands,
    });
    if (runContractFailure) {
      stderr.write(`[verify] ${runContractFailure}\n`);
      return 1;
    }

    const sentinelProfile = verificationSentinelProfile(options);
    if (sentinelProfile) {
      let sentinelResult: SentinelPreflightResult;
      try {
        sentinelResult = sentinelRunner(sentinelProfile);
      } catch {
        stderr.write(`[verify] sentinel preflight unavailable for ${sentinelProfile}.\n`);
        return 1;
      }
      if (sentinelResult.exitCode !== 0) {
        stdout.write(renderSentinelPreflightOutput(sentinelResult.output));
        stderr.write(`[verify] sentinel preflight failed for ${sentinelProfile}.\n`);
        return 1;
      }
    }

    const pureCheckShadowGitSha = dependencies.pureCheckShadowGitSha
      ?? process.env[PURE_CHECK_SHADOW_GIT_SHA_ENV]
      ?? resolveVerifyGitSha();
    const executedScripts: string[] = [];
    const scriptExecutions: PureCheckVerifyScriptExecution[] = [];
    const plannedScripts = plannedNpmScripts(plan.recommendedCommands);
    const npmScriptRunContext = buildNpmScriptRunContext({
      reportRoot,
      repoRoot: pureCheckShadowRepoRoot,
      gitSha: pureCheckShadowGitSha,
      readinessEnv: createRunReadinessState({
        scope: 'verify',
        root: reportRoot,
        gitSha: pureCheckShadowGitSha,
        input: {
          entrypoint: 'verify',
          goal: options.goal,
          goal_explicit: options.goalExplicit,
          mode: plan.mode,
          changed_files: plan.changedFiles,
          recommended_commands: plan.recommendedCommands,
          required_levels: plan.requiredLevels,
        },
        env: process.env,
      }).env,
    });
    for (const command of plan.recommendedCommands) {
      const script = npmScriptFromCommand(command);
      const result = runNpmScript(script, npmScriptRunContextForScript({
        baseContext: npmScriptRunContext,
        script,
        plannedScripts,
        executedScripts,
      }));
      const scriptExecution = scriptExecutionFromNpmResult(script, result);
      executedScripts.push(script);
      scriptExecutions.push(scriptExecution);
      if (result.status !== 0) {
        stderr.write(renderFailedNpmScriptSummary({
          script,
          status: result.status,
          reportRoot,
          goal: options.goal,
        }));
        const auditPath = writeVerifyPureCheckShadowAudit({
          repoRoot: pureCheckShadowRepoRoot,
          reportRoot,
          executedScripts,
          scriptExecutions,
          generatedAt,
          gitSha: pureCheckShadowGitSha,
          toolchainIdentity: dependencies.pureCheckShadowToolchainIdentity,
        });
        stdout.write(`Pure check shadow audit: ${auditPath}\n`);
        return typeof result.status === 'number' ? result.status : 1;
      }
    }
    const auditPath = writeVerifyPureCheckShadowAudit({
      repoRoot: pureCheckShadowRepoRoot,
      reportRoot,
      executedScripts,
      scriptExecutions,
      generatedAt,
      gitSha: pureCheckShadowGitSha,
      toolchainIdentity: dependencies.pureCheckShadowToolchainIdentity,
    });
    stdout.write(`Pure check shadow audit: ${auditPath}\n`);
    return 0;
  } catch (error) {
    stderr.write(`[verify] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isCliEntrypoint('run-verify.ts')) {
  process.exit(runVerificationCli());
}
