import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  buildVerificationPlan,
  type BuildVerificationPlanInput,
  type VerificationGoal,
  type VerificationPlan,
} from './verify-impact-selector';
import {
  buildVerificationCatalog,
  writeVerificationCatalog,
} from './verification-catalog';
import { writeStoryAcceptanceReport } from './story-acceptance-report';

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
  reportRoot?: string;
  changedFiles?: string[];
};

type ChangedFileDetection = {
  changedFiles: string[];
  failure?: string;
};

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
    return 'not evaluated (fail-closed dry-run)';
  }
  if (verdict === 'delegated_to_executed_verification_commands') {
    return 'delegated to the executed verification commands';
  }
  if (verdict === 'not_evaluated_next_action_required') {
    return 'not evaluated (next action required; no verify aliases executed)';
  }
  return verdict.replaceAll('_', ' ');
}

function renderRecommendedPlan(plan: VerificationPlan): string[] {
  if (plan.recommendedCommands.length === 0) {
    return ['No verify alias is safe to run for this V4 plan; use the next action.'];
  }
  return plan.recommendedCommands.map((command, index) => `${index + 1}. ${command}`);
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
    `Changed files: ${plan.changedFiles.length > 0 ? plan.changedFiles.join('; ') : '<none>'}`,
    `Affected stories: ${plan.affectedStories.join('; ')}`,
    `Affected surfaces: ${plan.affectedSurfaces.join('; ')}`,
    `Required levels: ${plan.requiredLevels.join(', ')}`,
    `Required evidence: ${plan.requiredEvidence.join(', ')}`,
    '',
    'Recommended plan:',
    ...renderRecommendedPlan(plan),
    '',
    `Next action: ${plan.nextAction}`,
    `Final verdict: ${humanizeVerdict(plan.finalVerdict)}`,
    'Note: this is not release readiness and not a release verdict.',
    '',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): ParsedVerifyArgs {
  let goal: VerificationGoal = 'pr';
  let goalExplicit = false;
  let run = false;
  let reportRoot: string | undefined;
  let changedFiles: string[] | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--run') {
      run = true;
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
    } else {
      throw new Error(`Unknown verify argument: ${arg}`);
    }
  }

  return {
    goal,
    goalExplicit,
    run,
    reportRoot,
    changedFiles,
  };
}

function parseGitFileList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function detectChangedFilesFromGit(): ChangedFileDetection {
  const commands: readonly (readonly string[])[] = [
    ['diff', '--name-only'],
    ['diff', '--name-only', '--cached'],
    ['ls-files', '--others', '--exclude-standard'],
  ];
  const changedFiles = new Set<string>();

  for (const args of commands) {
    const result = spawnSync('git', [...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
      return {
        changedFiles: [],
        failure: stderr || `git ${args.join(' ')} exited with status ${String(result.status)}`,
      };
    }
    for (const filePath of parseGitFileList(result.stdout)) {
      changedFiles.add(filePath);
    }
  }

  return {
    changedFiles: [...changedFiles].sort((left, right) => left.localeCompare(right)),
  };
}

function npmScriptFromCommand(command: string): string {
  return command.replace(/^npm run /, '');
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

  const detected = detectChangedFilesFromGit();
  return {
    goal: options.goal,
    goalExplicit: options.goalExplicit,
    run: options.run,
    reportRoot,
    changedFiles: detected.changedFiles,
    changeDetectionFailure: detected.failure,
  };
}

export function runVerificationCli(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const options = parseArgs(argv);
    const reportRoot = options.reportRoot ?? defaultReportRoot();
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

    process.stdout.write(renderVerificationPlan(plan));
    process.stdout.write(`Story acceptance report: ${writeResult.markdownPath}\n`);
    process.stdout.write(`Story acceptance report JSON: ${writeResult.jsonPath}\n`);
    process.stdout.write(`Verification catalog: ${catalogWriteResult.jsonPath}\n`);

    if (plan.mode === 'dry-run') {
      return 0;
    }

    for (const command of plan.recommendedCommands) {
      const result = spawnSync('npm', ['run', npmScriptFromCommand(command)], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      });
      if (result.status !== 0) {
        return typeof result.status === 'number' ? result.status : 1;
      }
    }
    return 0;
  } catch (error) {
    process.stderr.write(`[verify] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isCliEntrypoint('run-verify.ts')) {
  process.exit(runVerificationCli());
}
