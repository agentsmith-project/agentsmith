import {
  CURRENT_RELEASE_KIT_EVIDENCE_MAPPING,
  CURRENT_RELEASE_KIT_EVIDENCE_SCHEMA_VERSION,
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateNoSecretLeak,
  validateReleaseKitEvidence,
  type CurrentDeploymentDistribution,
  type CurrentDeploymentSubstrateSource,
  type CurrentDeploymentTargetCluster,
  type CurrentReleaseBoundaryValidationFailure,
  type CurrentReleaseBoundaryValidationResult,
  type CurrentReleaseKitEvidence,
} from './current-release-boundary-schema';

const RAW_RELEASE_KIT_EVIDENCE_ENVELOPE_SCHEMA_VERSION =
  'agentsmith.release-kit-evidence-envelope/v1';
const RELEASE_KIT_EVIDENCE_SUBJECT_NAME = 'release-kit-evidence-subject';

const RELEASE_KIT_OUTPUT_REQUIRED_SUBJECT_FILES: Record<string, readonly string[]> = {
  'deploy-result.json#substrate': ['evidence.json', 'deploy-result.json'],
  'image-map.json': ['evidence.json', 'image-map.json'],
  'airgap-bundle-check-report.json+airgap-bundle-manifest.json': [
    'evidence.json',
    'airgap-bundle-check-report.json',
    'airgap-bundle-manifest.json',
  ],
  'online-deployment-gate-report.json': ['evidence.json', 'online-deployment-gate-report.json'],
};

export interface ReleaseKitEvidenceAdapterTargetProfile {
  target_cluster: CurrentDeploymentTargetCluster;
  substrate_source: CurrentDeploymentSubstrateSource;
  distribution: CurrentDeploymentDistribution;
}

export interface ReleaseKitEvidenceAdapterContext {
  expectedReleaseContractDigest: string;
  expectedTargetProfile?: ReleaseKitEvidenceAdapterTargetProfile;
  evidenceRoot: string;
  artifactSha256?: string;
}

function invalid<T = never>(
  path: string,
  reason: string,
  failures: CurrentReleaseBoundaryValidationFailure[] = [],
): CurrentReleaseBoundaryValidationResult<T> {
  return {
    ok: false,
    failures: [
      ...failures,
      { path, reason },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function rawString(
  value: Record<string, unknown>,
  key: string,
  path: string,
): string | null {
  const field = value[key];
  return typeof field === 'string' && field.trim() !== '' ? field : null;
}

function validateContextDigest(
  rawEnvelope: Record<string, unknown>,
  context: ReleaseKitEvidenceAdapterContext,
): CurrentReleaseBoundaryValidationResult | null {
  if (rawEnvelope.release_contract_digest !== context.expectedReleaseContractDigest) {
    return invalid(
      'release_contract_digest',
      'release_contract_digest must match adapter context.',
    );
  }
  return null;
}

function validateContextTargetProfile(
  rawEnvelope: Record<string, unknown>,
  context: ReleaseKitEvidenceAdapterContext,
): CurrentReleaseBoundaryValidationResult | null {
  if (!context.expectedTargetProfile) {
    return null;
  }

  const expected = context.expectedTargetProfile;
  if (
    rawEnvelope.target_cluster !== expected.target_cluster
    || rawEnvelope.substrate_source !== expected.substrate_source
    || rawEnvelope.distribution !== expected.distribution
  ) {
    return invalid('target_profile', 'target axes must match adapter context.');
  }
  return null;
}

function resolveMapping(
  rawEnvelope: Record<string, unknown>,
): CurrentReleaseBoundaryValidationResult<typeof CURRENT_RELEASE_KIT_EVIDENCE_MAPPING[number]> {
  const releaseKitOutput = rawString(rawEnvelope, 'release_kit_output', 'release_kit_output');
  if (!releaseKitOutput) {
    return invalid('release_kit_output', 'release_kit_output is required.');
  }

  if (releaseKitOutput === 'AgentSmith product flow aggregate') {
    return invalid(
      'release_kit_output',
      'release-kit cannot produce AgentSmith product-flow evidence.',
    );
  }

  const mapping = CURRENT_RELEASE_KIT_EVIDENCE_MAPPING.find((entry) => (
    entry.release_kit_output === releaseKitOutput
  ));
  if (!mapping) {
    return invalid('release_kit_output', 'release_kit_output is not mapped.');
  }
  if (mapping.target === 'product_flows' || mapping.canonical_evidence_owner !== 'agentsmith-release-kit') {
    return invalid(
      'release_kit_output',
      'release-kit cannot produce AgentSmith product-flow evidence.',
    );
  }

  return { ok: true, value: mapping };
}

function validateEvidenceSubjectOutputBinding(
  releaseKitOutput: string,
  evidenceSubject: Record<string, unknown>,
): CurrentReleaseBoundaryValidationResult | null {
  const requiredFiles = RELEASE_KIT_OUTPUT_REQUIRED_SUBJECT_FILES[releaseKitOutput];
  if (!requiredFiles) {
    return null;
  }

  if (!Array.isArray(evidenceSubject.files)) {
    return null;
  }

  const subjectFilePaths = new Set<string>();
  for (const fileEntry of evidenceSubject.files) {
    if (!isRecord(fileEntry) || typeof fileEntry.path !== 'string') {
      return null;
    }
    subjectFilePaths.add(fileEntry.path);
  }

  const missingFiles = requiredFiles.filter((requiredFile) => !subjectFilePaths.has(requiredFile));
  const extraFiles = [...subjectFilePaths].filter((subjectFile) => !requiredFiles.includes(subjectFile));
  if (missingFiles.length === 0 && extraFiles.length === 0) {
    return null;
  }

  if (missingFiles.length > 0) {
    return invalid(
      'evidence_subject.files',
      `release_kit_output ${releaseKitOutput} requires evidence_subject.files to include ${missingFiles.join(', ')}.`,
    );
  }

  return invalid(
    'evidence_subject.files',
    `release_kit_output ${releaseKitOutput} requires evidence_subject.files to contain only ${requiredFiles.join(', ')}.`,
  );
}

function validateRawProvenanceSubject(
  rawEnvelope: Record<string, unknown>,
  evidenceSubject: Record<string, unknown>,
): CurrentReleaseBoundaryValidationResult | null {
  if (!isRecord(rawEnvelope.artifact_provenance)) {
    return invalid('artifact_provenance', 'artifact_provenance must be an object.');
  }

  const provenance = rawEnvelope.artifact_provenance;
  if (provenance.subject_name !== RELEASE_KIT_EVIDENCE_SUBJECT_NAME) {
    return invalid(
      'artifact_provenance.subject_name',
      'subject_name must be release-kit-evidence-subject.',
    );
  }

  const expectedSubjectSha256 = sha256Digest(canonicalReleaseBoundaryJson(evidenceSubject));
  if (provenance.subject_sha256 !== expectedSubjectSha256) {
    return invalid(
      'artifact_provenance.subject_sha256',
      'subject_sha256 must match evidence subject.',
    );
  }

  return null;
}

function validateContextArtifactSha256(
  rawEnvelope: Record<string, unknown>,
  context: ReleaseKitEvidenceAdapterContext,
): CurrentReleaseBoundaryValidationResult | null {
  if (!context.artifactSha256 || !isRecord(rawEnvelope.artifact_provenance)) {
    return null;
  }

  const provenance = rawEnvelope.artifact_provenance;
  if (!hasOwn(provenance, 'artifact_sha256')) {
    return null;
  }

  if (provenance.artifact_sha256 !== context.artifactSha256) {
    return invalid(
      'artifact_provenance.artifact_sha256',
      'artifact_provenance.artifact_sha256 must match adapter context.',
    );
  }

  return null;
}

function artifactProvenanceWithContext(
  rawEnvelope: Record<string, unknown>,
  context: ReleaseKitEvidenceAdapterContext,
): Record<string, unknown> {
  const provenance = rawEnvelope.artifact_provenance as Record<string, unknown>;
  if (!hasOwn(provenance, 'artifact_sha256') && context.artifactSha256) {
    return {
      ...provenance,
      artifact_sha256: context.artifactSha256,
    };
  }

  return {
    ...provenance,
  };
}

export function adaptReleaseKitRawEvidenceEnvelope(
  rawEnvelope: unknown,
  evidenceSubject: unknown,
  context: ReleaseKitEvidenceAdapterContext,
): CurrentReleaseBoundaryValidationResult<CurrentReleaseKitEvidence> {
  const secretFailures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(rawEnvelope, 'raw_envelope', secretFailures);
  validateNoSecretLeak(evidenceSubject, 'evidence_subject', secretFailures);
  if (secretFailures.length > 0) {
    return { ok: false, failures: secretFailures };
  }

  if (!isRecord(rawEnvelope)) {
    return invalid('raw_envelope', 'raw envelope must be an object.');
  }
  if (!isRecord(evidenceSubject)) {
    return invalid('evidence_subject', 'evidence subject must be an object.');
  }

  if (rawEnvelope.schema_version !== RAW_RELEASE_KIT_EVIDENCE_ENVELOPE_SCHEMA_VERSION) {
    return invalid(
      'schema_version',
      `schema_version must be ${RAW_RELEASE_KIT_EVIDENCE_ENVELOPE_SCHEMA_VERSION}.`,
    );
  }

  const mappingResult = resolveMapping(rawEnvelope);
  if (!mappingResult.ok) {
    return mappingResult;
  }

  const bindingResult = validateEvidenceSubjectOutputBinding(
    mappingResult.value.release_kit_output,
    evidenceSubject,
  );
  if (bindingResult) {
    return bindingResult;
  }

  const digestResult = validateContextDigest(rawEnvelope, context);
  if (digestResult) {
    return digestResult;
  }

  const targetProfileResult = validateContextTargetProfile(rawEnvelope, context);
  if (targetProfileResult) {
    return targetProfileResult;
  }

  const artifactShaResult = validateContextArtifactSha256(rawEnvelope, context);
  if (artifactShaResult) {
    return artifactShaResult;
  }

  const provenanceResult = validateRawProvenanceSubject(rawEnvelope, evidenceSubject);
  if (provenanceResult) {
    return provenanceResult;
  }

  const mapping = mappingResult.value;
  const canonicalEvidence: Record<string, unknown> = {
    schema_version: CURRENT_RELEASE_KIT_EVIDENCE_SCHEMA_VERSION,
    release_contract_digest: rawEnvelope.release_contract_digest,
    release_id: rawEnvelope.release_id,
    git_sha: rawEnvelope.git_sha,
    release_kit_version: rawEnvelope.release_kit_version,
    target_cluster: rawEnvelope.target_cluster,
    substrate_source: rawEnvelope.substrate_source,
    distribution: rawEnvelope.distribution,
    target: mapping.target,
    status: rawEnvelope.status,
    failure_class: rawEnvelope.failure_class,
    evidence_root: context.evidenceRoot,
    canonical_writer: mapping.canonical_writer,
    evidence_subject: evidenceSubject,
    artifact_provenance: artifactProvenanceWithContext(rawEnvelope, context),
  };

  if (hasOwn(rawEnvelope, 'substrate_connection_truth')) {
    canonicalEvidence.substrate_connection_truth = rawEnvelope.substrate_connection_truth;
  }

  return validateReleaseKitEvidence(canonicalEvidence);
}
