import { spawnSync } from 'node:child_process';

import {
  type CurrentStatusProjectionGoal,
} from './current-status-projection-schema';
import { buildStatusProjection, renderStatusProjection } from './status-projection';
import {
  buildSentinelPreflightEnv,
  renderSentinelPreflightOutput,
  runSentinelPreflightSync,
  type SentinelPreflightResult,
  type SentinelProfile,
} from './sentinel-preflight';

type RehearsalLine = 'demo-rehearsal' | 'cluster-rehearsal';

type RehearsalEntrypointStreams = {
  stdout: {
    write(chunk: string): unknown;
  };
  stderr: {
    write(chunk: string): unknown;
  };
};

type DelegateResult = {
  status: number | null;
};

type RehearsalEntrypointDependencies = RehearsalEntrypointStreams & {
  delegate?: (command: string, args: string[]) => DelegateResult;
  sentinelRunner?: (profile: Extract<SentinelProfile, RehearsalLine>) => SentinelPreflightResult;
  gateResultsRoot?: string;
  generatedAt?: string;
};

type ParsedRehearsalArgs = {
  line: RehearsalLine;
  status: boolean;
  json: boolean;
};

const REHEARSAL_CONFIG: Record<RehearsalLine, {
  goal: Extract<CurrentStatusProjectionGoal, 'demo-rehearsal' | 'cluster-rehearsal'>;
  runtimeLine: RehearsalLine;
  laneScript: string;
}> = {
  'demo-rehearsal': {
    goal: 'demo-rehearsal',
    runtimeLine: 'demo-rehearsal',
    laneScript: 'lane:demo-rehearsal',
  },
  'cluster-rehearsal': {
    goal: 'cluster-rehearsal',
    runtimeLine: 'cluster-rehearsal',
    laneScript: 'lane:cluster-rehearsal',
  },
};

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function isRehearsalLine(value: string | undefined): value is RehearsalLine {
  return value === 'demo-rehearsal' || value === 'cluster-rehearsal';
}

function parseArgs(argv: readonly string[]): ParsedRehearsalArgs {
  const [lineArg, ...rest] = argv;
  if (!isRehearsalLine(lineArg)) {
    throw new Error('rehearsal entrypoint requires demo-rehearsal or cluster-rehearsal.');
  }

  let status = false;
  let json = false;
  for (const arg of rest) {
    if (arg === '--status') {
      status = true;
    } else if (arg === '--json') {
      json = true;
    } else {
      throw new Error('Unknown rehearsal argument.');
    }
  }

  if (json && !status) {
    throw new Error('--json is only supported with --status.');
  }

  return {
    line: lineArg,
    status,
    json,
  };
}

function defaultDelegate(command: string, args: string[]): DelegateResult {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
}

function defaultSentinelRunner(profile: Extract<SentinelProfile, RehearsalLine>): SentinelPreflightResult {
  return runSentinelPreflightSync({
    profile,
    env: buildSentinelPreflightEnv({ profile }),
  });
}

export function runRehearsalEntrypoint(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: RehearsalEntrypointDependencies = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): number {
  try {
    const options = parseArgs(argv);
    const config = REHEARSAL_CONFIG[options.line];

    if (options.status) {
      const projection = buildStatusProjection({
        goal: config.goal,
        runtimeLine: config.runtimeLine,
        gateResultsRoot: dependencies.gateResultsRoot,
        generatedAt: dependencies.generatedAt,
      });
      dependencies.stdout.write(options.json
        ? `${JSON.stringify(projection, null, 2)}\n`
        : renderStatusProjection(projection));
      return 0;
    }

    const sentinelRunner = dependencies.sentinelRunner ?? defaultSentinelRunner;
    let sentinelResult: SentinelPreflightResult;
    try {
      sentinelResult = sentinelRunner(options.line);
    } catch {
      dependencies.stderr.write(`[rehearsal-entrypoint] sentinel preflight unavailable for ${options.line}.\n`);
      return 1;
    }
    if (sentinelResult.exitCode !== 0) {
      dependencies.stdout.write(renderSentinelPreflightOutput(sentinelResult.output));
      dependencies.stderr.write(`[rehearsal-entrypoint] sentinel preflight failed for ${options.line}.\n`);
      return 1;
    }

    const delegate = dependencies.delegate ?? defaultDelegate;
    const result = delegate('npm', ['run', config.laneScript]);
    return typeof result.status === 'number' ? result.status : 1;
  } catch {
    dependencies.stderr.write('[rehearsal-entrypoint] command unavailable; check arguments.\n');
    return 1;
  }
}

if (isCliEntrypoint('rehearsal-entrypoint.ts')) {
  process.exit(runRehearsalEntrypoint());
}
