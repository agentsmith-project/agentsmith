import { spawnSync } from 'node:child_process';

export type VerificationGoal = 'debug' | 'pr' | 'visual' | 'real' | 'release-real';
export type VerificationMode = 'dry-run' | 'run';

export interface VerificationPlan {
  goal: VerificationGoal;
  mode: VerificationMode;
  risk: 'fail-closed';
  affectedStories: readonly string[];
  affectedSurfaces: readonly string[];
  requiredLevels: readonly string[];
  requiredEvidence: readonly string[];
  recommendedCommands: readonly string[];
  finalVerdict: string;
}

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

function recommendedCommands(goal: VerificationGoal): readonly string[] {
  if (goal === 'debug') {
    return ['npm run verify:quick'];
  }
  if (goal === 'visual') {
    return [
      'npm run verify:quick',
      'npm run verify:default',
      'npm run verify:visual',
    ];
  }
  if (goal === 'real') {
    return [
      'npm run verify:quick',
      'npm run verify:default',
      'npm run verify:real',
    ];
  }
  if (goal === 'release-real') {
    return ['npm run verify:release-real'];
  }
  return [
    'npm run verify:quick',
    'npm run verify:default',
    'npm run verify:real',
  ];
}

function requiredLevels(goal: VerificationGoal): readonly string[] {
  if (goal === 'debug') {
    return ['V0'];
  }
  if (goal === 'visual') {
    return ['V0', 'V1', 'V2'];
  }
  if (goal === 'release-real') {
    return ['V3'];
  }
  return ['V0', 'V1', 'V3'];
}

function requiredEvidence(goal: VerificationGoal): readonly string[] {
  if (goal === 'visual') {
    return ['default gate result', 'visual full catalog evidence'];
  }
  if (goal === 'release-real') {
    return ['release backend-real ux_trace_bundle evidence'];
  }
  if (goal === 'debug') {
    return ['fast gate result'];
  }
  return ['default gate result', 'backend-real ux_trace_bundle evidence'];
}

export function buildVerificationPlan(input: {
  goal?: VerificationGoal;
  run?: boolean;
} = {}): VerificationPlan {
  const goal = input.goal ?? 'pr';
  const mode: VerificationMode = input.run ? 'run' : 'dry-run';

  return {
    goal,
    mode,
    risk: 'fail-closed',
    affectedStories: ['P0 impact selector not implemented; assume affected stories require conservative review.'],
    affectedSurfaces: ['changed files not selected in P0; treat cross-surface governance/release changes as elevated risk.'],
    requiredLevels: requiredLevels(goal),
    requiredEvidence: requiredEvidence(goal),
    recommendedCommands: recommendedCommands(goal),
    finalVerdict: mode === 'dry-run'
      ? 'not evaluated'
      : 'delegated to the executed verification commands',
  };
}

export function renderVerificationPlan(plan: VerificationPlan): string {
  return [
    'AgentSmith Verification',
    '',
    `Goal: ${plan.goal}`,
    `Mode: ${plan.mode}`,
    `Risk: ${plan.risk} conservative recommendation`,
    `Affected stories: ${plan.affectedStories.join('; ')}`,
    `Affected surfaces: ${plan.affectedSurfaces.join('; ')}`,
    `Required levels: ${plan.requiredLevels.join(', ')}`,
    `Required evidence: ${plan.requiredEvidence.join(', ')}`,
    '',
    'Recommended plan:',
    ...plan.recommendedCommands.map((command, index) => `${index + 1}. ${command}`),
    '',
    `Final verdict: ${plan.finalVerdict}`,
    'Note: this is not release readiness. Run npm run release:ready before release.',
    '',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): { goal: VerificationGoal; run: boolean } {
  let goal: VerificationGoal = 'pr';
  let run = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--run') {
      run = true;
    } else if (arg === '--goal' && next) {
      goal = normalizeGoal(next);
      index += 1;
    } else if (arg.startsWith('--goal=')) {
      goal = normalizeGoal(arg.slice('--goal='.length));
    } else if (arg === '--dry-run') {
      run = false;
    } else {
      throw new Error(`Unknown verify argument: ${arg}`);
    }
  }

  return { goal, run };
}

function npmScriptFromCommand(command: string): string {
  return command.replace(/^npm run /, '');
}

export function runVerificationCli(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const options = parseArgs(argv);
    const plan = buildVerificationPlan(options);
    process.stdout.write(renderVerificationPlan(plan));

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
