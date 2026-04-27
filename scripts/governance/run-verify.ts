import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildVerificationPlan,
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
  buildGovernancePureCheckShadowAudit,
  PURE_CHECK_SHADOW_AUDIT_FILE_NAME,
} from './pure-check-shadow-audit';
import {
  evaluatePureCheckRuntimeShadowForVerifyRunSync,
  type PureCheckVerifyScriptExecution,
} from './pure-check-runtime-shadow';
import type { CurrentGateResultFailureClass } from './current-gate-result-schema';

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

type VerificationCliDependencies = {
  stdout?: CliWriteStream;
  stderr?: CliWriteStream;
  runNpmScript?: (script: string) => NpmScriptResult;
  sentinelRunner?: (profile: SentinelProfile) => SentinelPreflightResult;
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

const GOVERNED_VERIFY_RUN_COMMAND_BY_ALIAS: Record<string, string> = {
  'npm run verify:quick': 'npm run verify -- --goal=debug --run',
  'npm run verify:default': 'npm run verify -- --goal=pr --run',
  'npm run verify:visual': 'npm run verify -- --goal=visual --run',
  'npm run verify:real': 'npm run verify -- --goal=real --run',
  'npm run verify:release-real': 'npm run verify -- --goal=release-real --run',
};

const GOVERNED_VERIFY_RUN_COMMAND_PRIORITY = [
  'npm run verify:release-real',
  'npm run verify:real',
  'npm run verify:visual',
  'npm run verify:default',
  'npm run verify:quick',
] as const;

function governedVerifyRunCommand(plan: VerificationPlan): string | null {
  for (const alias of GOVERNED_VERIFY_RUN_COMMAND_PRIORITY) {
    if (plan.recommendedCommands.includes(alias)) {
      return GOVERNED_VERIFY_RUN_COMMAND_BY_ALIAS[alias];
    }
  }
  return null;
}

function cleanVerifyHumanText(value: string): string {
  return Object.entries(GOVERNED_VERIFY_RUN_COMMAND_BY_ALIAS).reduce(
    (current, [alias, command]) => current.split(alias).join(command),
    value,
  );
}

function renderRecommendedPlan(plan: VerificationPlan): string[] {
  if (plan.recommendedCommands.length === 0) {
    return ['No verify command is safe to run for this V4 plan; use the next action.'];
  }
  const command = governedVerifyRunCommand(plan);
  return command ? [`1. ${command}`] : ['Use the governed verify entrypoint after reviewing this plan.'];
}

function renderRiskWarnings(plan: VerificationPlan): string {
  return `Risk warnings: ${plan.riskSummary.warnings.length > 0 ? cleanVerifyHumanText(plan.riskSummary.warnings.join('; ')) : '<none>'}`;
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
  return value ?? '<none>';
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
    generated_at: args.generatedAt,
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

function defaultRunNpmScript(script: string): NpmScriptResult {
  const result = spawnSync('npm', ['run', script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  return {
    status: result.status,
  };
}

function failureClassForNpmScriptResult(result: NpmScriptResult): CurrentGateResultFailureClass {
  return result.status === null ? 'infra_setup_failure' : 'product_regression';
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
    const writeResult = writeStoryAcceptanceReport(plan, reportRoot, {
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
    for (const command of plan.recommendedCommands) {
      const script = npmScriptFromCommand(command);
      const result = runNpmScript(script);
      const scriptExecution = scriptExecutionFromNpmResult(script, result);
      executedScripts.push(script);
      scriptExecutions.push(scriptExecution);
      if (result.status !== 0) {
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
