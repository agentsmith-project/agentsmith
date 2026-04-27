import { buildStatusProjection, renderStatusProjection } from './status-projection';

type LocalRealStatusStreams = {
  stdout: {
    write(chunk: string): unknown;
  };
  stderr: {
    write(chunk: string): unknown;
  };
};

type LocalRealStatusDependencies = LocalRealStatusStreams & {
  generatedAt?: string;
};

type ParsedLocalRealStatusArgs = {
  json: boolean;
};

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function parseArgs(argv: readonly string[]): ParsedLocalRealStatusArgs {
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') {
      json = true;
    } else {
      throw new Error('Unknown local-real status argument.');
    }
  }
  return { json };
}

export function runLocalRealStatusProjection(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: LocalRealStatusDependencies = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): number {
  try {
    const options = parseArgs(argv);
    const projection = buildStatusProjection({
      goal: 'local-real',
      runtimeLine: 'local-manual',
      generatedAt: dependencies.generatedAt,
    });
    dependencies.stdout.write(options.json
      ? `${JSON.stringify(projection, null, 2)}\n`
      : renderStatusProjection(projection));
    return 0;
  } catch {
    dependencies.stderr.write('[local-real-status] status unavailable; check arguments.\n');
    return 1;
  }
}

if (isCliEntrypoint('local-real-status.ts')) {
  process.exit(runLocalRealStatusProjection());
}
