import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseRunnerImageLockText,
  validateRunnerReleaseManifest,
  type CurrentReleaseBoundaryValidationFailure,
  type CurrentRunnerImageLock,
  type CurrentRunnerReleaseManifest,
} from '../governance/current-release-boundary-schema';

export type RunnerImageLockFailure = {
  field: string;
  message: string;
};

export type RunnerImageLockCheckResult = {
  ok: boolean;
  failures: RunnerImageLockFailure[];
};

export type RunnerImageLockCheckOptions = {
  lockPath?: string;
  manifestPath?: string;
  requireManifest?: boolean;
};

type CliOptions = {
  lockPath?: string;
  manifestPath?: string;
  adoption: boolean;
  help: boolean;
  failures: RunnerImageLockFailure[];
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_LOCK_PATH = resolve(
  REPO_ROOT,
  'scripts/governance/__fixtures__/release-boundary/agentsmith-runner-image.lock',
);
const RUNNER_RELEASE_MANIFEST_ENV = 'RUNNER_RELEASE_MANIFEST';

function addFailure(failures: RunnerImageLockFailure[], field: string, message: string): void {
  failures.push({ field, message });
}

function pushValidationFailures(
  failures: RunnerImageLockFailure[],
  prefix: string,
  validationFailures: readonly CurrentReleaseBoundaryValidationFailure[],
): void {
  for (const failure of validationFailures) {
    addFailure(failures, `${prefix}.${failure.path}`, failure.reason);
  }
}

function readTextFile(path: string, field: string, failures: RunnerImageLockFailure[]): string | null {
  if (!existsSync(path)) {
    addFailure(failures, field, `file does not exist: ${path}`);
    return null;
  }

  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    addFailure(failures, field, `failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function parseJson(source: string, sourceName: string, failures: RunnerImageLockFailure[]): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    addFailure(
      failures,
      'manifest',
      `failed to parse ${sourceName} as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function expectedActualMessage(expected: string, actual: string): string {
  return `expected ${expected}; actual ${actual}`;
}

function compareString(
  failures: RunnerImageLockFailure[],
  field: string,
  expected: string,
  actual: string,
  message: string,
): void {
  if (expected !== actual) {
    addFailure(failures, field, `${message}; ${expectedActualMessage(expected, actual)}`);
  }
}

function compareLockToManifest(
  lock: CurrentRunnerImageLock,
  manifest: CurrentRunnerReleaseManifest,
  failures: RunnerImageLockFailure[],
): void {
  const manifestProtocol = manifest.supported_protocol_versions[0] ?? '';

  compareString(
    failures,
    'adoption.release_id',
    manifest.release_id,
    lock.release_id,
    'lock release_id must match runner release manifest release_id',
  );
  compareString(
    failures,
    'adoption.git_sha',
    manifest.git_sha,
    lock.git_sha,
    'lock git_sha must match runner release manifest git_sha',
  );
  compareString(
    failures,
    'adoption.runner_contract_version',
    manifest.runner_contract_version,
    lock.runner_contract_version,
    'lock runner_contract_version must match runner release manifest runner_contract_version',
  );
  compareString(
    failures,
    'adoption.runner_protocol_version',
    manifestProtocol,
    lock.runner_protocol_version,
    'lock runner_protocol_version must match runner release manifest supported protocol',
  );
  compareString(
    failures,
    'adoption.image.id',
    manifest.image.id,
    lock.image.id,
    'lock image id must match runner release manifest image id',
  );
  compareString(
    failures,
    'adoption.image.image',
    manifest.image.image,
    lock.image.image,
    'lock image ref must match runner release manifest image ref',
  );
  compareString(
    failures,
    'adoption.image.digest',
    manifest.image.digest,
    lock.image.digest,
    'lock image digest must match runner release manifest image digest',
  );
  compareString(
    failures,
    'adoption.manifest.producer_repo',
    manifest.artifact_provenance.producer_repo,
    lock.manifest.producer_repo,
    'lock manifest producer_repo must match runner release manifest producer_repo',
  );
  compareString(
    failures,
    'adoption.manifest.subject_sha256',
    manifest.artifact_provenance.subject_sha256,
    lock.manifest.subject_sha256,
    'lock manifest subject_sha256 must match runner release manifest subject_sha256',
  );
  compareString(
    failures,
    'adoption.manifest.artifact_sha256',
    manifest.artifact_provenance.artifact_sha256,
    lock.manifest.artifact_sha256,
    'lock manifest artifact_sha256 must match runner release manifest artifact_sha256',
  );
}

export function checkRunnerImageLock(
  options: RunnerImageLockCheckOptions = {},
): RunnerImageLockCheckResult {
  const failures: RunnerImageLockFailure[] = [];
  const lockPath = resolve(options.lockPath ?? DEFAULT_LOCK_PATH);
  const lockSource = readTextFile(lockPath, 'lock.path', failures);

  let lock: CurrentRunnerImageLock | null = null;
  if (lockSource !== null) {
    const lockResult = parseRunnerImageLockText(lockSource, lockPath);
    if (lockResult.ok) {
      lock = lockResult.value;
    } else {
      pushValidationFailures(failures, 'lock', lockResult.failures);
    }
  }

  if (!options.manifestPath) {
    if (options.requireManifest) {
      addFailure(
        failures,
        'cli.manifest',
        `missing required --manifest <path> or ${RUNNER_RELEASE_MANIFEST_ENV}=<path>`,
      );
    }
    return { ok: failures.length === 0, failures };
  }

  const manifestPath = resolve(options.manifestPath);
  const manifestSource = readTextFile(manifestPath, 'manifest.path', failures);
  let manifest: CurrentRunnerReleaseManifest | null = null;
  if (manifestSource !== null) {
    const parsedManifest = parseJson(manifestSource, manifestPath, failures);
    const manifestResult = validateRunnerReleaseManifest(parsedManifest);
    if (manifestResult.ok) {
      manifest = manifestResult.value;
    } else {
      pushValidationFailures(failures, 'manifest', manifestResult.failures);
    }
  }

  if (lock && manifest) {
    compareLockToManifest(lock, manifest, failures);
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

export function formatRunnerImageLockFailures(failures: readonly RunnerImageLockFailure[]): string {
  return failures.map((failure) => `${failure.field}: ${failure.message}`).join('\n');
}

function usage(): string {
  return [
    'Usage: npm run contracts:check-runner-image-lock -- [--lock <path>]',
    '       npm run contracts:check-runner-image-lock -- --adoption --manifest <path> [--lock <path>]',
    `       RUNNER_RELEASE_MANIFEST=<path> npm run contracts:check-runner-image-lock -- --adoption`,
    '',
    `Default --lock: ${DEFAULT_LOCK_PATH}`,
  ].join('\n');
}

function parseCliArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    adoption: false,
    help: false,
    failures: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--adoption') {
      options.adoption = true;
      continue;
    }

    if (arg === '--manifest') {
      const value = args[index + 1];
      if (!value) {
        addFailure(options.failures, 'cli.manifest', 'missing value for --manifest <path>');
        continue;
      }
      options.manifestPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--manifest=')) {
      const value = arg.slice('--manifest='.length);
      if (!value) {
        addFailure(options.failures, 'cli.manifest', 'missing value for --manifest <path>');
        continue;
      }
      options.manifestPath = value;
      continue;
    }

    if (arg === '--lock') {
      const value = args[index + 1];
      if (!value) {
        addFailure(options.failures, 'cli.lock', 'missing value for --lock <path>');
        continue;
      }
      options.lockPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--lock=')) {
      const value = arg.slice('--lock='.length);
      if (!value) {
        addFailure(options.failures, 'cli.lock', 'missing value for --lock <path>');
        continue;
      }
      options.lockPath = value;
      continue;
    }

    addFailure(options.failures, 'cli.arguments', `unknown argument ${arg}`);
  }

  if (!options.manifestPath && options.adoption && !options.help) {
    const envManifestPath = process.env[RUNNER_RELEASE_MANIFEST_ENV]?.trim();
    if (envManifestPath) {
      options.manifestPath = envManifestPath;
    }
  }

  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cliOptions = parseCliArgs(process.argv.slice(2));

  if (cliOptions.help) {
    process.stdout.write(`${usage()}\n`);
  } else if (cliOptions.failures.length > 0) {
    process.stderr.write(`[contracts] runner image lock check failed\n${formatRunnerImageLockFailures(cliOptions.failures)}\n`);
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
  } else {
    const result = checkRunnerImageLock({
      lockPath: cliOptions.lockPath,
      manifestPath: cliOptions.manifestPath,
      requireManifest: cliOptions.adoption,
    });

    if (!result.ok) {
      process.stderr.write(`[contracts] runner image lock check failed\n${formatRunnerImageLockFailures(result.failures)}\n`);
      if (result.failures.some((failure) => failure.field === 'cli.manifest')) {
        process.stderr.write(`${usage()}\n`);
      }
      process.exitCode = 1;
    } else {
      process.stdout.write('[contracts] runner image lock check passed\n');
    }
  }
}
