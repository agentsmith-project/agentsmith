import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  validateUxTraceBundleArtifact,
  type UxTraceBundleValidationFailureClass,
} from '../e2e/trace-bundle-support';

type CliOptions = {
  root?: string;
  expectedLane?: string;
  expectedSuite?: string;
  minCount: number;
  reportPath?: string;
  validPathsPath?: string;
};

type ValidationRecord = {
  bundle_dir: string;
  review_path: string;
  ok: boolean;
  story_id?: string;
  failure_class?: UxTraceBundleValidationFailureClass;
  message?: string;
};

type ValidationReport = {
  schema: 'ux_trace_bundle_validation/v1';
  root: string;
  expected_lane?: string;
  expected_suite?: string;
  min_count: number;
  review_count: number;
  valid_count: number;
  valid_bundle_paths: string[];
  records: ValidationRecord[];
};

function usage(): string {
  return [
    'Usage: tsx scripts/validate-ux-trace-bundles.ts --root <ux-traces-root> [options]',
    '',
    'Options:',
    '  --expected-lane <lane>    Require every bundle manifest to use this lane.',
    '  --expected-suite <suite>  Require every bundle manifest to use this suite.',
    '  --min-count <count>       Minimum semantically valid bundle count. Default: 1.',
    '  --report <path>           Write a JSON validation report.',
    '  --valid-paths <path>      Write valid bundle directories, one per line.',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    minCount: 1,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--root':
        options.root = next;
        index += 1;
        break;
      case '--expected-lane':
        options.expectedLane = next;
        index += 1;
        break;
      case '--expected-suite':
        options.expectedSuite = next;
        index += 1;
        break;
      case '--min-count': {
        const parsed = Number.parseInt(next ?? '', 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error('--min-count must be a positive integer.');
        }
        options.minCount = parsed;
        index += 1;
        break;
      }
      case '--report':
        options.reportPath = next;
        index += 1;
        break;
      case '--valid-paths':
        options.validPathsPath = next;
        index += 1;
        break;
      case '--help':
      case '-h':
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.root?.trim()) {
    throw new Error('--root is required.');
  }
  return options;
}

function readDirectoryEntries(path: string): readonly string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function listReviewFiles(root: string): readonly string[] {
  if (!existsSync(root)) {
    return [];
  }
  try {
    if (!statSync(root).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readDirectoryEntries(directory)) {
      const candidate = join(directory, entry);
      try {
        const stats = statSync(candidate);
        if (stats.isDirectory()) {
          visit(candidate);
          continue;
        }
        if (stats.isFile() && entry === 'review.md') {
          files.push(candidate);
        }
      } catch {
        // Unreadable evidence cannot count as valid release evidence.
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function writeTextFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function buildReport(options: CliOptions): ValidationReport {
  const root = resolve(options.root ?? '');
  const records = listReviewFiles(root).map((reviewPath): ValidationRecord => {
    const bundleDir = dirname(reviewPath);
    const validation = validateUxTraceBundleArtifact({
      bundleDir,
      expectedLane: options.expectedLane,
      expectedSuite: options.expectedSuite,
      expectedEvidenceRoot: root,
      expectedCampaignStepId: 'standalone-backend-real-full-gate',
    });
    if (validation.ok) {
      return {
        bundle_dir: bundleDir,
        review_path: reviewPath,
        ok: true,
        story_id: validation.manifest.story_id,
      };
    }
    return {
      bundle_dir: bundleDir,
      review_path: reviewPath,
      ok: false,
      failure_class: validation.failureClass,
      message: validation.message,
    };
  });
  const validBundlePaths = records
    .filter((record) => record.ok)
    .map((record) => record.bundle_dir);

  return {
    schema: 'ux_trace_bundle_validation/v1',
    root,
    expected_lane: options.expectedLane,
    expected_suite: options.expectedSuite,
    min_count: options.minCount,
    review_count: records.length,
    valid_count: validBundlePaths.length,
    valid_bundle_paths: validBundlePaths,
    records,
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);

  if (options.reportPath) {
    writeTextFile(resolve(options.reportPath), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.validPathsPath) {
    writeTextFile(resolve(options.validPathsPath), `${report.valid_bundle_paths.join('\n')}${report.valid_bundle_paths.length > 0 ? '\n' : ''}`);
  }

  if (report.review_count === 0) {
    process.stderr.write(`Missing UX trace review.md, manifest.json, and events.jsonl under ${report.root}.\n`);
  }
  for (const record of report.records) {
    if (!record.ok) {
      process.stderr.write(`${record.bundle_dir}: ${record.message ?? 'invalid UX trace bundle'}\n`);
    }
  }

  if (report.valid_count < report.min_count) {
    process.stderr.write(
      `Expected at least ${report.min_count} semantically valid UX trace bundle(s), found ${report.valid_count}.\n`,
    );
    process.exit(1);
  }

  for (const bundlePath of report.valid_bundle_paths) {
    process.stdout.write(`${bundlePath}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exit(1);
}
