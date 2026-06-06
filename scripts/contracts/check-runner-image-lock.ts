import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseRunnerImageLockText,
  sha256Digest,
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
  handoffReportPath?: string;
  requireHandoffReport?: boolean;
};

type CliOptions = {
  lockPath?: string;
  manifestPath?: string;
  handoffReportPath?: string;
  adoption: boolean;
  help: boolean;
  failures: RunnerImageLockFailure[];
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_LOCK_PATH = resolve(
  REPO_ROOT,
  'release/agentsmith-runner-image.lock',
);
const RUNNER_RELEASE_MANIFEST_ENV = 'RUNNER_RELEASE_MANIFEST';
const RUNNER_GA_HANDOFF_REPORT_ENV = 'RUNNER_GA_HANDOFF_REPORT';
const RUNNER_GA_HANDOFF_REPORT_SCHEMA_VERSION = 'agentsmith.runner-ga-handoff-report/v1';
const RUNNER_GA_HANDOFF_SCOPE = 'runner_ga_handoff_evidence';
const RUNNER_GA_HANDOFF_REQUIRED_CHECKS = [
  'runner_release_manifest',
  'digest_pinned_runner_image',
  'contract_artifact_binding',
  'adoption_policy_declared',
] as const;

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

function parseJson(source: string, sourceName: string, field: string, failures: RunnerImageLockFailure[]): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    addFailure(
      failures,
      field,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNestedValue(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function readNestedString(value: unknown, path: readonly string[]): string {
  const nested = readNestedValue(value, path);
  return typeof nested === 'string' ? nested : '';
}

function compareReportString(
  failures: RunnerImageLockFailure[],
  report: Record<string, unknown>,
  path: readonly string[],
  expected: string,
  message: string,
): void {
  const actual = readNestedString(report, path);
  compareString(failures, `handoff.${path.join('.')}`, expected, actual, message);
}

function compareReportProtocolVersions(
  failures: RunnerImageLockFailure[],
  report: Record<string, unknown>,
  expected: readonly string[],
): void {
  const value = report.supported_protocol_versions;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    addFailure(failures, 'handoff.supported_protocol_versions', 'must be an array of strings');
    return;
  }

  const actual = value.join(',');
  const expectedValue = expected.join(',');
  compareString(
    failures,
    'handoff.supported_protocol_versions',
    expectedValue,
    actual,
    'handoff supported_protocol_versions must match runner release manifest supported_protocol_versions',
  );
}

function validateHandoffChecks(
  failures: RunnerImageLockFailure[],
  report: Record<string, unknown>,
): void {
  const checks = report.checks;
  if (!Array.isArray(checks)) {
    addFailure(failures, 'handoff.checks', 'must be an array');
    return;
  }

  const seenChecks = new Set<string>();
  checks.forEach((check, index) => {
    if (!isRecord(check)) {
      addFailure(failures, `handoff.checks[${index}]`, 'must be an object');
      return;
    }

    const name = typeof check.name === 'string' ? check.name : '';
    const status = typeof check.status === 'string' ? check.status : '';
    if (name) {
      seenChecks.add(name);
    }
    if (status !== 'pass') {
      addFailure(
        failures,
        `handoff.checks[${index}].status`,
        `expected pass; actual ${status || '<missing>'}`,
      );
    }
  });

  for (const requiredCheck of RUNNER_GA_HANDOFF_REQUIRED_CHECKS) {
    if (!seenChecks.has(requiredCheck)) {
      addFailure(failures, 'handoff.checks', `missing ${requiredCheck}`);
    }
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

function compareLockAndManifestToHandoffReport(
  lock: CurrentRunnerImageLock,
  manifest: CurrentRunnerReleaseManifest,
  manifestSource: string,
  report: Record<string, unknown>,
  reportSource: string,
  failures: RunnerImageLockFailure[],
): void {
  const manifestRunId = manifest.artifact_provenance.run_id ?? '';
  const expectedReportArtifactUri =
    `gh-artifact://agentsmith-project/agentsmith-runner/runner-ga-handoff/${manifestRunId}/runner-ga-handoff-report.json`;
  const expectedManifestInputSha256 = sha256Digest(manifestSource);
  const reportSha256 = sha256Digest(reportSource);

  compareReportString(
    failures,
    report,
    ['schema_version'],
    RUNNER_GA_HANDOFF_REPORT_SCHEMA_VERSION,
    'handoff schema_version must match the runner GA handoff report schema',
  );
  compareReportString(
    failures,
    report,
    ['scope'],
    RUNNER_GA_HANDOFF_SCOPE,
    'handoff scope must be runner GA handoff evidence',
  );
  compareReportString(failures, report, ['status'], 'pass', 'handoff status must be pass');
  if (Object.hasOwn(report, 'formal_verdict')) {
    addFailure(failures, 'handoff.formal_verdict', 'runner GA handoff must not issue a formal verdict');
  }
  compareReportString(failures, report, ['runner'], manifest.runner, 'handoff runner must match runner release manifest');
  compareReportString(
    failures,
    report,
    ['release_id'],
    manifest.release_id,
    'handoff release_id must match runner release manifest release_id',
  );
  compareReportString(
    failures,
    report,
    ['git_sha'],
    manifest.git_sha,
    'handoff git_sha must match runner release manifest git_sha',
  );
  compareReportString(
    failures,
    report,
    ['runner_contract_version'],
    manifest.runner_contract_version,
    'handoff runner_contract_version must match runner release manifest runner_contract_version',
  );
  compareReportProtocolVersions(failures, report, manifest.supported_protocol_versions);
  compareReportString(failures, report, ['image', 'id'], manifest.image.id, 'handoff image id must match runner release manifest image id');
  compareReportString(
    failures,
    report,
    ['image', 'image'],
    manifest.image.image,
    'handoff image ref must match runner release manifest image ref',
  );
  compareReportString(
    failures,
    report,
    ['image', 'digest'],
    manifest.image.digest,
    'handoff image digest must match runner release manifest image digest',
  );
  compareReportString(
    failures,
    report,
    ['contract_artifact', 'package_uri'],
    manifest.contract_artifact.package_uri,
    'handoff contract package_uri must match runner release manifest contract_artifact.package_uri',
  );
  compareReportString(
    failures,
    report,
    ['contract_artifact', 'package_sha256'],
    manifest.contract_artifact.package_sha256,
    'handoff contract package_sha256 must match runner release manifest contract_artifact.package_sha256',
  );
  compareReportString(
    failures,
    report,
    ['contract_artifact', 'descriptor_subject_sha256'],
    manifest.contract_artifact.descriptor_subject_sha256,
    'handoff contract descriptor_subject_sha256 must match runner release manifest contract_artifact.descriptor_subject_sha256',
  );
  compareReportString(
    failures,
    report,
    ['manifest', 'input_sha256'],
    expectedManifestInputSha256,
    'handoff manifest input_sha256 must match the raw runner release manifest digest',
  );
  compareReportString(
    failures,
    report,
    ['manifest', 'input_sha256'],
    lock.handoff.manifest_input_sha256,
    'handoff manifest input_sha256 must match runner image lock handoff manifest_input_sha256',
  );
  compareReportString(
    failures,
    report,
    ['manifest', 'artifact_uri'],
    manifest.artifact_provenance.artifact_uri,
    'handoff manifest artifact_uri must match runner release manifest artifact URI',
  );
  compareReportString(
    failures,
    report,
    ['manifest', 'subject_sha256'],
    manifest.artifact_provenance.subject_sha256,
    'handoff manifest subject_sha256 must match runner release manifest subject_sha256',
  );
  compareReportString(
    failures,
    report,
    ['manifest', 'artifact_sha256'],
    manifest.artifact_provenance.artifact_sha256,
    'handoff manifest artifact_sha256 must match runner release manifest artifact_sha256',
  );
  compareReportString(
    failures,
    report,
    ['provenance', 'producer_repo'],
    manifest.artifact_provenance.producer_repo,
    'handoff provenance producer_repo must match runner release manifest producer_repo',
  );
  compareReportString(
    failures,
    report,
    ['provenance', 'normalized_remote'],
    manifest.artifact_provenance.normalized_remote,
    'handoff provenance normalized_remote must match runner release manifest normalized_remote',
  );
  compareReportString(
    failures,
    report,
    ['provenance', 'workflow_name'],
    manifest.artifact_provenance.workflow_name ?? '',
    'handoff provenance workflow_name must match runner release manifest workflow_name',
  );
  compareReportString(
    failures,
    report,
    ['provenance', 'job'],
    manifest.artifact_provenance.job ?? '',
    'handoff provenance job must match runner release manifest job',
  );
  compareReportString(
    failures,
    report,
    ['provenance', 'run_id'],
    manifestRunId,
    'handoff provenance run_id must match runner release manifest run_id',
  );
  compareReportString(
    failures,
    report,
    ['provenance', 'run_attempt'],
    manifest.artifact_provenance.run_attempt ?? '',
    'handoff provenance run_attempt must match runner release manifest run_attempt',
  );
  compareReportString(
    failures,
    report,
    ['provenance', 'commit_sha'],
    manifest.artifact_provenance.commit_sha,
    'handoff provenance commit_sha must match runner release manifest commit_sha',
  );
  compareString(
    failures,
    'adoption.handoff.report_artifact_uri',
    expectedReportArtifactUri,
    lock.handoff.report_artifact_uri,
    'lock handoff report artifact URI must match the runner release manifest run id',
  );
  compareString(
    failures,
    'adoption.handoff.report_sha256',
    lock.handoff.report_sha256,
    reportSha256,
    'lock handoff report_sha256 must match the provided runner GA handoff report digest',
  );
  validateHandoffChecks(failures, report);
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
  }

  if (!options.handoffReportPath && options.requireHandoffReport) {
    addFailure(
      failures,
      'cli.handoff_report',
      `missing required --handoff-report <path> or ${RUNNER_GA_HANDOFF_REPORT_ENV}=<path>`,
    );
  }

  if (!options.manifestPath && !options.handoffReportPath) {
    return { ok: failures.length === 0, failures };
  }

  const manifestPath = options.manifestPath ? resolve(options.manifestPath) : null;
  const manifestSource = manifestPath ? readTextFile(manifestPath, 'manifest.path', failures) : null;
  let manifest: CurrentRunnerReleaseManifest | null = null;
  if (manifestSource !== null) {
    const parsedManifest = parseJson(manifestSource, manifestPath ?? 'runner release manifest', 'manifest', failures);
    const manifestResult = validateRunnerReleaseManifest(parsedManifest);
    if (manifestResult.ok) {
      manifest = manifestResult.value;
    } else {
      pushValidationFailures(failures, 'manifest', manifestResult.failures);
    }
  }

  const handoffReportPath = options.handoffReportPath ? resolve(options.handoffReportPath) : null;
  const handoffReportSource = handoffReportPath ? readTextFile(handoffReportPath, 'handoff_report.path', failures) : null;
  let handoffReport: Record<string, unknown> | null = null;
  if (handoffReportSource !== null) {
    const parsedHandoffReport = parseJson(
      handoffReportSource,
      handoffReportPath ?? 'runner GA handoff report',
      'handoff_report',
      failures,
    );
    if (isRecord(parsedHandoffReport)) {
      handoffReport = parsedHandoffReport;
    } else {
      addFailure(failures, 'handoff_report', 'runner GA handoff report must be a JSON object');
    }
  }

  if (lock && manifest) {
    compareLockToManifest(lock, manifest, failures);
  }
  if (lock && manifest && manifestSource !== null && handoffReport && handoffReportSource !== null) {
    compareLockAndManifestToHandoffReport(lock, manifest, manifestSource, handoffReport, handoffReportSource, failures);
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
    '       npm run contracts:check-runner-image-lock -- --adoption --manifest <path> --handoff-report <path> [--lock <path>]',
    `       RUNNER_RELEASE_MANIFEST=<path> ${RUNNER_GA_HANDOFF_REPORT_ENV}=<path> npm run contracts:check-runner-image-lock -- --adoption`,
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

    if (arg === '--handoff-report') {
      const value = args[index + 1];
      if (!value) {
        addFailure(options.failures, 'cli.handoff_report', 'missing value for --handoff-report <path>');
        continue;
      }
      options.handoffReportPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--handoff-report=')) {
      const value = arg.slice('--handoff-report='.length);
      if (!value) {
        addFailure(options.failures, 'cli.handoff_report', 'missing value for --handoff-report <path>');
        continue;
      }
      options.handoffReportPath = value;
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
  if (!options.handoffReportPath && options.adoption && !options.help) {
    const envHandoffReportPath = process.env[RUNNER_GA_HANDOFF_REPORT_ENV]?.trim();
    if (envHandoffReportPath) {
      options.handoffReportPath = envHandoffReportPath;
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
      handoffReportPath: cliOptions.handoffReportPath,
      requireHandoffReport: cliOptions.adoption,
    });

    if (!result.ok) {
      process.stderr.write(`[contracts] runner image lock check failed\n${formatRunnerImageLockFailures(result.failures)}\n`);
      if (result.failures.some((failure) => failure.field === 'cli.manifest' || failure.field === 'cli.handoff_report')) {
        process.stderr.write(`${usage()}\n`);
      }
      process.exitCode = 1;
    } else {
      process.stdout.write('[contracts] runner image lock check passed\n');
    }
  }
}
