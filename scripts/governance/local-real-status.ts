import { resolveMinimalLeaseStatusShadow } from './lease-status-shadow';
import { buildStatusProjection, renderStatusProjection } from './status-projection';
import {
  defaultResourceOwnerPreflightEvidencePath,
  renderResourceOwnerPreflightSummary,
  runResourceOwnerPreflight,
  type ResourceOwnerPreflightResult,
} from './resource-owner-preflight';

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
  ownerPreflight?: (evidencePath: string) => ResourceOwnerPreflightResult;
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
    const ownerPreflight = dependencies.ownerPreflight ?? defaultOwnerPreflight;
    const projection = buildStatusProjection({
      goal: 'local-real',
      runtimeLine: 'local-manual',
      generatedAt: dependencies.generatedAt,
      leaseStatusShadow: resolveMinimalLeaseStatusShadow({
        generatedAt: dependencies.generatedAt,
      }),
    });
    if (options.json) {
      dependencies.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
      return 0;
    }

    dependencies.stdout.write('Diagnostic only: not a product readiness conclusion.\n');
    dependencies.stdout.write(renderStatusProjection(projection));
    const evidencePath = defaultResourceOwnerPreflightEvidencePath({ target: 'local-real-status' });
    const preflight = ownerPreflight(evidencePath);
    if (preflight.ok) {
      dependencies.stdout.write('Resource owner preflight: fixed-local-ports clear\n');
    } else {
      dependencies.stdout.write(renderResourceOwnerPreflightSummary(preflight, {
        diagnosticOnly: true,
      }));
    }
    return 0;
  } catch {
    dependencies.stderr.write('[local-real-status] status unavailable; check arguments.\n');
    return 1;
  }
}

function defaultOwnerPreflight(evidencePath: string): ResourceOwnerPreflightResult {
  return runResourceOwnerPreflight({
    target: 'local-real-status',
    evidencePath,
  });
}

if (isCliEntrypoint('local-real-status.ts')) {
  process.exit(runLocalRealStatusProjection());
}
