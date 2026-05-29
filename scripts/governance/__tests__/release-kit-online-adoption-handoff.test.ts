import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  RELEASE_KIT_CANONICAL_REPO,
  canonicalReleaseBoundaryJson,
  sha256Digest,
} from '../current-release-boundary-schema';
import {
  RELEASE_KIT_ONLINE_ADOPTION_HANDOFF_SCHEMA_VERSION,
  runReleaseKitOnlineAdoptionHandoffCli,
  validateReleaseKitOnlineAdoptionHandoffFiles,
} from '../release-kit-online-adoption-handoff';

const FIXTURE_ROOT = resolve(process.cwd(), 'scripts/governance/__fixtures__/release-boundary');
const RELEASE_CONTRACT_FIXTURE = join(FIXTURE_ROOT, 'release-contract.valid.json');
const REPORT_ARTIFACT_SHA256 = `sha256:${'b'.repeat(64)}`;
const REPORT_SUBJECT_SHA256 = `sha256:${'c'.repeat(64)}`;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

type ValidationResult = ReturnType<typeof validateReleaseKitOnlineAdoptionHandoffFiles>;

interface FixturePaths {
  inputPath: string;
  releaseContractPath: string;
}

describe('release-kit online adoption handoff validator', () => {
  it('accepts a digest/provenance/link level handoff descriptor', () => {
    const fixture = writeFixture();
    const result = validateReleaseKitOnlineAdoptionHandoffFiles({
      inputPath: fixture.inputPath,
      releaseContractPath: fixture.releaseContractPath,
      expectReportDigest: REPORT_ARTIFACT_SHA256,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.schema_version).toBe(RELEASE_KIT_ONLINE_ADOPTION_HANDOFF_SCHEMA_VERSION);
    expect(result.value.provenance).toMatchObject({
      producer_repo: RELEASE_KIT_CANONICAL_REPO,
      normalized_remote: RELEASE_KIT_CANONICAL_REPO,
    });
    expect(result.value.coverage.strategies.map((strategy) => strategy.name)).toEqual([
      'use_existing',
      'install_substrates',
    ]);

    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(runReleaseKitOnlineAdoptionHandoffCli({
      argv: [
        '--input',
        fixture.inputPath,
        '--release-contract',
        fixture.releaseContractPath,
        '--expect-report-digest',
        REPORT_ARTIFACT_SHA256,
      ],
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    })).toBe(0);
    expect(stdout.join('\n')).toContain('release-kit online adoption handoff');
    expect(stderr).toEqual([]);
  });

  it('rejects the raw online-adoption-report.json shape', () => {
    expectInvalid(
      () => ({
        schema: 'release-kit.online-adoption-report/v1',
        scope: {},
        readiness: {},
        status: 'passed',
        online_paths: [],
        generated_at: '2026-05-29T12:00:00.000Z',
      }),
      'raw online-adoption-report.json is not accepted',
    );
  });

  it('rejects a missing required strategy', () => {
    expectInvalid((descriptor) => {
      getStrategies(descriptor).splice(1, 1);
      return descriptor;
    }, 'coverage.strategies is missing required strategy install_substrates');
  });

  it('rejects an extra strategy', () => {
    expectInvalid((descriptor) => {
      getStrategies(descriptor).push({
        name: 'operator_rollout',
        operator_path: 'online/operator_rollout',
        target_profile: 'existing_kubernetes/external_declared/online',
      });
      return descriptor;
    }, 'coverage.strategies must not include extra strategy operator_rollout');
  });

  it('rejects a duplicate strategy', () => {
    expectInvalid((descriptor) => {
      const strategies = getStrategies(descriptor);
      strategies[1] = structuredClone(strategies[0]) as Record<string, unknown>;
      return descriptor;
    }, 'coverage.strategies contains duplicate strategy use_existing');
  });

  it('rejects a release contract digest mismatch', () => {
    expectInvalid((descriptor) => {
      getRecord(descriptor, 'release_contract').input_sha256 = `sha256:${'0'.repeat(64)}`;
      return descriptor;
    }, 'release_contract.input_sha256 must match supplied release contract raw digest');
  });

  it.each([
    ['release_id', 'release_contract_file.release_id must be a non-empty string.'],
    ['git_sha', 'release_contract_file.git_sha must be a non-empty string.'],
  ])('rejects a supplied release contract missing %s', (key, expectedReason) => {
    expectInvalidReleaseContract((releaseContract) => {
      delete releaseContract[key];
      return releaseContract;
    }, expectedReason);
  });

  it('rejects a canonical repo identity mismatch', () => {
    expectInvalid((descriptor) => {
      getRecord(descriptor, 'provenance').normalized_remote = 'github.com/agentsmith-project/not-release-kit';
      return descriptor;
    }, `canonical repo identity must be ${RELEASE_KIT_CANONICAL_REPO}`);
  });

  it.each(['release_verdict', 'readiness'])('rejects forbidden verdict/readiness key %s', (key) => {
    expectInvalid((descriptor) => {
      descriptor[key] = 'passed';
      return descriptor;
    }, `forbidden handoff key "${key}" must not be present`);
  });

  it('rejects local artifact paths', () => {
    expectInvalid((descriptor) => {
      getRecord(descriptor, 'online_adoption_report').artifact_uri = '/tmp/online-adoption-report.json';
      return descriptor;
    }, 'raw local paths, file URIs, traversal paths, and home/tmp paths are not allowed');
  });

  it('rejects secret-looking values', () => {
    expectInvalid((descriptor) => {
      descriptor.release_id = '2026.05.29 token=abc123';
      return descriptor;
    }, 'secret-looking value must not be present');
  });

  it('stays standalone from release:ready and contracts:check entrypoints', () => {
    const packageJson = readJsonFile(resolve(process.cwd(), 'package.json'));
    const scripts = getRecord(packageJson, 'scripts');
    const releaseReady = requireString(scripts['release:ready'], 'scripts.release:ready');
    const contractsCheck = requireString(scripts['contracts:check'], 'scripts.contracts:check');
    const releaseReadySource = readFileSync(
      resolve(process.cwd(), 'scripts/governance/release-ready.ts'),
      'utf8',
    );

    for (const entrypoint of [releaseReady, contractsCheck, releaseReadySource]) {
      expect(entrypoint).not.toContain('release-kit-online-adoption-handoff');
      expect(entrypoint).not.toContain('online-adoption');
    }
  });
});

function expectInvalid(
  buildInput: (descriptor: Record<string, unknown>) => unknown,
  expectedReason: string,
): void {
  const fixture = writeFixture(buildInput);
  const result = validateReleaseKitOnlineAdoptionHandoffFiles({
    inputPath: fixture.inputPath,
    releaseContractPath: fixture.releaseContractPath,
  });

  expect(result.ok).toBe(false);
  expect(failureText(result)).toContain(expectedReason);
}

function expectInvalidReleaseContract(
  buildReleaseContract: (releaseContract: Record<string, unknown>) => Record<string, unknown>,
  expectedReason: string,
): void {
  const fixture = writeFixture((descriptor) => descriptor, buildReleaseContract);
  const result = validateReleaseKitOnlineAdoptionHandoffFiles({
    inputPath: fixture.inputPath,
    releaseContractPath: fixture.releaseContractPath,
  });

  expect(result.ok).toBe(false);
  expect(failureText(result)).toContain(expectedReason);
}

function failureText(result: ValidationResult): string {
  if (result.ok) {
    return '';
  }

  return result.failures.map((failure) => `${failure.path}: ${failure.reason}`).join('\n');
}

function writeFixture(
  buildInput: (descriptor: Record<string, unknown>) => unknown = (descriptor) => descriptor,
  buildReleaseContract: (releaseContract: Record<string, unknown>) => Record<string, unknown> = (
    releaseContract,
  ) => releaseContract,
): FixturePaths {
  const root = mkdtempSync(join(tmpdir(), 'agentsmith-handoff-'));
  tempRoots.push(root);

  const sourceReleaseContractRaw = readFileSync(RELEASE_CONTRACT_FIXTURE);
  const sourceReleaseContract = parseRecord(sourceReleaseContractRaw.toString('utf8'));
  const releaseContract = buildReleaseContract(structuredClone(sourceReleaseContract) as Record<string, unknown>);
  const releaseContractRaw = Buffer.from(`${JSON.stringify(releaseContract, null, 2)}\n`);
  const releaseContractPath = join(root, 'release-contract.json');
  writeFileSync(releaseContractPath, releaseContractRaw);

  const descriptor = validDescriptor(releaseContractRaw, releaseContract, sourceReleaseContract);
  const inputPath = join(root, 'handoff.json');
  writeFileSync(inputPath, `${JSON.stringify(buildInput(descriptor), null, 2)}\n`);

  return {
    inputPath,
    releaseContractPath,
  };
}

function validDescriptor(
  releaseContractRaw: Buffer,
  releaseContract: Record<string, unknown>,
  bindingContract: Record<string, unknown> = releaseContract,
): Record<string, unknown> {
  const subject = structuredClone(releaseContract) as Record<string, unknown>;
  delete subject.artifact_provenance;

  return {
    schema_version: RELEASE_KIT_ONLINE_ADOPTION_HANDOFF_SCHEMA_VERSION,
    release_id: requireString(bindingContract.release_id, 'release_contract.release_id'),
    git_sha: requireString(bindingContract.git_sha, 'release_contract.git_sha'),
    release_contract: {
      input_sha256: sha256BufferDigest(releaseContractRaw),
      subject_sha256: sha256Digest(canonicalReleaseBoundaryJson(subject)),
    },
    provenance: {
      producer_repo: RELEASE_KIT_CANONICAL_REPO,
      normalized_remote: RELEASE_KIT_CANONICAL_REPO,
      commit_sha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    },
    online_adoption_report: {
      artifact_uri: 'gh-artifact://agentsmith-project/agentsmith-release-kit/online-adoption/10001/online-adoption-report.json',
      artifact_sha256: REPORT_ARTIFACT_SHA256,
      subject_sha256: REPORT_SUBJECT_SHA256,
    },
    coverage: {
      strategies: [
        {
          name: 'use_existing',
          operator_path: 'online/use_existing',
          target_profile: 'existing_kubernetes/external_declared/online',
        },
        {
          name: 'install_substrates',
          operator_path: 'online/install_substrates',
          target_profile: 'existing_kubernetes/kit_installed/online',
        },
      ],
    },
  };
}

function getStrategies(descriptor: Record<string, unknown>): Record<string, unknown>[] {
  const coverage = getRecord(descriptor, 'coverage');
  const strategies = coverage.strategies;
  if (!Array.isArray(strategies) || !strategies.every(isRecord)) {
    throw new Error('coverage.strategies test fixture must be an array of objects.');
  }

  return strategies;
}

function readJsonFile(filePath: string): Record<string, unknown> {
  return parseRecord(readFileSync(filePath, 'utf8'));
}

function parseRecord(source: string): Record<string, unknown> {
  const parsed = JSON.parse(source) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('test fixture JSON must be an object.');
  }

  return parsed;
}

function getRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = value[key];
  if (!isRecord(nested)) {
    throw new Error(`${key} test fixture field must be an object.`);
  }

  return nested;
}

function requireString(value: unknown, pathName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${pathName} must be a string.`);
  }

  return value;
}

function sha256BufferDigest(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
