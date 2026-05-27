import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURRENT_DEPLOYMENT_MODE_MATRIX,
  CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES,
  CURRENT_RELEASE_BOUNDARY_SCHEMA_VERSION,
  CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX,
  CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES,
  CURRENT_RELEASE_KIT_EVIDENCE_MAPPING,
  CURRENT_MANAGED_RUNNER_RELEASE_INVENTORY_IMAGE_ID,
  parseRunnerImageLockText,
  validateAgentSmithReleaseContract,
  validateDeployTemplatePackage,
  validateReleaseKitEvidenceForAggregate,
  validateReleaseKitEvidenceMapping,
  validateRunnerAdapterInventory,
  validateRunnerReleaseManifest,
  validateSubstrateConnectionTruth,
  validateTruthMatrix,
  type CurrentDeploymentTargetProfile,
  type CurrentAgentSmithReleaseContract,
  type CurrentReleaseBoundaryValidationFailure,
  type CurrentRunnerImageLock,
  type CurrentRunnerReleaseManifest,
} from '../governance/current-release-boundary-schema';

const CHECK_NPM_SCRIPT = 'contracts:check-release-boundary';
const CONTRACT_BUILD_COMMAND = 'npm run build -w @mbos/agent-runner-contract';
const CHECK_SCRIPT_COMMAND = `${CONTRACT_BUILD_COMMAND} && tsx scripts/contracts/check-release-boundary-contract.ts`;
const RUNNER_IMAGE_LOCK_NPM_SCRIPT = 'contracts:check-runner-image-lock';
const RUNNER_IMAGE_LOCK_SCRIPT_COMMAND = `${CONTRACT_BUILD_COMMAND} && tsx scripts/contracts/check-runner-image-lock.ts`;
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

function readText(rootDir: string, relativePath: string, failures: ReleaseBoundaryContractFailure[]): string | null {
  const absolutePath = join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    addFailure(failures, relativePath, `${relativePath} must exist.`);
    return null;
  }

  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown read error';
    addFailure(failures, relativePath, `Failed to read fixture: ${message}`);
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

function targetProfileKey(
  profile: Pick<CurrentDeploymentTargetProfile, 'target_cluster' | 'substrate_source' | 'distribution'>,
): string {
  return `${profile.target_cluster}|${profile.substrate_source}|${profile.distribution}`;
}

const REQUIRED_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILE_KEYS = [
  'existing_kubernetes|external_declared|online',
  'existing_kubernetes|kit_installed|online',
  'existing_kubernetes|external_declared|airgap',
  'existing_kubernetes|kit_installed|airgap',
] as const;

function validateHandoffTargetProfiles(
  profiles: readonly CurrentDeploymentTargetProfile[],
  canonicalDeclarableProfileKeys: readonly string[],
  failures: ReleaseBoundaryContractFailure[],
  relativePath = 'scripts/governance/current-release-boundary-schema.ts',
): void {
  const canonicalDeclarableProfileKeySet = new Set(canonicalDeclarableProfileKeys);
  const seenProfileKeys = new Set<string>();

  if (profiles.length === 0) {
    addFailure(
      failures,
      relativePath,
      'release contract handoff target profiles must not be empty.',
    );
  }

  for (const profile of profiles) {
    const profileKey = targetProfileKey(profile);
    if (seenProfileKeys.has(profileKey)) {
      addFailure(
        failures,
        relativePath,
        `release contract handoff target profile ${profileKey} is declared more than once.`,
      );
    }
    seenProfileKeys.add(profileKey);

    if (!canonicalDeclarableProfileKeySet.has(profileKey)) {
      addFailure(
        failures,
        relativePath,
        `release contract handoff target profile ${profileKey} is not in the release-kit canonical declarable set.`,
      );
    }
    if (profile.target_cluster === 'kind_rehearsal') {
      addFailure(
        failures,
        relativePath,
        'release contract handoff target profiles must not include kind_rehearsal; kind is local/dev rehearsal only.',
      );
    }
    if (profile.required !== false) {
      addFailure(
        failures,
        relativePath,
        'AgentSmith pre-GA release contract handoff target profiles must not be required targets.',
      );
    }
  }

  for (const requiredProfileKey of REQUIRED_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILE_KEYS) {
    if (seenProfileKeys.has(requiredProfileKey)) {
      continue;
    }
    addFailure(
      failures,
      relativePath,
      `release contract handoff target profiles must include ${requiredProfileKey} for the online/airgap x external_declared/kit_installed matrix.`,
    );
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
  if (scripts[RUNNER_IMAGE_LOCK_NPM_SCRIPT] !== RUNNER_IMAGE_LOCK_SCRIPT_COMMAND) {
    addFailure(
      failures,
      'package.json',
      `package.json must expose ${RUNNER_IMAGE_LOCK_NPM_SCRIPT} as ${RUNNER_IMAGE_LOCK_SCRIPT_COMMAND}.`,
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

function validateReleaseContractFixtureTargetProfiles(
  rootDir: string,
  canonicalDeclarableProfileKeys: readonly string[],
  failures: ReleaseBoundaryContractFailure[],
): void {
  const relativePath = join(FIXTURE_ROOT, 'release-contract.valid.json');
  const value = readJson(rootDir, relativePath, failures);
  if (value === null) {
    return;
  }

  const result = validateAgentSmithReleaseContract(value);
  if (!result.ok) {
    return;
  }

  validateHandoffTargetProfiles(
    result.value.target_profiles,
    canonicalDeclarableProfileKeys,
    failures,
    relativePath,
  );
}

function validateRunnerImageLockFixture(rootDir: string, failures: ReleaseBoundaryContractFailure[]): void {
  const relativePath = join(FIXTURE_ROOT, 'agentsmith-runner-image.lock');
  const value = readText(rootDir, relativePath, failures);
  if (value === null) {
    return;
  }

  const result = parseRunnerImageLockText(value, relativePath);
  if (!result.ok) {
    pushValidationFailures(failures, relativePath, result.failures);
  }
}

function validateReleaseContractRunnerImageLockAlignment(
  rootDir: string,
  failures: ReleaseBoundaryContractFailure[],
): void {
  const contractRelativePath = join(FIXTURE_ROOT, 'release-contract.valid.json');
  const lockRelativePath = join(FIXTURE_ROOT, 'agentsmith-runner-image.lock');
  const manifestRelativePath = join(FIXTURE_ROOT, 'runner-release-manifest.valid.json');
  const contractValue = readJson(rootDir, contractRelativePath, failures);
  const lockValue = readText(rootDir, lockRelativePath, failures);
  const manifestValue = readJson(rootDir, manifestRelativePath, failures);
  if (contractValue === null || lockValue === null || manifestValue === null) {
    return;
  }

  const contractResult = validateAgentSmithReleaseContract(contractValue);
  const lockResult = parseRunnerImageLockText(lockValue, lockRelativePath);
  const manifestResult = validateRunnerReleaseManifest(manifestValue);
  if (!contractResult.ok || !lockResult.ok || !manifestResult.ok) {
    return;
  }

  validateRunnerImageLockMatchesManifest(lockResult.value, manifestResult.value, failures);
  validateManagedRunnerImageMatchesLock(contractResult.value, lockResult.value, failures);
}

function validateRunnerImageLockMatchesManifest(
  lock: CurrentRunnerImageLock,
  manifest: CurrentRunnerReleaseManifest,
  failures: ReleaseBoundaryContractFailure[],
): void {
  const manifestProtocol = manifest.supported_protocol_versions[0] ?? '';

  compareRunnerAdoptionString(
    failures,
    'adoption.release_id',
    manifest.release_id,
    lock.release_id,
    'lock release_id must match runner release manifest release_id',
  );
  compareRunnerAdoptionString(
    failures,
    'adoption.git_sha',
    manifest.git_sha,
    lock.git_sha,
    'lock git_sha must match runner release manifest git_sha',
  );
  compareRunnerAdoptionString(
    failures,
    'adoption.runner_contract_version',
    manifest.runner_contract_version,
    lock.runner_contract_version,
    'lock runner_contract_version must match runner release manifest runner_contract_version',
  );
  compareRunnerAdoptionString(
    failures,
    'adoption.runner_protocol_version',
    manifestProtocol,
    lock.runner_protocol_version,
    'lock runner_protocol_version must match runner release manifest supported protocol',
  );
  compareRunnerAdoptionString(
    failures,
    'adoption.image.id',
    manifest.image.id,
    lock.image.id,
    'lock image id must match runner release manifest image id',
  );
  compareRunnerAdoptionString(
    failures,
    'adoption.image.image',
    manifest.image.image,
    lock.image.image,
    'lock image ref must match runner release manifest image ref',
  );
  compareRunnerAdoptionString(
    failures,
    'adoption.image.digest',
    manifest.image.digest,
    lock.image.digest,
    'lock image digest must match runner release manifest image digest',
  );
  compareRunnerAdoptionString(
    failures,
    'adoption.manifest.producer_repo',
    manifest.artifact_provenance.producer_repo,
    lock.manifest.producer_repo,
    'lock manifest producer_repo must match runner release manifest producer_repo',
  );
  compareRunnerAdoptionString(
    failures,
    'adoption.manifest.subject_sha256',
    manifest.artifact_provenance.subject_sha256,
    lock.manifest.subject_sha256,
    'lock manifest subject_sha256 must match runner release manifest subject_sha256',
  );
  compareRunnerAdoptionString(
    failures,
    'adoption.manifest.artifact_sha256',
    manifest.artifact_provenance.artifact_sha256,
    lock.manifest.artifact_sha256,
    'lock manifest artifact_sha256 must match runner release manifest artifact_sha256',
  );
}

function compareRunnerAdoptionString(
  failures: ReleaseBoundaryContractFailure[],
  field: string,
  expected: string,
  actual: string,
  message: string,
): void {
  if (expected === actual) {
    return;
  }

  addFailure(
    failures,
    join(FIXTURE_ROOT, 'agentsmith-runner-image.lock'),
    `${field}: ${message}; expected ${expected}; actual ${actual}`,
  );
}

function validateManagedRunnerImageMatchesLock(
  contract: CurrentAgentSmithReleaseContract,
  lock: CurrentRunnerImageLock,
  failures: ReleaseBoundaryContractFailure[],
): void {
  const contractRelativePath = join(FIXTURE_ROOT, 'release-contract.valid.json');
  if (
    contract.managed_runner_image.id !== lock.image.id
    || contract.managed_runner_image.image !== lock.image.image
    || contract.managed_runner_image.digest !== lock.image.digest
  ) {
    addFailure(
      failures,
      contractRelativePath,
      'managed_runner_image must match agentsmith-runner-image.lock image.',
    );
  }

  const inventoryImage = contract.deploy_image_inventory.find(
    (image) => image.id === CURRENT_MANAGED_RUNNER_RELEASE_INVENTORY_IMAGE_ID,
  );
  if (!inventoryImage) {
    addFailure(
      failures,
      contractRelativePath,
      `deploy_image_inventory must include ${CURRENT_MANAGED_RUNNER_RELEASE_INVENTORY_IMAGE_ID}.`,
    );
    return;
  }

  if (
    inventoryImage.image !== lock.image.image
    || inventoryImage.digest !== lock.image.digest
    || inventoryImage.source !== 'managed_runner_image'
  ) {
    addFailure(
      failures,
      contractRelativePath,
      `${CURRENT_MANAGED_RUNNER_RELEASE_INVENTORY_IMAGE_ID} inventory image must match agentsmith-runner-image.lock image.`,
    );
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
  if (CURRENT_DEPLOYMENT_MODE_MATRIX.some((entry) => entry.required_target)) {
    addFailure(
      failures,
      'scripts/governance/current-release-boundary-schema.ts',
      'AgentSmith pre-GA deployment target profiles must not be required targets.',
    );
  }
  const canonicalDeclarableProfileKeys =
    CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES.map(targetProfileKey);
  if (JSON.stringify(CURRENT_DEPLOYMENT_MODE_MATRIX.map(targetProfileKey)) !== JSON.stringify(canonicalDeclarableProfileKeys)) {
    addFailure(
      failures,
      'scripts/governance/current-release-boundary-schema.ts',
      'deployment mode matrix must exactly match the release-kit canonical declarable target profile set.',
    );
  }
  validateHandoffTargetProfiles(
    CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES,
    canonicalDeclarableProfileKeys,
    failures,
  );
  const handoffTargetProfilesJson = readJson(
    rootDir,
    'scripts/governance/release-contract-target-profiles.json',
    failures,
  );
  if (handoffTargetProfilesJson !== null) {
    if (Array.isArray(handoffTargetProfilesJson)) {
      validateHandoffTargetProfiles(
        handoffTargetProfilesJson as CurrentDeploymentTargetProfile[],
        canonicalDeclarableProfileKeys,
        failures,
        'scripts/governance/release-contract-target-profiles.json',
      );
    } else {
      addFailure(
        failures,
        'scripts/governance/release-contract-target-profiles.json',
        'CI handoff target profile JSON must be an array.',
      );
    }
    if (JSON.stringify(handoffTargetProfilesJson) !== JSON.stringify(CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES)) {
      addFailure(
        failures,
        'scripts/governance/release-contract-target-profiles.json',
        'CI handoff target profile JSON must match CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES.',
      );
    }
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
  validateReleaseContractFixtureTargetProfiles(rootDir, canonicalDeclarableProfileKeys, failures);
  validateFixture(rootDir, 'deploy-template-package.valid.json', validateDeployTemplatePackage, failures);
  validateFixture(rootDir, 'substrate-connection.external-declared.valid.json', validateSubstrateConnectionTruth, failures);
  validateFixture(rootDir, 'substrate-connection.kit-installed.valid.json', validateSubstrateConnectionTruth, failures);
  validateFixture(rootDir, 'release-kit-evidence.valid.json', validateReleaseKitEvidenceForAggregate, failures);
  validateFixture(rootDir, 'runner-release-manifest.valid.json', validateRunnerReleaseManifest, failures);
  validateRunnerImageLockFixture(rootDir, failures);
  validateReleaseContractRunnerImageLockAlignment(rootDir, failures);
  validateFixture(
    rootDir,
    'runner-adapter-inventory.valid.json',
    (value) => validateRunnerAdapterInventory(value, { rootDir }),
    failures,
  );

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
