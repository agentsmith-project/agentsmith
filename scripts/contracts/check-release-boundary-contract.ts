import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURRENT_DEPLOYMENT_MODE_MATRIX,
  CURRENT_RELEASE_BOUNDARY_SCHEMA_VERSION,
  CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX,
  CURRENT_RELEASE_KIT_EVIDENCE_MAPPING,
  validateAgentSmithReleaseContract,
  validateDeployTemplatePackage,
  validateReleaseKitEvidenceForAggregate,
  validateReleaseKitEvidenceMapping,
  validateRunnerReleaseManifest,
  validateSubstrateConnectionTruth,
  validateTruthMatrix,
  type CurrentReleaseBoundaryValidationFailure,
} from '../governance/current-release-boundary-schema';

const CHECK_NPM_SCRIPT = 'contracts:check-release-boundary';
const CHECK_SCRIPT_COMMAND = 'tsx scripts/contracts/check-release-boundary-contract.ts';
const FIXTURE_ROOT = 'scripts/governance/__fixtures__/release-boundary';

type PackageJson = {
  scripts?: Record<string, string>;
};

export type ReleaseBoundaryContractFailure = {
  path: string;
  message: string;
};

export type ReleaseBoundaryContractCheckResult = {
  ok: boolean;
  failures: ReleaseBoundaryContractFailure[];
};

type CheckOptions = {
  rootDir?: string;
};

function addFailure(
  failures: ReleaseBoundaryContractFailure[],
  path: string,
  message: string,
): void {
  failures.push({ path, message });
}

function readJson(rootDir: string, relativePath: string, failures: ReleaseBoundaryContractFailure[]): unknown {
  const absolutePath = join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    addFailure(failures, relativePath, `${relativePath} must exist.`);
    return null;
  }

  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse error';
    addFailure(failures, relativePath, `Invalid JSON fixture: ${message}`);
    return null;
  }
}

function pushValidationFailures(
  failures: ReleaseBoundaryContractFailure[],
  relativePath: string,
  validationFailures: readonly CurrentReleaseBoundaryValidationFailure[],
): void {
  for (const failure of validationFailures) {
    addFailure(failures, relativePath, `${failure.path}: ${failure.reason}`);
  }
}

function validatePackageScripts(rootDir: string, failures: ReleaseBoundaryContractFailure[]): void {
  const packageJson = readJson(rootDir, 'package.json', failures) as PackageJson | null;
  const scripts = packageJson?.scripts ?? {};

  if (scripts[CHECK_NPM_SCRIPT] !== CHECK_SCRIPT_COMMAND) {
    addFailure(
      failures,
      'package.json',
      `package.json must expose ${CHECK_NPM_SCRIPT} as ${CHECK_SCRIPT_COMMAND}.`,
    );
  }
  if (!scripts['contracts:check']?.includes(`npm run ${CHECK_NPM_SCRIPT}`)) {
    addFailure(
      failures,
      'package.json',
      `contracts:check must include npm run ${CHECK_NPM_SCRIPT}.`,
    );
  }
}

function validateFixture(
  rootDir: string,
  relativeName: string,
  validator: (value: unknown) => { ok: boolean; failures?: readonly CurrentReleaseBoundaryValidationFailure[] },
  failures: ReleaseBoundaryContractFailure[],
): void {
  const relativePath = join(FIXTURE_ROOT, relativeName);
  const value = readJson(rootDir, relativePath, failures);
  if (value === null) {
    return;
  }

  const result = validator(value);
  if (!result.ok) {
    pushValidationFailures(failures, relativePath, result.failures ?? []);
  }
}

export function checkReleaseBoundaryContract(
  options: CheckOptions = {},
): ReleaseBoundaryContractCheckResult {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const failures: ReleaseBoundaryContractFailure[] = [];

  validatePackageScripts(rootDir, failures);

  if (CURRENT_RELEASE_BOUNDARY_SCHEMA_VERSION !== 'agentsmith.current-release-boundary/v1') {
    addFailure(failures, 'scripts/governance/current-release-boundary-schema.ts', 'unexpected release boundary schema version.');
  }
  if (CURRENT_DEPLOYMENT_MODE_MATRIX.some((entry) => entry.target_cluster === 'kind_rehearsal' && entry.required_target)) {
    addFailure(failures, 'scripts/governance/current-release-boundary-schema.ts', 'kind_rehearsal must not be a required target.');
  }

  const truthMatrix = validateTruthMatrix(CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX);
  if (!truthMatrix.ok) {
    pushValidationFailures(failures, 'scripts/governance/current-release-boundary-schema.ts', truthMatrix.failures);
  }

  const mapping = validateReleaseKitEvidenceMapping(CURRENT_RELEASE_KIT_EVIDENCE_MAPPING);
  if (!mapping.ok) {
    pushValidationFailures(failures, 'scripts/governance/current-release-boundary-schema.ts', mapping.failures);
  }

  validateFixture(rootDir, 'release-contract.valid.json', validateAgentSmithReleaseContract, failures);
  validateFixture(rootDir, 'deploy-template-package.valid.json', validateDeployTemplatePackage, failures);
  validateFixture(rootDir, 'substrate-connection.external-declared.valid.json', validateSubstrateConnectionTruth, failures);
  validateFixture(rootDir, 'substrate-connection.kit-installed.valid.json', validateSubstrateConnectionTruth, failures);
  validateFixture(rootDir, 'release-kit-evidence.valid.json', validateReleaseKitEvidenceForAggregate, failures);
  validateFixture(rootDir, 'runner-release-manifest.valid.json', validateRunnerReleaseManifest, failures);

  return {
    ok: failures.length === 0,
    failures,
  };
}

function formatFailure(failure: ReleaseBoundaryContractFailure): string {
  return `- ${failure.path}: ${failure.message}`;
}

function main(): void {
  const result = checkReleaseBoundaryContract();

  if (!result.ok) {
    console.error('[contracts] release boundary contract check failed:');
    for (const failure of result.failures) {
      console.error(formatFailure(failure));
    }
    process.exit(1);
  }

  console.log('[contracts] release boundary contract check passed');
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedModulePath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);

if (currentModulePath === invokedModulePath) {
  main();
}
