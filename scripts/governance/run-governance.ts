import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildGovernanceRunPlan,
  GOVERNANCE_RUN_PLAN_FILE_NAME,
  renderGovernanceRunPlanSummary,
  validateGovernanceRunPlan,
  type GovernanceRunPlanValidationFailure,
} from './governance-run-plan';

interface ParsedGovernanceRunArgs {
  subcommand: 'run';
  goal: string;
  reportRoot?: string;
  run: boolean;
  jobId?: string;
}

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function parseGovernanceRunArgs(argv: readonly string[]): ParsedGovernanceRunArgs {
  const [subcommand, ...args] = argv;
  if (subcommand !== 'run') {
    throw new Error('governance runner shell adapter only supports the internal run subcommand.');
  }

  let goal = 'release';
  let reportRoot: string | undefined;
  let run = false;
  let jobId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--goal' && next) {
      goal = next;
      index += 1;
    } else if (arg.startsWith('--goal=')) {
      goal = arg.slice('--goal='.length);
    } else if (arg === '--report-root' && next) {
      reportRoot = next;
      index += 1;
    } else if (arg.startsWith('--report-root=')) {
      reportRoot = arg.slice('--report-root='.length);
    } else if (arg === '--job-id' && next) {
      jobId = next;
      index += 1;
    } else if (arg.startsWith('--job-id=')) {
      jobId = arg.slice('--job-id='.length);
    } else if (arg === '--run') {
      run = true;
    } else {
      throw new Error(`unknown governance runner shell adapter argument: ${arg}`);
    }
  }

  return {
    subcommand,
    goal,
    reportRoot,
    run,
    jobId,
  };
}

function unsupportedGoalMessage(goal: string): string {
  return [
    `goal ${goal} is not supported by this P2 shell adapter slice.`,
    `Continue with \`npm run verify -- --goal=${goal}\` dry-run plan instead.`,
    'This adapter must not assemble daily jobs from shell fragments.',
  ].join(' ');
}

function writePlanFile(reportRoot: string, content: string): string {
  mkdirSync(reportRoot, { recursive: true });
  const outputPath = path.join(reportRoot, GOVERNANCE_RUN_PLAN_FILE_NAME);
  writeFileSync(outputPath, content);
  return outputPath;
}

function formatPlanValidationFailure(failure: GovernanceRunPlanValidationFailure): string {
  return `${failure.path}: ${failure.reason}`;
}

function assertValidPlanBeforeWrite(plan: unknown): void {
  const validation = validateGovernanceRunPlan(plan);

  if (!validation.ok) {
    throw new Error([
      'governance runner shell plan validation failed before writing output.',
      ...validation.failures.map(formatPlanValidationFailure),
    ].join(' '));
  }
}

export function runGovernanceCli(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const options = parseGovernanceRunArgs(argv);
    if (options.run) {
      throw new Error(
        'execution not supported in this slice; this adapter only writes manifest-backed plan_only JSON and does not run npm or shell commands.',
      );
    }
    if (options.goal !== 'release') {
      throw new Error(unsupportedGoalMessage(options.goal));
    }
    if (!options.reportRoot?.trim()) {
      throw new Error('report root is required for governance runner shell plan output.');
    }

    const plan = buildGovernanceRunPlan({
      goal: options.goal,
      reportRoot: options.reportRoot,
      jobId: options.jobId,
    });
    assertValidPlanBeforeWrite(plan);
    const outputPath = writePlanFile(options.reportRoot, `${JSON.stringify(plan, null, 2)}\n`);

    process.stdout.write(renderGovernanceRunPlanSummary(plan, outputPath));
    return 0;
  } catch (error) {
    process.stderr.write(`[governance-runner] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isCliEntrypoint('run-governance.ts')) {
  process.exit(runGovernanceCli());
}
