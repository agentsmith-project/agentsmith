import { readFile } from 'node:fs/promises';

import {
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_STATUSES,
  type CurrentGateResultFailureClass,
  type CurrentGateResultStatus,
} from './current-gate-result-schema';
import {
  writePureCheckProducerEvidence,
  type PureCheckProducerArtifactScope,
  type PureCheckProducerEvidenceValidationFailure,
  type PureCheckProducerRequiredArtifactInput,
} from './pure-check-producer-evidence';

type CliWriteStream = {
  write(chunk: string): unknown;
};

type ParsedCliArgs = {
  repoRoot?: string;
  reportRoot?: string;
  checkId?: string;
  status?: string;
  failureClass?: string;
  exitCode?: string;
  startedAt?: string;
  finishedAt?: string;
  stdoutSummaryFile?: string;
  stderrSummaryFile?: string;
  requiredArtifacts: PureCheckProducerRequiredArtifactInput[];
};

type WritePureCheckProducerEvidenceCliDependencies = {
  stdout?: CliWriteStream;
  stderr?: CliWriteStream;
};

const ARTIFACT_SCOPES = ['repo_root', 'report_root', 'evidence_dir'] as const satisfies readonly PureCheckProducerArtifactScope[];
const STATUS_SET = new Set<string>(CURRENT_GATE_RESULT_STATUSES);
const FAILURE_CLASS_SET = new Set<string>(CURRENT_GATE_RESULT_FAILURE_CLASSES);
const ARTIFACT_SCOPE_SET = new Set<string>(ARTIFACT_SCOPES);

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function parseOptionValue(argv: readonly string[], index: number): {
  value: string;
  nextIndex: number;
} {
  const arg = argv[index] ?? '';
  const equalsIndex = arg.indexOf('=');
  if (equalsIndex >= 0) {
    return {
      value: arg.slice(equalsIndex + 1),
      nextIndex: index,
    };
  }

  const next = argv[index + 1];
  if (typeof next !== 'string') {
    throw new Error(`Missing value for ${arg}.`);
  }

  return {
    value: next,
    nextIndex: index + 1,
  };
}

function optionName(arg: string): string {
  const equalsIndex = arg.indexOf('=');
  return equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
}

function parseRequiredArtifact(value: string): PureCheckProducerRequiredArtifactInput {
  const [scope, path, id, ...extra] = value.split(':');
  if (!scope || !path || !id || extra.length > 0) {
    throw new Error(`Invalid --required-artifact value: ${value}. Expected scope:path:id.`);
  }
  if (!ARTIFACT_SCOPE_SET.has(scope)) {
    throw new Error(`Invalid required artifact scope: ${scope}.`);
  }

  return {
    scope: scope as PureCheckProducerArtifactScope,
    path,
    id,
  };
}

function parseArgs(argv: readonly string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = {
    requiredArtifacts: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith('--')) {
      throw new Error(`Unknown positional argument: ${String(arg)}.`);
    }

    const name = optionName(arg);
    const { value, nextIndex } = parseOptionValue(argv, index);
    index = nextIndex;

    if (name === '--repo-root') {
      parsed.repoRoot = value;
    } else if (name === '--report-root') {
      parsed.reportRoot = value;
    } else if (name === '--check-id') {
      parsed.checkId = value;
    } else if (name === '--status') {
      parsed.status = value;
    } else if (name === '--failure-class') {
      parsed.failureClass = value;
    } else if (name === '--exit-code') {
      parsed.exitCode = value;
    } else if (name === '--started-at') {
      parsed.startedAt = value;
    } else if (name === '--finished-at') {
      parsed.finishedAt = value;
    } else if (name === '--stdout-summary-file') {
      parsed.stdoutSummaryFile = value;
    } else if (name === '--stderr-summary-file') {
      parsed.stderrSummaryFile = value;
    } else if (name === '--required-artifact') {
      parsed.requiredArtifacts.push(parseRequiredArtifact(value));
    } else {
      throw new Error(`Unknown option: ${name}.`);
    }
  }

  return parsed;
}

function requireNonEmpty(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required option ${name}.`);
  }
  return value;
}

function parseStatus(value: string): CurrentGateResultStatus {
  if (!STATUS_SET.has(value)) {
    throw new Error(`Invalid --status: ${value}.`);
  }
  return value as CurrentGateResultStatus;
}

function parseFailureClass(value: string): CurrentGateResultFailureClass {
  if (!FAILURE_CLASS_SET.has(value)) {
    throw new Error(`Invalid --failure-class: ${value}.`);
  }
  return value as CurrentGateResultFailureClass;
}

function parseExitCode(value: string): number | null {
  if (value === 'null') {
    return null;
  }

  const exitCode = Number(value);
  if (!Number.isInteger(exitCode)) {
    throw new Error(`Invalid --exit-code: ${value}.`);
  }
  return exitCode;
}

async function readSummaryFile(path: string | undefined): Promise<string | null> {
  if (!path) {
    return null;
  }
  return readFile(path, 'utf8');
}

function renderFailures(failures: readonly PureCheckProducerEvidenceValidationFailure[]): string {
  return failures
    .map((failure) => `${failure.code} ${failure.path}: ${failure.message}`)
    .join('\n');
}

export async function runWritePureCheckProducerEvidenceCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: WritePureCheckProducerEvidenceCliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;

  try {
    const args = parseArgs(argv);
    const reportRoot = requireNonEmpty(args.reportRoot, '--report-root');
    const checkId = requireNonEmpty(args.checkId, '--check-id');
    const resultStatus = parseStatus(requireNonEmpty(args.status, '--status'));
    const failureClass = parseFailureClass(requireNonEmpty(args.failureClass, '--failure-class'));
    const exitCode = parseExitCode(requireNonEmpty(args.exitCode, '--exit-code'));
    const startedAt = requireNonEmpty(args.startedAt, '--started-at');
    const finishedAt = requireNonEmpty(args.finishedAt, '--finished-at');
    const [stdoutSummary, stderrSummary] = await Promise.all([
      readSummaryFile(args.stdoutSummaryFile),
      readSummaryFile(args.stderrSummaryFile),
    ]);

    const result = await writePureCheckProducerEvidence({
      repoRoot: args.repoRoot,
      reportRoot,
      checkId,
      resultStatus,
      failureClass,
      exitCode,
      startedAt,
      finishedAt,
      stdoutSummary,
      stderrSummary,
      requiredArtifacts: args.requiredArtifacts,
    });

    if (!result.ok) {
      stderr.write(`[pure-check-producer-evidence] write failed:\n${renderFailures(result.failures)}\n`);
      return 1;
    }

    stdout.write(`${result.path}\n`);
    return 0;
  } catch (error) {
    stderr.write(`[pure-check-producer-evidence] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isCliEntrypoint('write-pure-check-producer-evidence.ts')) {
  void runWritePureCheckProducerEvidenceCli().then((exitCode) => {
    process.exit(exitCode);
  });
}
