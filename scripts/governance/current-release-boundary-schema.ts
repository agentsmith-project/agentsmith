import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { AGENT_TASK_RUNNER_SPEC } from '@mbos/agent-runner-contract';
import { findCurrentGateDefinitionById } from './current-gate-manifest';

export const CURRENT_RELEASE_BOUNDARY_SCHEMA_VERSION = 'agentsmith.current-release-boundary/v1' as const;
export const CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION = 'agentsmith.release-contract/v1' as const;
export const CURRENT_DEPLOY_TEMPLATE_PACKAGE_SCHEMA_VERSION = 'agentsmith.deploy-template-package/v1' as const;
export const CURRENT_SUBSTRATE_CONNECTION_SCHEMA_VERSION = 'agentsmith.substrate-connection.truth/v1' as const;
export const CURRENT_RELEASE_KIT_EVIDENCE_SCHEMA_VERSION = 'agentsmith.release-kit-evidence/v1' as const;
export const CURRENT_RELEASE_KIT_EVIDENCE_SUBJECT_SCHEMA_VERSION =
  'agentsmith.release-kit-evidence-subject/v1' as const;
export const CURRENT_RELEASE_KIT_EVIDENCE_AGGREGATE_CANONICAL_SCHEMA_VERSION =
  'agentsmith.release-kit-evidence.aggregate-canonical/v1' as const;
export const CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION = 'agentsmith.artifact-provenance/v1' as const;
export const CURRENT_RUNNER_RELEASE_MANIFEST_SCHEMA_VERSION = 'agentsmith.runner-release-manifest/v1' as const;
export const CURRENT_RUNNER_IMAGE_LOCK_SCHEMA_VERSION = 'agentsmith.runner-image-lock/v1' as const;
export const CURRENT_RUNNER_ADAPTER_INVENTORY_SCHEMA_VERSION =
  'agentsmith.runner-adapter-inventory/v1' as const;
export const CURRENT_RUNNER_PROTOCOL_VERSION = AGENT_TASK_RUNNER_SPEC.protocol_version;

export const AGENTSMITH_CANONICAL_REPO = 'github.com/agentsmith-project/agentsmith' as const;
export const RELEASE_KIT_CANONICAL_REPO = 'github.com/agentsmith-project/agentsmith-release-kit' as const;
export const RUNNER_CANONICAL_REPO = 'github.com/agentsmith-project/agentsmith-runner' as const;
export const FORBIDDEN_RUNNER_REPO = 'github.com/agentsmith-project/agentsmith-codex-runner' as const;

export const CURRENT_REQUIRED_PRODUCT_FLOWS = [
  'workspace_project',
  'files',
  'agent_task_managed_runner',
] as const;

export const CURRENT_DEPLOYMENT_TARGET_CLUSTERS = [
  'existing_kubernetes',
  'kind_rehearsal',
] as const;
export const CURRENT_DEPLOYMENT_SUBSTRATE_SOURCES = [
  'kit_installed',
  'external_declared',
] as const;
export const CURRENT_DEPLOYMENT_DISTRIBUTIONS = [
  'online',
  'airgap',
] as const;
export const CURRENT_DEPLOYMENT_SUPPORT_LEVELS = [
  'primary',
  'advanced',
  'rehearsal',
  'diagnostic',
] as const;

export type CurrentProductFlow = (typeof CURRENT_REQUIRED_PRODUCT_FLOWS)[number];
export type CurrentDeploymentTargetCluster = (typeof CURRENT_DEPLOYMENT_TARGET_CLUSTERS)[number];
export type CurrentDeploymentSubstrateSource = (typeof CURRENT_DEPLOYMENT_SUBSTRATE_SOURCES)[number];
export type CurrentDeploymentDistribution = (typeof CURRENT_DEPLOYMENT_DISTRIBUTIONS)[number];
export type CurrentDeploymentSupportLevel = (typeof CURRENT_DEPLOYMENT_SUPPORT_LEVELS)[number];
export type CurrentArtifactProvenanceKind = 'ci_artifact' | 'signed_operator_run';
export type CurrentReleaseKitEvidenceTarget = 'dependencies' | 'images' | 'rollout' | 'product_flows';

export interface CurrentDeploymentModeMatrixEntry {
  target_cluster: CurrentDeploymentTargetCluster;
  substrate_source: CurrentDeploymentSubstrateSource;
  distribution: CurrentDeploymentDistribution;
  support_level: CurrentDeploymentSupportLevel;
  required_target: false;
}

export interface CurrentReleaseBoundaryValidationFailure {
  path: string;
  reason: string;
}

export type CurrentReleaseBoundaryValidationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      failures: readonly CurrentReleaseBoundaryValidationFailure[];
    };

export interface CurrentReleaseImage {
  id: string;
  image: string;
  digest: string;
}

export interface CurrentReleaseInventoryImage extends CurrentReleaseImage {
  source: 'product_images' | 'adopted_provider_images' | 'release_kit_prerequisite_images';
}

export interface CurrentDeploymentTargetProfile {
  target_cluster: CurrentDeploymentTargetCluster;
  substrate_source: CurrentDeploymentSubstrateSource;
  distribution: CurrentDeploymentDistribution;
  required: false;
  prerequisites: {
    namespace: string;
    rbac: string;
    ingress: string;
    tls: string;
    storage_class: string;
    registry: string;
    pull_secret_ref: string;
  };
}

export const CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES = [
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'external_declared',
    distribution: 'online',
  },
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'external_declared',
    distribution: 'airgap',
  },
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'kit_installed',
    distribution: 'online',
  },
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'kit_installed',
    distribution: 'airgap',
  },
  {
    target_cluster: 'kind_rehearsal',
    substrate_source: 'kit_installed',
    distribution: 'online',
  },
] as const satisfies readonly Pick<
  CurrentDeploymentModeMatrixEntry,
  'target_cluster' | 'substrate_source' | 'distribution'
>[];

// Must stay synchronized with release-kit canonical declarable target profiles.
export const CURRENT_RELEASE_CONTRACT_HANDOFF_TARGET_PROFILES = [
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'external_declared',
    distribution: 'online',
    required: false,
    prerequisites: {
      namespace: 'agentsmith',
      rbac: 'namespace_admin',
      ingress: 'operator_provided',
      tls: 'required',
      storage_class: 'operator_provided',
      registry: 'ghcr_or_operator_mirror',
      pull_secret_ref: 'operator_secret_ref',
    },
  },
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'external_declared',
    distribution: 'airgap',
    required: false,
    prerequisites: {
      namespace: 'agentsmith',
      rbac: 'namespace_admin',
      ingress: 'operator_provided',
      tls: 'required',
      storage_class: 'operator_provided',
      registry: 'operator_mirror',
      pull_secret_ref: 'operator_secret_ref',
    },
  },
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'kit_installed',
    distribution: 'online',
    required: false,
    prerequisites: {
      namespace: 'agentsmith',
      rbac: 'namespace_admin',
      ingress: 'operator_provided',
      tls: 'required',
      storage_class: 'operator_provided',
      registry: 'ghcr_or_operator_mirror',
      pull_secret_ref: 'operator_secret_ref',
    },
  },
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'kit_installed',
    distribution: 'airgap',
    required: false,
    prerequisites: {
      namespace: 'agentsmith',
      rbac: 'namespace_admin',
      ingress: 'operator_provided',
      tls: 'required',
      storage_class: 'operator_provided',
      registry: 'operator_mirror',
      pull_secret_ref: 'operator_secret_ref',
    },
  },
  {
    target_cluster: 'kind_rehearsal',
    substrate_source: 'kit_installed',
    distribution: 'online',
    required: false,
    prerequisites: {
      namespace: 'agentsmith',
      rbac: 'local_admin',
      ingress: 'local',
      tls: 'optional',
      storage_class: 'standard',
      registry: 'local_kind_import',
      pull_secret_ref: 'not_required',
    },
  },
] as const satisfies readonly CurrentDeploymentTargetProfile[];

export interface CurrentArtifactProvenance {
  schema_version: typeof CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION;
  provenance_kind: CurrentArtifactProvenanceKind;
  producer_repo: string;
  normalized_remote: string;
  commit_sha: string;
  subject_name: string;
  subject_sha256: string;
  subject_uri: string;
  workflow_name?: string;
  run_id?: string;
  run_attempt?: string;
  job?: string;
  operator_run_id?: string;
  operator_identity?: string;
  signature_uri?: string;
  signature_sha256?: string;
  artifact_uri: string;
  artifact_sha256: string;
  generated_at: string;
  generator_command: string;
  generator_version: string;
  attestation: string | {
    attestation_uri: string;
    attestation_sha256: string;
  };
}

export interface CurrentDeployTemplatePackage {
  schema_version: typeof CURRENT_DEPLOY_TEMPLATE_PACKAGE_SCHEMA_VERSION;
  package_uri: string;
  package_sha256: string;
  manifest_sha256: string;
  artifact_provenance: CurrentArtifactProvenance;
}

export interface CurrentAgentSmithReleaseContract {
  schema_version: typeof CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION;
  product: 'agentsmith';
  release_id: string;
  git_sha: string;
  product_images: readonly CurrentReleaseImage[];
  adopted_provider_images: readonly CurrentReleaseImage[];
  release_kit_prerequisite_images: readonly CurrentReleaseImage[];
  deploy_image_inventory: readonly CurrentReleaseInventoryImage[];
  deploy_template_digest: string;
  deploy_template_package: CurrentDeployTemplatePackage;
  openapi_digest: string;
  asyncapi_digest: string;
  required_product_flows: readonly string[];
  target_profiles: readonly CurrentDeploymentTargetProfile[];
  substrate_connection_schema: typeof CURRENT_SUBSTRATE_CONNECTION_SCHEMA_VERSION;
  min_release_kit_version: string;
  artifact_provenance: CurrentArtifactProvenance;
}

export interface CurrentReleaseKitCanonicalWriter {
  gate_id: string;
  line_kind: string;
  npm_script?: string;
  native_result_path?: string;
  evidence_root?: string;
  summary_section?: string;
}

export interface CurrentReleaseKitEvidenceMappingEntry {
  release_kit_output: string;
  target: CurrentReleaseKitEvidenceTarget;
  canonical_writer: CurrentReleaseKitCanonicalWriter;
  canonical_evidence_owner: 'agentsmith' | 'agentsmith-release-kit';
  current_campaign_target_clusters: readonly CurrentDeploymentTargetCluster[];
  expected_product_flow_producer?: 'unified-deploy-product-flows';
  reject_conditions: readonly string[];
}

export interface CurrentReleaseKitEvidence {
  schema_version: typeof CURRENT_RELEASE_KIT_EVIDENCE_SCHEMA_VERSION;
  release_contract_digest: string;
  release_id: string;
  git_sha: string;
  release_kit_version: string;
  target_cluster: CurrentDeploymentTargetCluster;
  substrate_source: CurrentDeploymentSubstrateSource;
  distribution: CurrentDeploymentDistribution;
  target: CurrentReleaseKitEvidenceTarget;
  status: 'passed' | 'failed';
  failure_class: string;
  evidence_root: string;
  canonical_writer: CurrentReleaseKitCanonicalWriter;
  evidence_subject: Record<string, unknown>;
  artifact_provenance: CurrentArtifactProvenance;
  product_flow_canonical_evidence?: {
    producer: string;
  };
}

export interface CurrentReleaseKitEvidenceAggregateCanonicalShape {
  schema_version: typeof CURRENT_RELEASE_KIT_EVIDENCE_AGGREGATE_CANONICAL_SCHEMA_VERSION;
  release_contract_digest: string;
  release_id: string;
  git_sha: string;
  release_kit_version: string;
  target: CurrentReleaseKitEvidenceTarget;
  summary_section: string;
  target_cluster: CurrentDeploymentTargetCluster;
  substrate_source: CurrentDeploymentSubstrateSource;
  distribution: CurrentDeploymentDistribution;
  status: 'passed' | 'failed';
  failure_class: string;
  evidence_root: string;
  canonical_writer: Required<Pick<
    CurrentReleaseKitCanonicalWriter,
    'gate_id' | 'line_kind' | 'npm_script' | 'native_result_path' | 'evidence_root' | 'summary_section'
  >>;
  artifact_provenance: Pick<
    CurrentArtifactProvenance,
    | 'provenance_kind'
    | 'producer_repo'
    | 'normalized_remote'
    | 'commit_sha'
    | 'subject_name'
    | 'subject_sha256'
    | 'subject_uri'
    | 'artifact_uri'
    | 'artifact_sha256'
    | 'generated_at'
    | 'generator_version'
  >;
}

export interface CurrentReleaseKitEvidenceAggregateDiagnostic {
  ok: boolean;
  canonical_shape: CurrentReleaseKitEvidenceAggregateCanonicalShape | null;
  failures: readonly CurrentReleaseBoundaryValidationFailure[];
}

export interface CurrentRunnerReleaseManifest {
  schema_version: typeof CURRENT_RUNNER_RELEASE_MANIFEST_SCHEMA_VERSION;
  runner: 'agentsmith-runner';
  release_id: string;
  git_sha: string;
  runner_contract_version: string;
  supported_protocol_versions: readonly string[];
  image: CurrentReleaseImage;
  artifact_provenance: CurrentArtifactProvenance;
}

export interface CurrentRunnerImageLock {
  schema_version: typeof CURRENT_RUNNER_IMAGE_LOCK_SCHEMA_VERSION;
  runner: 'agentsmith-runner';
  release_id: string;
  git_sha: string;
  runner_contract_version: string;
  runner_protocol_version: string;
  image: CurrentReleaseImage;
  manifest: {
    producer_repo: typeof RUNNER_CANONICAL_REPO;
    subject_sha256: string;
    artifact_sha256: string;
  };
}

export interface CurrentTruthMatrixEntry {
  truth: string;
  owner: string;
  physical_source: string;
  generator: string;
  validators: readonly string[];
  consumers: readonly string[];
  fail_fast: readonly string[];
}

export const CURRENT_RUNNER_ADAPTER_INVENTORY_REQUIRED_ITEM_IDS = [
  'local_kind_runner_image_build',
  'api_default_managed_runner_image',
  'internal_agent_pod_health_imageid_probe',
  'agent_task_runner_dev_script',
  'skills_diagnostics',
  'release_contract_runner_digest',
] as const;

export type CurrentRunnerAdapterInventoryItemId =
  (typeof CURRENT_RUNNER_ADAPTER_INVENTORY_REQUIRED_ITEM_IDS)[number];
export type CurrentRunnerAdapterInventoryOwnerRepo = 'agentsmith';
export type CurrentRunnerAdapterInventoryTargetRepo = 'agentsmith' | 'agentsmith-runner';

export interface CurrentRunnerAdapterInventorySourceBoundary {
  runner_repo_reads_agentsmith_source: false;
  release_kit_builds_runner_from_agentsmith_source: false;
  release_kit_builds_runner_from_runner_source: false;
}

export interface CurrentRunnerAdapterInventoryItem {
  id: CurrentRunnerAdapterInventoryItemId;
  current_paths: readonly string[];
  current_role: string;
  p5_target: string;
  migration_action: string;
  owner_repo: CurrentRunnerAdapterInventoryOwnerRepo;
  target_repo: CurrentRunnerAdapterInventoryTargetRepo;
  release_proof_allowed: false;
  forbidden_release_proof_reason: string;
  fail_fast_checks: readonly string[];
  source_boundary: CurrentRunnerAdapterInventorySourceBoundary;
}

export interface CurrentRunnerAdapterInventory {
  schema_version: typeof CURRENT_RUNNER_ADAPTER_INVENTORY_SCHEMA_VERSION;
  items: readonly CurrentRunnerAdapterInventoryItem[];
}

export interface CurrentRunnerAdapterInventoryValidationOptions {
  rootDir?: string;
  validateCurrentPaths?: boolean;
}

export const CURRENT_DEPLOYMENT_MODE_MATRIX: readonly CurrentDeploymentModeMatrixEntry[] = [
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'external_declared',
    distribution: 'online',
    support_level: 'primary',
    required_target: false,
  },
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'external_declared',
    distribution: 'airgap',
    support_level: 'primary',
    required_target: false,
  },
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'kit_installed',
    distribution: 'online',
    support_level: 'advanced',
    required_target: false,
  },
  {
    target_cluster: 'existing_kubernetes',
    substrate_source: 'kit_installed',
    distribution: 'airgap',
    support_level: 'advanced',
    required_target: false,
  },
  {
    target_cluster: 'kind_rehearsal',
    substrate_source: 'kit_installed',
    distribution: 'online',
    support_level: 'rehearsal',
    required_target: false,
  },
] as const;

export const CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX: readonly CurrentTruthMatrixEntry[] = [
  {
    truth: 'release_contract',
    owner: 'agentsmith',
    physical_source: 'AgentSmith CI artifact',
    generator: 'AgentSmith release contract generator',
    validators: ['release kit', 'AgentSmith release summary adapter'],
    consumers: ['agentsmith-release-kit'],
    fail_fast: [
      'missing_digest',
      'missing_provenance',
      'repo_identity_mismatch',
      'tag_only_image',
      'openapi_asyncapi_template_digest_drift',
    ],
  },
  {
    truth: 'deploy_template_package',
    owner: 'agentsmith',
    physical_source: 'AgentSmith CI artifact',
    generator: 'AgentSmith deploy template package generator',
    validators: ['AgentSmith release contract validator', 'agentsmith-release-kit source boundary guard'],
    consumers: ['agentsmith-release-kit render/check'],
    fail_fast: [
      'missing_package_uri',
      'missing_digest',
      'missing_provenance',
      'manifest_digest_mismatch',
      'release_kit_guesses_agentsmith_repo_path',
    ],
  },
  {
    truth: 'deploy_image_inventory',
    owner: 'agentsmith',
    physical_source: 'release contract deploy_image_inventory',
    generator: 'AgentSmith release contract generator',
    validators: ['release kit render checker', 'release kit smoke checker'],
    consumers: ['mirror', 'render', 'smoke'],
    fail_fast: [
      'rendered_workload_image_not_in_inventory',
      'target_registry_digest_mismatch',
      'live_image_id_mismatch',
    ],
  },
  {
    truth: 'substrate_connection_truth',
    owner: 'agentsmith-release-kit with AgentSmith-defined schema',
    physical_source: 'neutral substrate connection truth JSON',
    generator: 'kit_installed installer or external_declared validator',
    validators: ['render', 'apply', 'smoke', 'AgentSmith product flow producer'],
    consumers: ['release kit', 'AgentSmith product flows'],
    fail_fast: [
      'docker_truth_used_for_external_declared',
      'missing_endpoint_or_secret_ref',
      'missing_tls_or_sslmode',
      'missing_extension_check',
      'secret_leak',
    ],
  },
  {
    truth: 'release_kit_evidence',
    owner: 'agentsmith-release-kit',
    physical_source: 'release kit evidence root',
    generator: 'release kit commands',
    validators: ['AgentSmith release kit evidence adapter'],
    consumers: ['AgentSmith release summary adapter', 'operator runbook'],
    fail_fast: [
      'missing_input_digest',
      'missing_provenance',
      'stale_evidence',
      'writer_id_mismatch',
      'secret_leak',
    ],
  },
  {
    truth: 'runner_contract',
    owner: 'agentsmith shared-contract flow',
    physical_source: '@mbos/agent-runner-contract package (packages/agent-runner-contract/src) schema/types/fixtures',
    generator: 'AgentSmith runner contract sync from @mbos/agent-runner-contract',
    validators: ['AgentSmith API', 'agentsmith-runner', 'AsyncAPI checks'],
    consumers: ['AgentSmith API', 'agentsmith-runner'],
    fail_fast: [
      'asyncapi_drift',
      'legacy_field',
      'unsupported_protocol_version',
      'manual_type_copy',
    ],
  },
  {
    truth: 'runner_release_manifest',
    owner: 'agentsmith-runner',
    physical_source: 'runner repo CI artifact',
    generator: 'runner repo release workflow',
    validators: ['AgentSmith runner lock checker'],
    consumers: ['AgentSmith release contract generator'],
    fail_fast: [
      'missing_image_digest',
      'missing_provenance',
      'contract_version_incompatible',
      'producer_repo_not_agentsmith_runner',
    ],
  },
  {
    truth: 'runner_image_lock',
    owner: 'agentsmith',
    physical_source: 'agent-task-runner-image.lock',
    generator: 'AgentSmith adoption PR',
    validators: ['AgentSmith release contract generator', 'backend-real'],
    consumers: ['AgentSmith backend-real', 'release contract generator'],
    fail_fast: [
      'lock_manifest_digest_mismatch',
      'lock_release_contract_digest_mismatch',
    ],
  },
] as const;

export const CURRENT_RELEASE_KIT_EVIDENCE_MAPPING: readonly CurrentReleaseKitEvidenceMappingEntry[] = [
  {
    release_kit_output: 'deploy-result.json#substrate',
    target: 'dependencies',
    canonical_writer: {
      gate_id: 'lane-unified-deploy-substrate',
      line_kind: 'unified_deploy_substrate',
      npm_script: 'lane:unified-deploy:substrate',
      native_result_path: '<campaign-root>/lane-unified-deploy-substrate/native/result.json',
      evidence_root: '<campaign-root>/unified-deploy/substrate',
      summary_section: 'dependencies',
    },
    canonical_evidence_owner: 'agentsmith-release-kit',
    current_campaign_target_clusters: ['kind_rehearsal'],
    reject_conditions: [
      'missing_native_result',
      'missing_release_contract_digest',
      'profile_mismatch',
      'external_declared_uses_docker_truth',
    ],
  },
  {
    release_kit_output: 'image-map.json',
    target: 'images',
    canonical_writer: {
      gate_id: 'lane-unified-deploy-local-kind-images',
      line_kind: 'unified_deploy_local_kind_images',
      npm_script: 'lane:unified-deploy:local-kind:images',
      native_result_path: '<campaign-root>/lane-unified-deploy-local-kind-images/native/result.json',
      evidence_root: '<campaign-root>/unified-deploy/local-kind-images',
      summary_section: 'images',
    },
    canonical_evidence_owner: 'agentsmith-release-kit',
    current_campaign_target_clusters: ['kind_rehearsal'],
    reject_conditions: [
      'tag_only_image',
      'digest_mismatch',
      'local_kind_used_for_existing_kubernetes',
    ],
  },
  {
    release_kit_output: 'render-report.json+rollout-report.json',
    target: 'rollout',
    canonical_writer: {
      gate_id: 'lane-unified-deploy-local-kind',
      line_kind: 'unified_deploy_local_kind',
      npm_script: 'lane:unified-deploy:local-kind',
      native_result_path: '<campaign-root>/lane-unified-deploy-local-kind/native/result.json',
      evidence_root: '<campaign-root>/unified-deploy/local-kind',
      summary_section: 'rollout',
    },
    canonical_evidence_owner: 'agentsmith-release-kit',
    current_campaign_target_clusters: ['kind_rehearsal'],
    reject_conditions: [
      'rendered_inventory_mismatch',
      'missing_live_image_id',
      'target_digest_mismatch',
      'local_kind_used_for_existing_kubernetes',
    ],
  },
  {
    release_kit_output: 'AgentSmith product flow aggregate',
    target: 'product_flows',
    canonical_writer: {
      gate_id: 'lane-unified-deploy-product-flows',
      line_kind: 'unified_deploy_product_flows',
      npm_script: 'lane:unified-deploy:product-flows',
      native_result_path: '<campaign-root>/lane-unified-deploy-product-flows/native/result.json',
      evidence_root: '<campaign-root>/unified-deploy/product-flows',
      summary_section: 'product flows',
    },
    canonical_evidence_owner: 'agentsmith',
    current_campaign_target_clusters: ['kind_rehearsal', 'existing_kubernetes'],
    expected_product_flow_producer: 'unified-deploy-product-flows',
    reject_conditions: [
      'release_kit_forged_product_flow_evidence',
      'missing_required_product_flow',
      'docker_defaults_used_for_external_declared',
    ],
  },
] as const;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const PLAIN_SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const IMAGE_DIGEST_SUFFIX_PATTERN = /@(sha256:[0-9a-f]{64})$/u;
const MODE_KEY_SET = new Set(CURRENT_DEPLOYMENT_MODE_MATRIX.map((entry) => modeKey(
  entry.target_cluster,
  entry.substrate_source,
  entry.distribution,
)));
const RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_KEY_SET = new Set(
  CURRENT_RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_TUPLES.map((entry) => modeKey(
    entry.target_cluster,
    entry.substrate_source,
    entry.distribution,
  )),
);
const TARGET_CLUSTER_SET = new Set<string>(CURRENT_DEPLOYMENT_TARGET_CLUSTERS);
const SUBSTRATE_SOURCE_SET = new Set<string>(CURRENT_DEPLOYMENT_SUBSTRATE_SOURCES);
const DISTRIBUTION_SET = new Set<string>(CURRENT_DEPLOYMENT_DISTRIBUTIONS);
const RELEASE_KIT_TARGET_SET = new Set<string>([
  'dependencies',
  'images',
  'rollout',
  'product_flows',
] satisfies CurrentReleaseKitEvidenceTarget[]);
const INVENTORY_SOURCE_SET = new Set<string>([
  'product_images',
  'adopted_provider_images',
  'release_kit_prerequisite_images',
] satisfies CurrentReleaseInventoryImage['source'][]);
const REQUIRED_TRUTH_IDS = [
  'release_contract',
  'deploy_template_package',
  'deploy_image_inventory',
  'substrate_connection_truth',
  'release_kit_evidence',
  'runner_contract',
  'runner_release_manifest',
  'runner_image_lock',
] as const;
const RUNNER_ADAPTER_ITEM_ID_SET = new Set<string>(CURRENT_RUNNER_ADAPTER_INVENTORY_REQUIRED_ITEM_IDS);
const RUNNER_ADAPTER_TARGET_REPO_SET = new Set<string>(['agentsmith', 'agentsmith-runner']);
const RUNNER_ADAPTER_SOURCE_BOUNDARY_FIELDS = [
  'runner_repo_reads_agentsmith_source',
  'release_kit_builds_runner_from_agentsmith_source',
  'release_kit_builds_runner_from_runner_source',
] as const;
const RUNNER_ADAPTER_FORBIDDEN_FAIL_FAST_CHECKS = new Set<string>([
  'runner_manifest_lock_contract_digest_match',
]);
const DOCKER_SUBSTRATE_TRUTH_SCHEMA = 'agentsmith.docker-substrate.truth/v1';
const LEGACY_DOCKER_SUBSTRATE_TRUTH_SCHEMA = 'docker-substrate.truth/v1';
const DOCKER_SUBSTRATE_TRUTH_SCHEMAS = new Set<string>([
  DOCKER_SUBSTRATE_TRUTH_SCHEMA,
  LEGACY_DOCKER_SUBSTRATE_TRUTH_SCHEMA,
]);
const SUBSTRATE_CONNECTION_REQUIRED_SERVICES = [
  'postgresql',
  'mongodb',
  'redis',
  'object_storage',
  'oidc',
] as const;
const LEGACY_TOP_LEVEL_SUBSTRATE_SERVICE_KEYS = [
  'postgres',
  ...SUBSTRATE_CONNECTION_REQUIRED_SERVICES,
] as const;
const SUBSTRATE_REACHABILITY_STATUS_SET = new Set<string>([
  'declared_reachable',
  'verified_by_operator',
  'reachable',
  'passed',
]);
const POSTGRES_VECTOR_STATUS_SET = new Set<string>([
  'installed',
  'enabled',
  'available',
]);
const DOCKER_DEFAULT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'postgres',
  'postgresql',
  'mongo',
  'mongodb',
  'redis',
  'minio',
  'keycloak',
]);
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /\b(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|client[_-]?secret|secret[_-]?access[_-]?key|access[_-]?key|password|token|secret)["']?\s*[:=]\s*["']?[^"',\s]+/iu,
  /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]+/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:postgres(?:ql)?|mongodb|redis):\/\/[^:\s/]+:[^@\s]+@/iu,
  /\bkind:\s*Config\b[\s\S]*\bclusters:/iu,
  /managed_credentials\./u,
] as const;
const SECRET_FIELD_NAME_PATTERN =
  /(?:^|_)(?:client_secret|secret|password|token|credential|kubeconfig|private_key|access_key|api_key|database_url|mongodb_uri|redis_url)(?:_|$)/iu;
const SECRET_REFERENCE_FIELD_PATTERN = /(?:_ref|_refs|secret_ref|secret_refs)$/iu;
const SAFE_SECRET_REFERENCE_SENTINELS = new Set([
  'not_required',
  'operator_secret_ref',
]);
const SECRET_REF_PREFIX = 'secretRef:';
const GITHUB_REMOTE_PATTERN = /^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const RELEASE_KIT_EVIDENCE_SUBJECT_ALLOWED_KEYS = new Set(['schema_version', 'files']);
const RELEASE_KIT_EVIDENCE_SUBJECT_FILE_ALLOWED_KEYS = new Set(['path', 'sha256']);
const RUNNER_IMAGE_LOCK_KEYS = new Set([
  'schema_version',
  'runner',
  'release_id',
  'git_sha',
  'runner_contract_version',
  'runner_protocol_version',
  'image_id',
  'image',
  'image_digest',
  'manifest_producer_repo',
  'manifest_subject_sha256',
  'manifest_artifact_sha256',
]);

type ImageRegistry = Map<string, CurrentReleaseImage & { source: CurrentReleaseInventoryImage['source'] }>;

type ArtifactProvenanceValidationOptions = {
  path: string;
  expectedRepo: string;
  expectedSubjectName: string;
  subject: unknown;
  fullSubjectContainer: unknown;
  allowedKinds: readonly CurrentArtifactProvenanceKind[];
};

export function canonicalReleaseBoundaryJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function sha256Digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function normalizeReleaseBoundaryRemote(remote: string): string | null {
  const trimmed = remote.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed
    .replace(/^https:\/\/github\.com\//iu, 'github.com/')
    .replace(/^git@github\.com:/iu, 'github.com/')
    .replace(/^ssh:\/\/git@github\.com\//iu, 'github.com/')
    .replace(/\.git$/iu, '');

  return GITHUB_REMOTE_PATTERN.test(normalized) ? normalized : null;
}

export function parseRunnerImageLockText(
  source: string,
  sourceName = 'agent-task-runner-image.lock',
): CurrentReleaseBoundaryValidationResult<CurrentRunnerImageLock> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(source, 'runner_image_lock', failures);

  const values: Record<string, string> = {};
  source.split(/\r?\n/u).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      return;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      failures.push({
        path: `runner_image_lock:${index + 1}`,
        reason: `${sourceName}:${index + 1} must be key=value.`,
      });
      return;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!RUNNER_IMAGE_LOCK_KEYS.has(key)) {
      failures.push({
        path: `runner_image_lock.${key}`,
        reason: `${sourceName}:${index + 1} contains unsupported key ${key}.`,
      });
      return;
    }
    if (values[key] !== undefined) {
      failures.push({
        path: `runner_image_lock.${key}`,
        reason: `${sourceName}:${index + 1} must not duplicate ${key}.`,
      });
      return;
    }

    values[key] = value;
  });

  const lock = {
    schema_version: values.schema_version,
    runner: values.runner,
    release_id: values.release_id,
    git_sha: values.git_sha,
    runner_contract_version: values.runner_contract_version,
    runner_protocol_version: values.runner_protocol_version,
    image: {
      id: values.image_id,
      image: values.image,
      digest: values.image_digest,
    },
    manifest: {
      producer_repo: values.manifest_producer_repo,
      subject_sha256: values.manifest_subject_sha256,
      artifact_sha256: values.manifest_artifact_sha256,
    },
  };

  const validation = validateRunnerImageLock(lock);
  if (!validation.ok) {
    failures.push(...validation.failures);
  }

  return finish(lock as CurrentRunnerImageLock, failures);
}

export function validateAgentSmithReleaseContract(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<CurrentAgentSmithReleaseContract> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(value, 'release_contract', failures);

  if (!isRecord(value)) {
    return invalid('release_contract', 'release contract must be an object.', failures);
  }

  validateLiteral(value.schema_version, CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION, 'schema_version', failures);
  validateLiteral(value.product, 'agentsmith', 'product', failures);
  validateRequiredString(value.release_id, 'release_id', failures);
  const gitSha = validateGitSha(value.git_sha, 'git_sha', failures);
  const deployTemplateDigest = validateDigest(value.deploy_template_digest, 'deploy_template_digest', failures);
  validateDigest(value.openapi_digest, 'openapi_digest', failures);
  validateDigest(value.asyncapi_digest, 'asyncapi_digest', failures);
  validateLiteral(
    value.substrate_connection_schema,
    CURRENT_SUBSTRATE_CONNECTION_SCHEMA_VERSION,
    'substrate_connection_schema',
    failures,
  );
  validatePlainSemver(value.min_release_kit_version, 'min_release_kit_version', failures);

  const imageRegistry: ImageRegistry = new Map();
  validateImageArray(value.product_images, 'product_images', 'product_images', imageRegistry, failures);
  validateImageArray(
    value.adopted_provider_images,
    'adopted_provider_images',
    'adopted_provider_images',
    imageRegistry,
    failures,
  );
  validateImageArray(
    value.release_kit_prerequisite_images,
    'release_kit_prerequisite_images',
    'release_kit_prerequisite_images',
    imageRegistry,
    failures,
  );
  validateDeployImageInventory(value.deploy_image_inventory, imageRegistry, failures);
  validateReleaseContractDeployTemplatePackage(value, deployTemplateDigest, gitSha, failures);
  validateRequiredProductFlows(value.required_product_flows, 'required_product_flows', failures);
  validateTargetProfiles(value.target_profiles, failures);

  if (!hasOwn(value, 'artifact_provenance')) {
    failures.push({
      path: 'artifact_provenance',
      reason: 'artifact_provenance is required.',
    });
  } else {
    validateArtifactProvenanceInto(value.artifact_provenance, {
      path: 'artifact_provenance',
      expectedRepo: AGENTSMITH_CANONICAL_REPO,
      expectedSubjectName: 'agentsmith-release-contract',
      subject: omitRecordKey(value, 'artifact_provenance'),
      fullSubjectContainer: value,
      allowedKinds: ['ci_artifact'],
    }, failures);
    validateReleaseContractProvenanceCommitSha(value, gitSha, failures);
    validateReleaseContractArtifactProjectionDigest(value, failures);
  }

  return finish(value as CurrentAgentSmithReleaseContract, failures);
}

function validateReleaseContractProvenanceCommitSha(
  value: Record<string, unknown>,
  gitSha: string | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!gitSha || !isRecord(value.artifact_provenance)) {
    return;
  }

  const commitSha = value.artifact_provenance.commit_sha;
  if (typeof commitSha === 'string' && GIT_SHA_PATTERN.test(commitSha) && commitSha !== gitSha) {
    failures.push({
      path: 'artifact_provenance.commit_sha',
      reason: 'artifact_provenance.commit_sha must match git_sha.',
    });
  }
}

function validateReleaseContractArtifactProjectionDigest(
  value: Record<string, unknown>,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const provenance = value.artifact_provenance;
  if (!isRecord(provenance)) {
    return;
  }

  const artifactSha256 = provenance.artifact_sha256;
  if (typeof artifactSha256 !== 'string' || !DIGEST_PATTERN.test(artifactSha256)) {
    return;
  }

  const expectedArtifactSha256 = sha256Digest(
    canonicalReleaseBoundaryJson(omitReleaseContractArtifactSha256ForProjection(value)),
  );
  if (artifactSha256 !== expectedArtifactSha256) {
    failures.push({
      path: 'artifact_provenance.artifact_sha256',
      reason: `artifact projection mismatch: artifact_provenance.artifact_sha256 must match ${expectedArtifactSha256}.`,
    });
  }
}

function omitReleaseContractArtifactSha256ForProjection(value: Record<string, unknown>): unknown {
  const clone = structuredClone(value);
  const provenance = clone.artifact_provenance;
  if (isRecord(provenance)) {
    delete provenance.artifact_sha256;
  }

  return clone;
}

export function validateDeployTemplatePackage(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<CurrentDeployTemplatePackage> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(value, 'deploy_template_package', failures);

  if (!isRecord(value)) {
    return invalid('deploy_template_package', 'deploy template package must be an object.', failures);
  }

  validateLiteral(value.schema_version, CURRENT_DEPLOY_TEMPLATE_PACKAGE_SCHEMA_VERSION, 'schema_version', failures);
  const packageUri = validateRequiredString(value.package_uri, 'package_uri', failures);
  validateRemoteCiArtifactUri(packageUri, 'package_uri', failures);
  const packageSha256 = validateDigest(value.package_sha256, 'package_sha256', failures);
  validateDigest(value.manifest_sha256, 'manifest_sha256', failures);

  if (!hasOwn(value, 'artifact_provenance')) {
    failures.push({
      path: 'artifact_provenance',
      reason: 'artifact_provenance is required.',
    });
  } else {
    validateArtifactProvenanceInto(value.artifact_provenance, {
      path: 'artifact_provenance',
      expectedRepo: AGENTSMITH_CANONICAL_REPO,
      expectedSubjectName: 'agentsmith-deploy-template-package',
      subject: omitRecordKey(value, 'artifact_provenance'),
      fullSubjectContainer: value,
      allowedKinds: ['ci_artifact'],
    }, failures);
  }

  if (isRecord(value.artifact_provenance)) {
    if (packageUri && value.artifact_provenance.artifact_uri !== packageUri) {
      failures.push({
        path: 'artifact_provenance.artifact_uri',
        reason: 'artifact_provenance.artifact_uri must match package_uri.',
      });
    }
    if (packageSha256 && value.artifact_provenance.artifact_sha256 !== packageSha256) {
      failures.push({
        path: 'artifact_provenance.artifact_sha256',
        reason: 'artifact_provenance.artifact_sha256 must match package_sha256.',
      });
    }
  }

  return finish(value as CurrentDeployTemplatePackage, failures);
}

export function validateSubstrateConnectionTruth(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<Record<string, unknown>> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(value, 'substrate_connection_truth', failures);

  if (!isRecord(value)) {
    return invalid('substrate_connection_truth', 'substrate connection truth must be an object.', failures);
  }

  validateLiteral(value.schema_version, CURRENT_SUBSTRATE_CONNECTION_SCHEMA_VERSION, 'schema_version', failures);
  const targetCluster = validateEnum(
    value.target_cluster,
    TARGET_CLUSTER_SET,
    'target_cluster',
    'target_cluster is not in the release boundary matrix.',
    failures,
  ) as CurrentDeploymentTargetCluster | undefined;
  const source = validateEnum(
    value.substrate_source,
    SUBSTRATE_SOURCE_SET,
    'substrate_source',
    'substrate_source is not in the release boundary matrix.',
    failures,
  ) as CurrentDeploymentSubstrateSource | undefined;
  const distribution = validateEnum(
    value.distribution,
    DISTRIBUTION_SET,
    'distribution',
    'distribution is not in the release boundary matrix.',
    failures,
  ) as CurrentDeploymentDistribution | undefined;

  if (targetCluster && source && distribution && !MODE_KEY_SET.has(modeKey(targetCluster, source, distribution))) {
    failures.push({
      path: 'target_cluster',
      reason: 'deployment mode is not allowed by the release boundary matrix.',
    });
  }

  validateNoExternalDeclaredDockerTruth(value.schema_version, 'schema_version', source, failures);
  validateNoExternalDeclaredDockerTruth(value.source_truth_schema, 'source_truth_schema', source, failures);
  validateNoExternalDeclaredDockerTruth(value.kit_truth_source, 'kit_truth_source', source, failures);

  if (source === 'external_declared') {
    validateRequiredString(value.declared_by, 'declared_by', failures);
  }
  if (source === 'kit_installed') {
    validateLiteral(value.installed_by, 'agentsmith-release-kit', 'installed_by', failures);
    validatePlainSemver(value.release_kit_version, 'release_kit_version', failures);
  }

  validateNoLegacyTopLevelSubstrateServiceKeys(value, failures);

  const services = validateSubstrateServicesObject(value.services, failures);
  if (services) {
    validatePostgresTruth(services.postgresql, 'services.postgresql', source, failures);
    validateMongoTruth(services.mongodb, 'services.mongodb', source, failures);
    validateRedisTruth(services.redis, 'services.redis', source, failures);
    validateObjectStorageTruth(services.object_storage, 'services.object_storage', source, failures);
    validateOidcTruth(services.oidc, 'services.oidc', source, failures);
  }
  if (hasOwn(value, 'product_flow_probe_secret_refs')) {
    validateProductFlowProbeRefs(value.product_flow_probe_secret_refs, failures);
  }
  validateRedactedFingerprint(value.redacted_fingerprint, 'redacted_fingerprint', failures);

  return finish(value, failures);
}

export function validateReleaseKitEvidence(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<CurrentReleaseKitEvidence> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(value, 'release_kit_evidence', failures);

  if (!isRecord(value)) {
    return invalid('release_kit_evidence', 'release kit evidence must be an object.', failures);
  }

  validateLiteral(value.schema_version, CURRENT_RELEASE_KIT_EVIDENCE_SCHEMA_VERSION, 'schema_version', failures);
  validateDigest(value.release_contract_digest, 'release_contract_digest', failures);
  validateRequiredString(value.release_id, 'release_id', failures);
  validateGitSha(value.git_sha, 'git_sha', failures);
  validatePlainSemver(value.release_kit_version, 'release_kit_version', failures);
  const targetCluster = validateEnum(
    value.target_cluster,
    TARGET_CLUSTER_SET,
    'target_cluster',
    'target_cluster is not in the release boundary matrix.',
    failures,
  ) as CurrentDeploymentTargetCluster | undefined;
  const substrateSource = validateEnum(
    value.substrate_source,
    SUBSTRATE_SOURCE_SET,
    'substrate_source',
    'substrate_source is not in the release boundary matrix.',
    failures,
  ) as CurrentDeploymentSubstrateSource | undefined;
  const distribution = validateEnum(
    value.distribution,
    DISTRIBUTION_SET,
    'distribution',
    'distribution is not in the release boundary matrix.',
    failures,
  ) as CurrentDeploymentDistribution | undefined;
  const target = validateEnum(
    value.target,
    RELEASE_KIT_TARGET_SET,
    'target',
    'target must be one release summary section string.',
    failures,
  ) as CurrentReleaseKitEvidenceTarget | undefined;
  const status = validateEnum(
    value.status,
    new Set(['passed', 'failed']),
    'status',
    'status must be passed or failed.',
    failures,
  ) as CurrentReleaseKitEvidence['status'] | undefined;
  const failureClass = validateRequiredString(value.failure_class, 'failure_class', failures);
  validateReleaseKitStatusFailureClass(status, failureClass, failures);
  validateRequiredString(value.evidence_root, 'evidence_root', failures);

  if (targetCluster && substrateSource && distribution && !MODE_KEY_SET.has(modeKey(targetCluster, substrateSource, distribution))) {
    failures.push({
      path: 'target_cluster',
      reason: 'deployment mode is not allowed by the release boundary matrix.',
    });
  }

  validateCanonicalWriter(value.canonical_writer, 'canonical_writer', failures);
  validateEvidenceMappingCompatibility(value, target, targetCluster, failures);
  validateReleaseKitSubstrateConnectionTruth(value, targetCluster, substrateSource, distribution, failures);

  const evidenceSubject = value.evidence_subject;
  const evidenceSubjectRecord = validateReleaseKitEvidenceSubject(evidenceSubject, 'evidence_subject', failures);

  if (target === 'product_flows') {
    failures.push({
      path: 'target',
      reason: 'product_flows release-kit evidence is not accepted in P0; use AgentSmith native product-flow evidence.',
    });
  }

  if (!hasOwn(value, 'artifact_provenance')) {
    failures.push({
      path: 'artifact_provenance',
      reason: 'artifact_provenance is required.',
    });
  } else if (evidenceSubjectRecord) {
    validateArtifactProvenanceInto(value.artifact_provenance, {
      path: 'artifact_provenance',
      expectedRepo: target === 'product_flows' ? AGENTSMITH_CANONICAL_REPO : RELEASE_KIT_CANONICAL_REPO,
      expectedSubjectName: target === 'product_flows' ? 'agentsmith-product-flow-evidence' : 'release-kit-evidence-subject',
      subject: evidenceSubjectRecord,
      fullSubjectContainer: value,
      allowedKinds: target === 'product_flows' ? ['ci_artifact'] : ['ci_artifact', 'signed_operator_run'],
    }, failures);
  }

  return finish(value as CurrentReleaseKitEvidence, failures);
}

function validateReleaseKitStatusFailureClass(
  status: CurrentReleaseKitEvidence['status'] | undefined,
  failureClass: string | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!status || !failureClass) {
    return;
  }

  if (status === 'passed' && failureClass !== 'none') {
    failures.push({
      path: 'failure_class',
      reason: 'passed release kit evidence must use failure_class none.',
    });
  }
  if (status === 'failed' && failureClass === 'none') {
    failures.push({
      path: 'failure_class',
      reason: 'failed release kit evidence must use a non-none failure_class.',
    });
  }
}

export function diagnoseReleaseKitEvidenceForAggregate(
  value: unknown,
): CurrentReleaseKitEvidenceAggregateDiagnostic {
  const result = validateReleaseKitEvidence(value);
  if (!result.ok) {
    return {
      ok: false,
      canonical_shape: null,
      failures: result.failures,
    };
  }

  const canonicalShape = buildReleaseKitEvidenceAggregateCanonicalShape(result.value);
  if (canonicalShape === null) {
    return {
      ok: false,
      canonical_shape: null,
      failures: [
        {
          path: 'target',
          reason: 'release kit evidence mapping is missing for target.',
        },
      ],
    };
  }

  return {
    ok: true,
    canonical_shape: canonicalShape,
    failures: [],
  };
}

export function validateReleaseKitEvidenceForAggregate(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<CurrentReleaseKitEvidenceAggregateCanonicalShape> {
  const diagnostic = diagnoseReleaseKitEvidenceForAggregate(value);
  if (!diagnostic.ok || diagnostic.canonical_shape === null) {
    return {
      ok: false,
      failures: diagnostic.failures,
    };
  }

  return {
    ok: true,
    value: diagnostic.canonical_shape,
  };
}

export function validateRunnerReleaseManifest(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<CurrentRunnerReleaseManifest> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(value, 'runner_release_manifest', failures);

  if (!isRecord(value)) {
    return invalid('runner_release_manifest', 'runner release manifest must be an object.', failures);
  }

  validateLiteral(value.schema_version, CURRENT_RUNNER_RELEASE_MANIFEST_SCHEMA_VERSION, 'schema_version', failures);
  validateLiteral(value.runner, 'agentsmith-runner', 'runner', failures);
  validateRequiredString(value.release_id, 'release_id', failures);
  validateGitSha(value.git_sha, 'git_sha', failures);
  validateRunnerContractVersion(value.runner_contract_version, failures);
  const supportedProtocolVersions = validateStringArray(
    value.supported_protocol_versions,
    'supported_protocol_versions',
    failures,
  );
  if (
    supportedProtocolVersions
    && (
      supportedProtocolVersions.length !== 1
      || supportedProtocolVersions[0] !== CURRENT_RUNNER_PROTOCOL_VERSION
    )
  ) {
    failures.push({
      path: 'supported_protocol_versions',
      reason: `supported_protocol_versions must exactly equal ${JSON.stringify([CURRENT_RUNNER_PROTOCOL_VERSION])}.`,
    });
  }
  validateImageRecord(value.image, 'image', failures);

  if (!hasOwn(value, 'artifact_provenance')) {
    failures.push({
      path: 'artifact_provenance',
      reason: 'artifact_provenance is required.',
    });
  } else {
    validateArtifactProvenanceInto(value.artifact_provenance, {
      path: 'artifact_provenance',
      expectedRepo: RUNNER_CANONICAL_REPO,
      expectedSubjectName: 'runner-release-manifest',
      subject: omitRecordKey(value, 'artifact_provenance'),
      fullSubjectContainer: value,
      allowedKinds: ['ci_artifact'],
    }, failures);
  }

  return finish(value as CurrentRunnerReleaseManifest, failures);
}

export function validateRunnerImageLock(
  value: unknown,
): CurrentReleaseBoundaryValidationResult<CurrentRunnerImageLock> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(value, 'runner_image_lock', failures);

  if (!isRecord(value)) {
    return invalid('runner_image_lock', 'runner image lock must be an object.', failures);
  }

  validateLiteral(value.schema_version, CURRENT_RUNNER_IMAGE_LOCK_SCHEMA_VERSION, 'schema_version', failures);
  validateLiteral(value.runner, 'agentsmith-runner', 'runner', failures);
  validateRequiredString(value.release_id, 'release_id', failures);
  validateGitSha(value.git_sha, 'git_sha', failures);
  validateRunnerContractVersion(value.runner_contract_version, failures);
  const protocolVersion = validateRequiredString(value.runner_protocol_version, 'runner_protocol_version', failures);
  if (protocolVersion && protocolVersion !== CURRENT_RUNNER_PROTOCOL_VERSION) {
    failures.push({
      path: 'runner_protocol_version',
      reason: `runner_protocol_version must exactly equal ${JSON.stringify(CURRENT_RUNNER_PROTOCOL_VERSION)}.`,
    });
  }
  validateImageRecord(value.image, 'image', failures);

  if (!hasOwn(value, 'manifest')) {
    failures.push({
      path: 'manifest',
      reason: 'manifest is required.',
    });
  } else {
    validateRunnerImageLockManifest(value.manifest, failures);
  }

  return finish(value as CurrentRunnerImageLock, failures);
}

export function validateTruthMatrix(
  value: unknown = CURRENT_RELEASE_BOUNDARY_TRUTH_MATRIX,
): CurrentReleaseBoundaryValidationResult<readonly CurrentTruthMatrixEntry[]> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(value, 'truth_matrix', failures);

  if (!Array.isArray(value)) {
    return invalid('truth_matrix', 'truth matrix must be an array.', failures);
  }

  const seenTruthIds = new Set<string>();
  value.forEach((entry, index) => {
    const path = `truth_matrix[${index}]`;
    if (!isRecord(entry)) {
      failures.push({ path, reason: 'truth matrix entry must be an object.' });
      return;
    }

    const truth = validateRequiredString(entry.truth, `${path}.truth`, failures);
    if (truth) {
      if (seenTruthIds.has(truth)) {
        failures.push({
          path: `${path}.truth`,
          reason: `truth matrix truth "${truth}" is declared more than once.`,
        });
      }
      seenTruthIds.add(truth);
    }
    validateRequiredString(entry.owner, `${path}.owner`, failures);
    const physicalSource = validateRequiredString(entry.physical_source, `${path}.physical_source`, failures);
    const generator = validateRequiredString(entry.generator, `${path}.generator`, failures);
    validateStringArray(entry.validators, `${path}.validators`, failures);
    validateStringArray(entry.consumers, `${path}.consumers`, failures);
    validateStringArray(entry.fail_fast, `${path}.fail_fast`, failures);
    if (Array.isArray(entry.fail_fast) && entry.fail_fast.length === 0) {
      failures.push({
        path: `${path}.fail_fast`,
        reason: 'truth matrix entry must declare fail-fast conditions.',
      });
    }
    if (truth === 'runner_contract') {
      validateCurrentRunnerContractTruthMatrixEntry(path, physicalSource, generator, failures);
    }
  });

  for (const truthId of REQUIRED_TRUTH_IDS) {
    if (!seenTruthIds.has(truthId)) {
      failures.push({
        path: 'truth_matrix',
        reason: `truth matrix is missing "${truthId}".`,
      });
    }
  }

  return finish(value as readonly CurrentTruthMatrixEntry[], failures);
}

function validateCurrentRunnerContractTruthMatrixEntry(
  path: string,
  physicalSource: string | undefined,
  generator: string | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (physicalSource) {
    if (/(?:@mbos\/agent-runner(?!-contract)(?:\b|$)|packages\/agent-runner(?!-contract)(?:\/src)?\b)/u.test(physicalSource)) {
      failures.push({
        path: `${path}.physical_source`,
        reason: 'runner_contract physical_source must point to @mbos/agent-runner-contract, not @mbos/agent-runner.',
      });
    }
    if (!/(?:@mbos\/agent-runner-contract\b|packages\/agent-runner-contract(?:\/src)?\b)/u.test(physicalSource)) {
      failures.push({
        path: `${path}.physical_source`,
        reason: 'runner_contract physical_source must point to @mbos/agent-runner-contract.',
      });
    }
  }

  if (generator && !/@mbos\/agent-runner-contract/u.test(generator)) {
    failures.push({
      path: `${path}.generator`,
      reason: 'runner_contract generator must use @mbos/agent-runner-contract as the contract source.',
    });
  }
}

export function validateReleaseKitEvidenceMapping(
  value: unknown = CURRENT_RELEASE_KIT_EVIDENCE_MAPPING,
): CurrentReleaseBoundaryValidationResult<readonly CurrentReleaseKitEvidenceMappingEntry[]> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(value, 'release_kit_evidence_mapping', failures);

  if (!Array.isArray(value)) {
    return invalid('release_kit_evidence_mapping', 'release kit evidence mapping must be an array.', failures);
  }

  const seenTargets = new Set<string>();
  const seenCanonicalWriters = new Set<string>();
  value.forEach((entry, index) => {
    const path = `release_kit_evidence_mapping[${index}]`;
    if (!isRecord(entry)) {
      failures.push({ path, reason: 'release kit evidence mapping entry must be an object.' });
      return;
    }

    validateRequiredString(entry.release_kit_output, `${path}.release_kit_output`, failures);
    const target = validateEnum(
      entry.target,
      RELEASE_KIT_TARGET_SET,
      `${path}.target`,
      'release kit evidence target is not supported.',
      failures,
    );
    if (target) {
      if (seenTargets.has(target)) {
        failures.push({
          path: `${path}.target`,
          reason: `release kit evidence target "${target}" is declared more than once.`,
        });
      }
      seenTargets.add(target);
    }
    validateCanonicalWriter(entry.canonical_writer, `${path}.canonical_writer`, failures);

    if (
      isRecord(entry.canonical_writer)
      && typeof entry.canonical_writer.gate_id === 'string'
      && typeof entry.canonical_writer.line_kind === 'string'
    ) {
      const canonicalWriterKey = `${entry.canonical_writer.gate_id}|${entry.canonical_writer.line_kind}`;
      if (seenCanonicalWriters.has(canonicalWriterKey)) {
        failures.push({
          path: `${path}.canonical_writer`,
          reason: `canonical writer "${canonicalWriterKey}" is declared more than once.`,
        });
      }
      seenCanonicalWriters.add(canonicalWriterKey);
    }

    const writer = isRecord(entry.canonical_writer) && typeof entry.canonical_writer.gate_id === 'string'
      ? findCurrentGateDefinitionById(entry.canonical_writer.gate_id)
      : undefined;
    if (!writer && isRecord(entry.canonical_writer) && typeof entry.canonical_writer.gate_id === 'string') {
      failures.push({
        path: `${path}.canonical_writer.gate_id`,
        reason: 'canonical writer gate_id does not exist.',
      });
    }
    if (writer && isRecord(entry.canonical_writer) && typeof entry.canonical_writer.npm_script === 'string') {
      if (writer.npmScript !== entry.canonical_writer.npm_script) {
        failures.push({
          path: `${path}.canonical_writer.npm_script`,
          reason: 'canonical writer npm_script does not match current gate manifest.',
        });
      }
    }

    validateEnum(
      entry.canonical_evidence_owner,
      new Set(['agentsmith', 'agentsmith-release-kit']),
      `${path}.canonical_evidence_owner`,
      'canonical evidence owner must be agentsmith or agentsmith-release-kit.',
      failures,
    );
    const targetClusters = validateStringArray(
      entry.current_campaign_target_clusters,
      `${path}.current_campaign_target_clusters`,
      failures,
    );
    targetClusters?.forEach((targetCluster, clusterIndex) => {
      validateEnum(
        targetCluster,
        TARGET_CLUSTER_SET,
        `${path}.current_campaign_target_clusters[${clusterIndex}]`,
        'target_cluster is not in the release boundary matrix.',
        failures,
      );
    });
    validateStringArray(entry.reject_conditions, `${path}.reject_conditions`, failures);

    if (entry.target === 'product_flows') {
      if (entry.canonical_evidence_owner !== 'agentsmith') {
        failures.push({
          path: `${path}.canonical_evidence_owner`,
          reason: 'product flow canonical evidence must be produced by AgentSmith.',
        });
      }
      if (entry.expected_product_flow_producer !== 'unified-deploy-product-flows') {
        failures.push({
          path: `${path}.expected_product_flow_producer`,
          reason: 'product flow canonical evidence must be produced by AgentSmith.',
        });
      }
    }
  });

  for (const target of RELEASE_KIT_TARGET_SET) {
    if (!seenTargets.has(target)) {
      failures.push({
        path: 'release_kit_evidence_mapping',
        reason: `release kit evidence mapping is missing "${target}".`,
      });
    }
  }

  return finish(value as readonly CurrentReleaseKitEvidenceMappingEntry[], failures);
}

export function validateRunnerAdapterInventory(
  value: unknown,
  options: CurrentRunnerAdapterInventoryValidationOptions = {},
): CurrentReleaseBoundaryValidationResult<CurrentRunnerAdapterInventory> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateNoSecretLeak(value, 'runner_adapter_inventory', failures);

  if (!isRecord(value)) {
    return invalid('runner_adapter_inventory', 'runner adapter inventory must be an object.', failures);
  }

  validateLiteral(
    value.schema_version,
    CURRENT_RUNNER_ADAPTER_INVENTORY_SCHEMA_VERSION,
    'schema_version',
    failures,
  );

  if (!Array.isArray(value.items)) {
    failures.push({
      path: 'items',
      reason: 'runner adapter inventory items must be an array.',
    });
    return finish(value as CurrentRunnerAdapterInventory, failures);
  }

  const seenIds = new Set<string>();
  value.items.forEach((entry, index) => {
    const path = `runner_adapter_inventory.items[${index}]`;
    if (!isRecord(entry)) {
      failures.push({
        path,
        reason: 'runner adapter inventory item must be an object.',
      });
      return;
    }

    const id = validateEnum(
      entry.id,
      RUNNER_ADAPTER_ITEM_ID_SET,
      `${path}.id`,
      'runner adapter inventory item id is not supported.',
      failures,
    ) as CurrentRunnerAdapterInventoryItemId | undefined;
    if (id) {
      if (seenIds.has(id)) {
        failures.push({
          path: `${path}.id`,
          reason: `runner adapter inventory item "${id}" is declared more than once.`,
        });
      }
      seenIds.add(id);
    }

    validateRunnerAdapterCurrentPaths(entry.current_paths, `${path}.current_paths`, options, failures);
    validateRequiredString(entry.current_role, `${path}.current_role`, failures);
    validateRequiredString(entry.p5_target, `${path}.p5_target`, failures);
    validateRequiredString(entry.migration_action, `${path}.migration_action`, failures);
    validateRunnerAdapterOwnerRepo(entry.owner_repo, `${path}.owner_repo`, failures);
    validateRunnerAdapterTargetRepo(entry.target_repo, `${path}.target_repo`, failures);
    validateLiteral(entry.release_proof_allowed, false, `${path}.release_proof_allowed`, failures);
    validateRequiredString(
      entry.forbidden_release_proof_reason,
      `${path}.forbidden_release_proof_reason`,
      failures,
    );
    const failFastChecks = validateStringArray(entry.fail_fast_checks, `${path}.fail_fast_checks`, failures);
    if (failFastChecks && failFastChecks.length === 0) {
      failures.push({
        path: `${path}.fail_fast_checks`,
        reason: 'runner adapter inventory item must declare fail-fast checks.',
      });
    }
    validateRunnerAdapterFailFastChecks(failFastChecks, `${path}.fail_fast_checks`, failures);
    validateRunnerAdapterSourceBoundary(entry.source_boundary, `${path}.source_boundary`, failures);
  });

  for (const id of CURRENT_RUNNER_ADAPTER_INVENTORY_REQUIRED_ITEM_IDS) {
    if (!seenIds.has(id)) {
      failures.push({
        path: 'runner_adapter_inventory.items',
        reason: `runner adapter inventory is missing "${id}".`,
      });
    }
  }

  return finish(value as CurrentRunnerAdapterInventory, failures);
}

function validateRunnerAdapterFailFastChecks(
  checks: readonly string[] | undefined,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  checks?.forEach((check, index) => {
    if (!RUNNER_ADAPTER_FORBIDDEN_FAIL_FAST_CHECKS.has(check)) {
      return;
    }
    failures.push({
      path: `${path}[${index}]`,
      reason: 'runner adapter inventory must not claim runner manifest/lock/release contract digest match proof; use the runner image lock adoption gate.',
    });
  });
}

function validateRunnerAdapterCurrentPaths(
  value: unknown,
  path: string,
  options: CurrentRunnerAdapterInventoryValidationOptions,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const paths = validateStringArray(value, path, failures);
  if (!paths) {
    return;
  }
  if (paths.length === 0) {
    failures.push({
      path,
      reason: 'runner adapter inventory current_paths must not be empty.',
    });
    return;
  }

  const seenPaths = new Set<string>();
  paths.forEach((relativePath, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isSafeRunnerAdapterCurrentPath(relativePath)) {
      failures.push({
        path: itemPath,
        reason: `${itemPath} must be a safe relative path.`,
      });
      return;
    }
    if (seenPaths.has(relativePath)) {
      failures.push({
        path,
        reason: `current_paths contains duplicate path: ${relativePath}.`,
      });
    }
    seenPaths.add(relativePath);

    if (options.validateCurrentPaths === false) {
      return;
    }
    const rootDir = resolve(options.rootDir ?? process.cwd());
    if (!existsSync(resolve(rootDir, relativePath))) {
      failures.push({
        path: itemPath,
        reason: `current_paths[${index}] must exist: ${relativePath}`,
      });
    }
  });
}

function validateRunnerAdapterOwnerRepo(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const repo = validateRequiredString(value, path, failures);
  if (!repo) {
    return;
  }
  if (repo.includes('agentsmith-codex-runner')) {
    failures.push({
      path,
      reason: 'agentsmith-codex-runner is not a canonical runner repo.',
    });
    return;
  }
  if (repo !== 'agentsmith') {
    failures.push({
      path,
      reason: 'owner_repo must be agentsmith.',
    });
  }
}

function validateRunnerAdapterTargetRepo(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const repo = validateRequiredString(value, path, failures);
  if (!repo) {
    return;
  }
  if (repo.includes('agentsmith-codex-runner')) {
    failures.push({
      path,
      reason: 'agentsmith-codex-runner is not a canonical runner repo.',
    });
    return;
  }
  if (!RUNNER_ADAPTER_TARGET_REPO_SET.has(repo)) {
    failures.push({
      path,
      reason: 'target_repo must be agentsmith or agentsmith-runner.',
    });
  }
}

function validateRunnerAdapterSourceBoundary(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      path,
      reason: 'source_boundary is required.',
    });
    return;
  }

  for (const field of RUNNER_ADAPTER_SOURCE_BOUNDARY_FIELDS) {
    validateLiteral(value[field], false, `${path}.${field}`, failures);
  }
  if (value.runner_repo_reads_agentsmith_source === true) {
    failures.push({
      path: `${path}.runner_repo_reads_agentsmith_source`,
      reason: 'runner repo must not read AgentSmith source for this adapter.',
    });
  }
  if (value.release_kit_builds_runner_from_agentsmith_source === true) {
    failures.push({
      path: `${path}.release_kit_builds_runner_from_agentsmith_source`,
      reason: 'release kit must not build runner from AgentSmith source.',
    });
  }
  if (value.release_kit_builds_runner_from_runner_source === true) {
    failures.push({
      path: `${path}.release_kit_builds_runner_from_runner_source`,
      reason: 'release kit must not build runner from runner source.',
    });
  }
}

function isSafeRunnerAdapterCurrentPath(value: string): boolean {
  const trimmed = value.trim();
  if (
    trimmed.length === 0
    || isAbsolute(trimmed)
    || trimmed.startsWith('\\')
    || trimmed.includes('\\')
    || trimmed.includes('\0')
  ) {
    return false;
  }

  const segments = trimmed.split('/');
  return !segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..');
}

function validateReleaseKitSubstrateConnectionTruth(
  value: Record<string, unknown>,
  targetCluster: CurrentDeploymentTargetCluster | undefined,
  substrateSource: CurrentDeploymentSubstrateSource | undefined,
  distribution: CurrentDeploymentDistribution | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (substrateSource !== 'external_declared') {
    return;
  }

  if (!hasOwn(value, 'substrate_connection_truth')) {
    failures.push({
      path: 'substrate_connection_truth',
      reason: 'external_declared release kit evidence must include substrate_connection_truth.',
    });
    return;
  }

  const validation = validateSubstrateConnectionTruth(value.substrate_connection_truth);
  if (!validation.ok) {
    for (const failure of validation.failures) {
      failures.push({
        path: failure.path === 'substrate_connection_truth'
          ? failure.path
          : `substrate_connection_truth.${failure.path}`,
        reason: failure.reason,
      });
    }
    return;
  }

  if (validation.value.substrate_source !== 'external_declared') {
    failures.push({
      path: 'substrate_connection_truth.substrate_source',
      reason: 'substrate_connection_truth.substrate_source must be external_declared.',
    });
  }
  if (
    targetCluster
    && distribution
    && (
      validation.value.target_cluster !== targetCluster
      || validation.value.substrate_source !== substrateSource
      || validation.value.distribution !== distribution
    )
  ) {
    failures.push({
      path: 'substrate_connection_truth',
      reason: 'substrate_connection_truth target axes must match release kit evidence target axes.',
    });
  }
}

function validateReleaseKitEvidenceSubject(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    failures.push({
      path,
      reason: 'evidence_subject must be an object.',
    });
    return null;
  }

  validateReleaseKitEvidenceSubjectAllowedKeys(value, path, failures);
  validateLiteral(
    value.schema_version,
    CURRENT_RELEASE_KIT_EVIDENCE_SUBJECT_SCHEMA_VERSION,
    `${path}.schema_version`,
    failures,
  );
  if (hasOwn(value, 'artifact_provenance')) {
    failures.push({
      path: `${path}.artifact_provenance`,
      reason: 'evidence subject must not contain artifact_provenance.',
    });
  }

  if (!Array.isArray(value.files) || value.files.length === 0) {
    failures.push({
      path: `${path}.files`,
      reason: 'evidence_subject.files must be a non-empty array.',
    });
    return value;
  }

  const seenFilePaths = new Set<string>();
  value.files.forEach((entry, index) => {
    const filePath = `${path}.files[${index}]`;
    if (!isRecord(entry)) {
      failures.push({
        path: filePath,
        reason: 'evidence_subject file entry must be an object.',
      });
      return;
    }

    validateReleaseKitEvidenceSubjectFileAllowedKeys(entry, filePath, failures);
    const relativePath = validateRequiredString(entry.path, `${filePath}.path`, failures);
    if (relativePath && !isSafeRelativeEvidenceSubjectPath(relativePath)) {
      failures.push({
        path: `${filePath}.path`,
        reason: `${filePath}.path must be a safe relative path.`,
      });
    }
    if (relativePath) {
      if (seenFilePaths.has(relativePath)) {
        failures.push({
          path: `${path}.files`,
          reason: `${path}.files contains duplicate path: ${relativePath}.`,
        });
      }
      seenFilePaths.add(relativePath);
    }
    validateDigest(entry.sha256, `${filePath}.sha256`, failures);
  });

  return value;
}

function validateReleaseKitEvidenceSubjectAllowedKeys(
  value: Record<string, unknown>,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!RELEASE_KIT_EVIDENCE_SUBJECT_ALLOWED_KEYS.has(key)) {
      failures.push({
        path: `${path}.${key}`,
        reason: `${path}.${key} is not allowed; evidence_subject only allows schema_version and files.`,
      });
    }
  }
}

function validateReleaseKitEvidenceSubjectFileAllowedKeys(
  value: Record<string, unknown>,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!RELEASE_KIT_EVIDENCE_SUBJECT_FILE_ALLOWED_KEYS.has(key)) {
      failures.push({
        path: `${path}.${key}`,
        reason: `${path}.${key} is not allowed; evidence_subject file entries only allow path and sha256.`,
      });
    }
  }
}

function isSafeRelativeEvidenceSubjectPath(value: string): boolean {
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || normalized.startsWith('\\')
    || normalized.includes('\\')
  ) {
    return false;
  }

  const segments = normalized.split('/');
  return !segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..');
}

export function validateArtifactProvenance(
  value: unknown,
  options: ArtifactProvenanceValidationOptions,
): CurrentReleaseBoundaryValidationResult<CurrentArtifactProvenance> {
  const failures: CurrentReleaseBoundaryValidationFailure[] = [];
  validateArtifactProvenanceInto(value, options, failures);
  return finish(value as CurrentArtifactProvenance, failures);
}

function validateArtifactProvenanceInto(
  value: unknown,
  options: ArtifactProvenanceValidationOptions,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  validateNoSecretLeak(value, options.path, failures);

  if (!isRecord(value)) {
    failures.push({
      path: options.path,
      reason: 'artifact_provenance must be an object.',
    });
    return;
  }

  validateLiteral(
    value.schema_version,
    CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
    `${options.path}.schema_version`,
    failures,
  );
  const kind = validateEnum(
    value.provenance_kind,
    new Set(options.allowedKinds),
    `${options.path}.provenance_kind`,
    'provenance kind is not allowed for this release boundary artifact.',
    failures,
  ) as CurrentArtifactProvenanceKind | undefined;
  validateRequiredString(value.producer_repo, `${options.path}.producer_repo`, failures);
  validateRequiredString(value.normalized_remote, `${options.path}.normalized_remote`, failures);

  if (typeof value.producer_repo === 'string' && value.producer_repo !== options.expectedRepo) {
    const normalizedProducerRepo = normalizeReleaseBoundaryRemote(value.producer_repo);
    failures.push({
      path: `${options.path}.producer_repo`,
      reason: normalizedProducerRepo === options.expectedRepo
        ? `producer_repo must already be canonical ${options.expectedRepo}.`
        : `canonical repo identity must be ${options.expectedRepo}.`,
    });
  }
  if (typeof value.normalized_remote === 'string' && value.normalized_remote !== options.expectedRepo) {
    const normalizedRemote = normalizeReleaseBoundaryRemote(value.normalized_remote);
    failures.push({
      path: `${options.path}.normalized_remote`,
      reason: normalizedRemote === options.expectedRepo
        ? `normalized_remote must already be canonical ${options.expectedRepo}.`
        : `canonical repo identity must be ${options.expectedRepo}.`,
    });
  }
  if (String(value.producer_repo).includes('agentsmith-codex-runner')
    || String(value.normalized_remote).includes('agentsmith-codex-runner')) {
    failures.push({
      path: `${options.path}.producer_repo`,
      reason: `canonical repo identity must be ${RUNNER_CANONICAL_REPO}.`,
    });
  }
  validateGitSha(value.commit_sha, `${options.path}.commit_sha`, failures);
  validateLiteral(value.subject_name, options.expectedSubjectName, `${options.path}.subject_name`, failures);
  validateDigest(value.subject_sha256, `${options.path}.subject_sha256`, failures);
  const subjectUri = validateRequiredString(value.subject_uri, `${options.path}.subject_uri`, failures);
  validateArtifactSubjectUri(subjectUri, `${options.path}.subject_uri`, failures);
  const artifactUri = validateRequiredString(value.artifact_uri, `${options.path}.artifact_uri`, failures);
  validateRemoteCiArtifactUri(artifactUri, `${options.path}.artifact_uri`, failures);
  if (
    typeof value.subject_uri === 'string'
    && typeof value.artifact_uri === 'string'
    && value.subject_uri === value.artifact_uri
  ) {
    failures.push({
      path: `${options.path}.subject_uri`,
      reason: 'subject_sha256 must hash the subject without artifact_provenance.',
    });
  }
  validateDigest(value.artifact_sha256, `${options.path}.artifact_sha256`, failures);
  validateRequiredString(value.generated_at, `${options.path}.generated_at`, failures);
  validateRequiredString(value.generator_command, `${options.path}.generator_command`, failures);
  validateRequiredString(value.generator_version, `${options.path}.generator_version`, failures);
  validateAttestation(value.attestation, `${options.path}.attestation`, failures);

  if (kind === 'ci_artifact') {
    validateRequiredString(value.workflow_name, `${options.path}.workflow_name`, failures);
    validateRequiredString(value.run_id, `${options.path}.run_id`, failures);
    validateRequiredString(value.run_attempt, `${options.path}.run_attempt`, failures);
    validateRequiredString(value.job, `${options.path}.job`, failures);
  } else if (kind === 'signed_operator_run') {
    validateRequiredString(value.operator_run_id, `${options.path}.operator_run_id`, failures);
    validateRequiredString(value.operator_identity, `${options.path}.operator_identity`, failures);
    validateRequiredString(value.signature_uri, `${options.path}.signature_uri`, failures);
    validateDigest(value.signature_sha256, `${options.path}.signature_sha256`, failures);
  }

  if (typeof value.subject_sha256 === 'string' && DIGEST_PATTERN.test(value.subject_sha256)) {
    const expectedSubjectDigest = sha256Digest(canonicalReleaseBoundaryJson(options.subject));
    if (value.subject_sha256 !== expectedSubjectDigest) {
      const selfReferentialDigest = sha256Digest(canonicalReleaseBoundaryJson(options.fullSubjectContainer));
      failures.push({
        path: `${options.path}.subject_sha256`,
        reason: value.subject_sha256 === selfReferentialDigest
          ? 'subject_sha256 must hash the subject without artifact_provenance.'
          : `subject_sha256 must match ${expectedSubjectDigest}.`,
      });
    }
  }
}

function validateRunnerImageLockManifest(
  value: unknown,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      path: 'manifest',
      reason: 'manifest must be an object.',
    });
    return;
  }

  const producerRepo = validateRequiredString(value.producer_repo, 'manifest.producer_repo', failures);
  if (producerRepo && producerRepo !== RUNNER_CANONICAL_REPO) {
    const normalizedProducerRepo = normalizeReleaseBoundaryRemote(producerRepo);
    failures.push({
      path: 'manifest.producer_repo',
      reason: normalizedProducerRepo === RUNNER_CANONICAL_REPO
        ? `manifest.producer_repo must already be canonical ${RUNNER_CANONICAL_REPO}.`
        : `canonical repo identity must be ${RUNNER_CANONICAL_REPO}.`,
    });
  }
  if (producerRepo && producerRepo.includes('agentsmith-codex-runner')) {
    failures.push({
      path: 'manifest.producer_repo',
      reason: `canonical repo identity must be ${RUNNER_CANONICAL_REPO}.`,
    });
  }

  validateDigest(value.subject_sha256, 'manifest.subject_sha256', failures);
  validateDigest(value.artifact_sha256, 'manifest.artifact_sha256', failures);
}

function validateImageArray(
  value: unknown,
  path: string,
  source: CurrentReleaseInventoryImage['source'],
  registry: ImageRegistry,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!Array.isArray(value)) {
    failures.push({
      path,
      reason: `${path} must be an array.`,
    });
    return;
  }

  if (value.length === 0) {
    failures.push({
      path,
      reason: `${path} must not be empty.`,
    });
  }

  value.forEach((entry, index) => {
    const imagePath = `${path}[${index}]`;
    const image = validateImageRecord(entry, imagePath, failures);
    if (!image) {
      return;
    }
    if (registry.has(image.id)) {
      failures.push({
        path: `${imagePath}.id`,
        reason: `image id "${image.id}" is declared more than once.`,
      });
    } else {
      registry.set(image.id, { ...image, source });
    }
  });
}

function validateImageRecord(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): CurrentReleaseImage | null {
  if (!isRecord(value)) {
    failures.push({
      path,
      reason: 'image entry must be an object.',
    });
    return null;
  }

  const id = validateRequiredString(value.id, `${path}.id`, failures);
  const image = validateRequiredString(value.image, `${path}.image`, failures);
  const digest = hasOwn(value, 'digest')
    ? validateDigest(value.digest, `${path}.digest`, failures)
    : undefined;
  if (!hasOwn(value, 'digest')) {
    failures.push({
      path: `${path}.digest`,
      reason: 'image digest is required.',
    });
  }

  if (image) {
    const imageDigest = imageDigestSuffix(image);
    if (!imageDigest) {
      failures.push({
        path: `${path}.image`,
        reason: 'image must be pinned by digest.',
      });
    } else if (digest && imageDigest !== digest) {
      failures.push({
        path: `${path}.image`,
        reason: 'image digest must match the image ref digest.',
      });
    }
  }

  if (!id || !image || !digest) {
    return null;
  }

  return { id, image, digest };
}

function validateDeployImageInventory(
  value: unknown,
  imageRegistry: ImageRegistry,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!Array.isArray(value)) {
    failures.push({
      path: 'deploy_image_inventory',
      reason: 'deploy_image_inventory must be an array.',
    });
    return;
  }

  const seenIds = new Set<string>();
  value.forEach((entry, index) => {
    const path = `deploy_image_inventory[${index}]`;
    const image = validateImageRecord(entry, path, failures);
    if (!isRecord(entry)) {
      return;
    }
    const source = validateEnum(
      entry.source,
      INVENTORY_SOURCE_SET,
      `${path}.source`,
      'deploy image inventory source is not supported.',
      failures,
    ) as CurrentReleaseInventoryImage['source'] | undefined;
    if (!image) {
      return;
    }
    seenIds.add(image.id);
    const registered = imageRegistry.get(image.id);
    if (!registered) {
      failures.push({
        path: `${path}.id`,
        reason: 'deploy image inventory entry must come from declared image sets.',
      });
      return;
    }
    if (registered.image !== image.image || registered.digest !== image.digest || registered.source !== source) {
      failures.push({
        path,
        reason: 'deploy image inventory entry must match the declared image source.',
      });
    }
  });

  for (const imageId of imageRegistry.keys()) {
    if (!seenIds.has(imageId)) {
      failures.push({
        path: 'deploy_image_inventory',
        reason: `deploy image inventory is missing "${imageId}".`,
      });
    }
  }
}

function validateReleaseContractDeployTemplatePackage(
  contract: Record<string, unknown>,
  deployTemplateDigest: string | undefined,
  gitSha: string | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!hasOwn(contract, 'deploy_template_package')) {
    failures.push({
      path: 'deploy_template_package',
      reason: 'deploy_template_package is required.',
    });
    return;
  }

  const value = contract.deploy_template_package;
  const packageValidation = validateDeployTemplatePackage(value);
  if (!packageValidation.ok) {
    for (const failure of packageValidation.failures) {
      failures.push({
        path: failure.path === 'deploy_template_package'
          ? failure.path
          : `deploy_template_package.${failure.path}`,
        reason: failure.reason,
      });
    }
  }

  if (
    deployTemplateDigest
    && isRecord(value)
    && typeof value.manifest_sha256 === 'string'
    && DIGEST_PATTERN.test(value.manifest_sha256)
    && value.manifest_sha256 !== deployTemplateDigest
  ) {
    failures.push({
      path: 'deploy_template_package.manifest_sha256',
      reason: 'deploy_template_digest must match deploy_template_package.manifest_sha256.',
    });
  }

  if (!gitSha || !isRecord(value) || !isRecord(value.artifact_provenance)) {
    return;
  }

  const commitSha = value.artifact_provenance.commit_sha;
  if (typeof commitSha === 'string' && GIT_SHA_PATTERN.test(commitSha) && commitSha !== gitSha) {
    failures.push({
      path: 'deploy_template_package.artifact_provenance.commit_sha',
      reason: 'deploy_template_package.artifact_provenance.commit_sha must match git_sha.',
    });
  }
}

function validateRequiredProductFlows(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const flows = validateStringArray(value, path, failures);
  if (!flows) {
    return;
  }

  for (const flow of CURRENT_REQUIRED_PRODUCT_FLOWS) {
    if (!flows.includes(flow)) {
      failures.push({
        path,
        reason: `required product flow "${flow}" is missing.`,
      });
    }
  }
}

function validateTargetProfiles(value: unknown, failures: CurrentReleaseBoundaryValidationFailure[]): void {
  if (!Array.isArray(value)) {
    failures.push({
      path: 'target_profiles',
      reason: 'target_profiles must be an array.',
    });
    return;
  }

  const seenProfileKeys = new Set<string>();
  value.forEach((entry, index) => {
    const path = `target_profiles[${index}]`;
    if (!isRecord(entry)) {
      failures.push({
        path,
        reason: 'target profile must be an object.',
      });
      return;
    }

    const targetCluster = validateEnum(
      entry.target_cluster,
      TARGET_CLUSTER_SET,
      `${path}.target_cluster`,
      'target_cluster is not in the release boundary matrix.',
      failures,
    ) as CurrentDeploymentTargetCluster | undefined;
    const substrateSource = validateEnum(
      entry.substrate_source,
      SUBSTRATE_SOURCE_SET,
      `${path}.substrate_source`,
      'substrate_source is not in the release boundary matrix.',
      failures,
    ) as CurrentDeploymentSubstrateSource | undefined;
    const distribution = validateEnum(
      entry.distribution,
      DISTRIBUTION_SET,
      `${path}.distribution`,
      'distribution is not in the release boundary matrix.',
      failures,
    ) as CurrentDeploymentDistribution | undefined;

    if (targetCluster && substrateSource && distribution) {
      const profileKey = modeKey(targetCluster, substrateSource, distribution);
      if (seenProfileKeys.has(profileKey)) {
        failures.push({
          path,
          reason: `target profile tuple ${profileKey} is declared more than once.`,
        });
      }
      seenProfileKeys.add(profileKey);

      if (!MODE_KEY_SET.has(profileKey)) {
        failures.push({
          path,
          reason: 'target profile combination is not allowed by the release boundary matrix.',
        });
      }
    }

    if (hasOwn(entry, 'support_level')) {
      failures.push({
        path: `${path}.support_level`,
        reason: 'target profile support_level is not allowed; support level lives in the release boundary matrix.',
      });
    }

    if (entry.required !== false) {
      failures.push({
        path: `${path}.required`,
        reason: 'target profile required must be false for AgentSmith pre-GA handoff candidates.',
      });
    }

    validatePrerequisites(entry.prerequisites, `${path}.prerequisites`, failures);
  });

  for (const expectedProfileKey of RELEASE_KIT_CANONICAL_DECLARABLE_TARGET_PROFILE_KEY_SET) {
    if (!seenProfileKeys.has(expectedProfileKey)) {
      failures.push({
        path: 'target_profiles',
        reason: `target profile tuple ${expectedProfileKey} is missing from the release-kit canonical declarable profile handoff.`,
      });
    }
  }
}

function validatePrerequisites(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({ path, reason: 'target profile prerequisites must be an object.' });
    return;
  }

  for (const field of ['namespace', 'rbac', 'ingress', 'tls', 'storage_class', 'registry', 'pull_secret_ref']) {
    validateRequiredString(value[field], `${path}.${field}`, failures);
  }
}

function validatePostgresTruth(
  value: unknown,
  path: string,
  source: string | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const service = validateBaseSubstrateService(
    value,
    path,
    source,
    ['credential_secret_ref', 'admin_secret_ref'],
    ['host', 'endpoint', 'url'],
    failures,
  );
  if (!service) {
    return;
  }

  validatePort(service.port, `${path}.port`, failures);
  validateRequiredString(service.database, `${path}.database`, failures);
  validatePostgresVectorExtension(service.extensions, `${path}.extensions`, failures);
}

function validatePostgresVectorExtension(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      path,
      reason: 'postgresql truth must include pgvector extension check.',
    });
    return;
  }

  const vector = value.pgvector ?? value.vector;
  if (!isRecord(vector)) {
    failures.push({
      path,
      reason: 'postgresql truth must include pgvector extension check.',
    });
    return;
  }

  validateEnum(
    vector.status,
    POSTGRES_VECTOR_STATUS_SET,
    `${path}.pgvector.status`,
    'postgresql truth must include pgvector extension check.',
    failures,
  );
  if (hasOwn(vector, 'version')) {
    validateRequiredString(vector.version, `${path}.pgvector.version`, failures);
  }
}

function validateMongoTruth(
  value: unknown,
  path: string,
  source: string | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const service = validateBaseSubstrateService(
    value,
    path,
    source,
    ['credential_secret_ref'],
    ['host', 'endpoint', 'url'],
    failures,
  );
  if (!service) {
    return;
  }

  validatePort(service.port, `${path}.port`, failures);
  if (hasOwn(service, 'database')) {
    validateRequiredString(service.database, `${path}.database`, failures);
  }
}

function validateRedisTruth(
  value: unknown,
  path: string,
  source: string | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const service = validateBaseSubstrateService(
    value,
    path,
    source,
    ['credential_secret_ref'],
    ['host', 'endpoint', 'url'],
    failures,
  );
  if (!service) {
    return;
  }

  validatePort(service.port, `${path}.port`, failures);
}

function validateObjectStorageTruth(
  value: unknown,
  path: string,
  source: string | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const service = validateBaseSubstrateService(
    value,
    path,
    source,
    ['credential_secret_ref'],
    ['endpoint', 'url', 'host'],
    failures,
  );
  if (!service) {
    return;
  }

  validateRequiredString(service.bucket, `${path}.bucket`, failures);
  if (!hasOwn(service, 'region') && !hasOwn(service, 'endpoint') && !hasOwn(service, 'url')) {
    failures.push({
      path,
      reason: 'services.object_storage must include region or endpoint.',
    });
  }
}

function validateOidcTruth(
  value: unknown,
  path: string,
  source: string | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const service = validateBaseSubstrateService(
    value,
    path,
    source,
    ['client_secret_ref'],
    ['issuer_url', 'issuer', 'endpoint', 'url', 'host'],
    failures,
  );
  if (!service) {
    return;
  }

  validateRequiredString(service.client_id, `${path}.client_id`, failures);
}

function validateSubstrateServicesObject(
  value: unknown,
  failures: CurrentReleaseBoundaryValidationFailure[],
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    failures.push({
      path: 'services',
      reason: 'substrate_connection_truth.services must be an object.',
    });
    return null;
  }

  for (const service of SUBSTRATE_CONNECTION_REQUIRED_SERVICES) {
    if (!hasOwn(value, service)) {
      failures.push({
        path: 'services',
        reason: `substrate_connection_truth.services missing required service: ${service}.`,
      });
    }
  }

  return value;
}

function validateNoExternalDeclaredDockerTruth(
  value: unknown,
  path: string,
  source: CurrentDeploymentSubstrateSource | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (source !== 'external_declared' || typeof value !== 'string' || !DOCKER_SUBSTRATE_TRUTH_SCHEMAS.has(value)) {
    return;
  }

  failures.push({
    path,
    reason: 'external_declared must not use docker-substrate truth.',
  });
}

function validateNoLegacyTopLevelSubstrateServiceKeys(
  value: Record<string, unknown>,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  for (const key of LEGACY_TOP_LEVEL_SUBSTRATE_SERVICE_KEYS) {
    if (!hasOwn(value, key)) {
      continue;
    }

    failures.push({
      path: key,
      reason: `legacy top-level substrate service key "${key}" is not allowed; use services.${key === 'postgres' ? 'postgresql' : key}.`,
    });
  }
}

function validateBaseSubstrateService(
  value: unknown,
  path: string,
  source: string | undefined,
  secretFields: readonly string[],
  endpointFields: readonly string[],
  failures: CurrentReleaseBoundaryValidationFailure[],
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    failures.push({ path, reason: `${path} must be an object.` });
    return null;
  }

  validateSubstrateEndpoint(value, path, source, endpointFields, failures);
  for (const field of secretFields) {
    validateSecretRef(value[field], `${path}.${field}`, failures);
  }
  validateTlsOrSslmode(value, path, failures);
  validateReachability(value.reachability, `${path}.reachability`, failures);

  return value;
}

function validateSubstrateEndpoint(
  value: Record<string, unknown>,
  path: string,
  source: string | undefined,
  endpointFields: readonly string[],
  failures: CurrentReleaseBoundaryValidationFailure[],
): string | undefined {
  for (const field of endpointFields) {
    if (!hasOwn(value, field)) {
      continue;
    }

    const endpoint = validateRequiredString(value[field], `${path}.${field}`, failures);
    validateNoDockerDefaultHost(endpoint ? hostFromEndpoint(endpoint) : undefined, path, source, failures);
    return endpoint;
  }

  failures.push({
    path,
    reason: `${path} must include endpoint, host, or url.`,
  });
  return undefined;
}

function validateTlsOrSslmode(
  value: Record<string, unknown>,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  const hasSslmode = hasOwn(value, 'sslmode');
  const hasTls = hasOwn(value, 'tls');
  if (!hasSslmode && !hasTls) {
    failures.push({
      path,
      reason: `${path} must include tls or sslmode.`,
    });
    return;
  }

  if (hasSslmode) {
    const sslmode = validateRequiredString(value.sslmode, `${path}.sslmode`, failures);
    if (sslmode && ['disable', 'disabled', 'none'].includes(sslmode.toLowerCase())) {
      failures.push({
        path: `${path}.sslmode`,
        reason: `${path}.sslmode must not disable TLS.`,
      });
    }
  }

  if (!hasTls) {
    return;
  }

  if (typeof value.tls === 'string') {
    const tls = validateRequiredString(value.tls, `${path}.tls`, failures);
    if (tls && ['disable', 'disabled', 'none'].includes(tls.toLowerCase())) {
      failures.push({
        path: `${path}.tls`,
        reason: `${path}.tls must not disable TLS.`,
      });
    }
    return;
  }

  if (!isRecord(value.tls)) {
    failures.push({
      path: `${path}.tls`,
      reason: `${path}.tls must be an object.`,
    });
    return;
  }

  if (Object.keys(value.tls).length === 0) {
    failures.push({
      path: `${path}.tls`,
      reason: `${path}.tls must not be empty.`,
    });
  }
  if (value.tls.enabled === false) {
    failures.push({
      path: `${path}.tls.enabled`,
      reason: `${path}.tls.enabled must not be false.`,
    });
  }
  if (hasOwn(value.tls, 'mode')) {
    const mode = validateRequiredString(value.tls.mode, `${path}.tls.mode`, failures);
    if (mode && ['disable', 'disabled', 'none'].includes(mode.toLowerCase())) {
      failures.push({
        path: `${path}.tls.mode`,
        reason: `${path}.tls.mode must not disable TLS.`,
      });
    }
  }
  for (const [key, nested] of Object.entries(value.tls)) {
    if (SECRET_FIELD_NAME_PATTERN.test(normalizeFieldNameForSecretCheck(key)) && typeof nested === 'string') {
      validateSecretRef(nested, `${path}.tls.${key}`, failures);
    }
  }
}

function validateReachability(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      path,
      reason: `${path} must be an object.`,
    });
    return;
  }

  validateEnum(
    value.status,
    SUBSTRATE_REACHABILITY_STATUS_SET,
    `${path}.status`,
    `${path}.status is not an accepted reachability status.`,
    failures,
  );
  validateRequiredString(value.proof, `${path}.proof`, failures);
}

function validateRedactedFingerprint(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push({
      path,
      reason: `${path} must be a non-empty string.`,
    });
    return;
  }

  if (!DIGEST_PATTERN.test(value) && !/^(?:redacted|fingerprint):sha256:[0-9a-f]{64}$/u.test(value)) {
    failures.push({
      path,
      reason: `${path} must be sha256:<64 lowercase hex> or a redacted sha256 fingerprint.`,
    });
  }
}

function validateProductFlowProbeRefs(
  value: unknown,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      path: 'product_flow_probe_secret_refs',
      reason: 'product_flow_probe_secret_refs must be an object.',
    });
    return;
  }

  for (const flow of CURRENT_REQUIRED_PRODUCT_FLOWS) {
    validateSecretRef(value[flow], `product_flow_probe_secret_refs.${flow}`, failures);
  }
}

function validateEvidenceMappingCompatibility(
  value: Record<string, unknown>,
  target: CurrentReleaseKitEvidenceTarget | undefined,
  targetCluster: CurrentDeploymentTargetCluster | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!target) {
    return;
  }

  const mapping = CURRENT_RELEASE_KIT_EVIDENCE_MAPPING.find((entry) => entry.target === target);
  if (!mapping) {
    failures.push({
      path: 'target',
      reason: 'release kit evidence mapping is missing for target.',
    });
    return;
  }

  const writer = isRecord(value.canonical_writer) ? value.canonical_writer : null;
  if (!writer) {
    return;
  }
  if (writer.gate_id !== mapping.canonical_writer.gate_id || writer.line_kind !== mapping.canonical_writer.line_kind) {
    failures.push({
      path: 'canonical_writer',
      reason: 'release kit evidence writer id does not match the current mapping.',
    });
  }
  if (targetCluster && !mapping.current_campaign_target_clusters.includes(targetCluster)) {
    failures.push({
      path: 'target_cluster',
      reason: targetCluster === 'existing_kubernetes'
        ? 'local-kind campaign writer cannot accept existing_kubernetes evidence.'
        : 'target_cluster is not allowed for the mapped current campaign writer.',
    });
  }

  if (target === 'product_flows') {
    const canonicalEvidence = value.product_flow_canonical_evidence;
    if (!isRecord(canonicalEvidence) || canonicalEvidence.producer !== mapping.expected_product_flow_producer) {
      failures.push({
        path: 'product_flow_canonical_evidence.producer',
        reason: 'product flow canonical evidence must be produced by AgentSmith.',
      });
    }
  }
}

function validateCanonicalWriter(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      path,
      reason: 'canonical writer must be an object.',
    });
    return;
  }

  validateRequiredString(value.gate_id, `${path}.gate_id`, failures);
  validateRequiredString(value.line_kind, `${path}.line_kind`, failures);
}

function validateNoDockerDefaultHost(
  value: string | undefined,
  path: string,
  source: string | undefined,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (source !== 'external_declared' || !value) {
    return;
  }

  if (DOCKER_DEFAULT_HOSTS.has(value.toLowerCase())) {
    failures.push({
      path,
      reason: 'external_declared must not use Docker default endpoint.',
    });
  }
}

function validateSecretRef(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): string | undefined {
  const ref = validateRequiredString(value, path, failures);
  if (ref && !isSafeSecretRefValue(ref)) {
    failures.push({
      path,
      reason: ref.startsWith(SECRET_REF_PREFIX)
        ? 'credential values must be persisted as secret refs only; secretRef path/id must be non-empty and single-line.'
        : 'credential values must be persisted as secret refs only.',
    });
  }

  return ref;
}

function validateRunnerContractVersion(
  value: unknown,
  failures: CurrentReleaseBoundaryValidationFailure[],
): string | undefined {
  const version = validateRequiredString(value, 'runner_contract_version', failures);
  if (version && !SEMVER_PATTERN.test(version)) {
    failures.push({
      path: 'runner_contract_version',
      reason: 'runner_contract_version must be a semver string.',
    });
    return undefined;
  }

  return version;
}

function validatePort(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 65535) {
    failures.push({
      path,
      reason: 'port must be an integer between 1 and 65535.',
    });
    return undefined;
  }

  return value;
}

function validateAttestation(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (value === 'none') {
    return;
  }

  if (!isRecord(value)) {
    failures.push({
      path,
      reason: 'attestation must be "none" or an attestation object.',
    });
    return;
  }

  const attestationUri = validateRequiredString(value.attestation_uri, `${path}.attestation_uri`, failures);
  validateRemoteCiArtifactUri(attestationUri, `${path}.attestation_uri`, failures);
  validateDigest(value.attestation_sha256, `${path}.attestation_sha256`, failures);
}

function validateRemoteCiArtifactUri(
  value: string | undefined,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!value) {
    return;
  }

  const normalized = normalizeArtifactPointer(value);
  if (
    !hasUriScheme(normalized)
    || isLocalArtifactUri(normalized)
    || isLocalOrTraversalPath(normalized)
    || isAgentSmithProductSourcePointer(normalized)
  ) {
    failures.push({
      path,
      reason: `${path} must be a remote/CI artifact URI, not a local/relative AgentSmith source path.`,
    });
  }
}

function validateArtifactSubjectUri(
  value: string | undefined,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (!value) {
    return;
  }

  const normalized = normalizeArtifactPointer(value);
  if (
    normalized.startsWith('file://')
    || isLocalArtifactUri(normalized)
    || isLocalOrTraversalPath(normalized)
    || normalized.startsWith('@/')
    || isAgentSmithProductSourcePointer(normalized)
  ) {
    failures.push({
      path,
      reason: `${path} must not point at local AgentSmith product source.`,
    });
  }
}

function normalizeArtifactPointer(value: string): string {
  return value.trim().replaceAll('\\', '/');
}

function hasUriScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(value);
}

function isLocalArtifactUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const protocol = url.protocol.toLowerCase();
  return protocol === 'file:'
    || protocol === 'local:'
    || isLocalOrUnspecifiedHost(url.hostname);
}

function isLocalOrUnspecifiedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return host === 'localhost'
    || isLocalOrUnspecifiedIpv4Host(host)
    || host === '::'
    || host === '::1'
    || host === '0:0:0:0:0:0:0:0'
    || host === '0:0:0:0:0:0:0:1';
}

function isLocalOrUnspecifiedIpv4Host(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => {
    if (!/^\d+$/u.test(part)) {
      return null;
    }
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });
  if (octets.some((octet) => octet === null)) {
    return false;
  }
  return octets.every((octet) => octet === 0) || octets[0] === 127;
}

function isLocalOrTraversalPath(value: string): boolean {
  return value.startsWith('/')
    || value.startsWith('./')
    || value.startsWith('../')
    || value === '.'
    || value === '..';
}

function isAgentSmithProductSourcePointer(value: string): boolean {
  return /(?:^|\/)agentsmith\/(?:src(?:\/|$)|package\.json$|packages(?:\/|$))/u.test(value)
    || isAgentSmithGitHubSourceUri(value);
}

const RELEASE_BOUNDARY_GITHUB_SOURCE_REPO_PATHS = [
  '/agentsmith-project/agentsmith',
  '/agentsmith-project/agentsmith-release-kit',
  '/agentsmith-project/agentsmith-runner',
] as const;

function isAgentSmithGitHubSourceUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = canonicalGitHubPathname(url.pathname);
  if (pathname === null) {
    return isGitHubSourceHost(hostname);
  }

  if (hostname === 'github.com') {
    return RELEASE_BOUNDARY_GITHUB_SOURCE_REPO_PATHS.some((repoPath) => (
      pathname === repoPath
      || pathname === `${repoPath}.git`
      || pathname.startsWith(`${repoPath}/archive/`)
      || pathname.startsWith(`${repoPath}/tree/`)
      || pathname.startsWith(`${repoPath}/blob/`)
      || pathname.startsWith(`${repoPath}/raw/`)
      || pathname.startsWith(`${repoPath}/commit/`)
      || pathname === `${repoPath}/commits`
      || pathname.startsWith(`${repoPath}/commits/`)
    ));
  }

  if (hostname === 'raw.githubusercontent.com' || hostname === 'codeload.github.com') {
    return RELEASE_BOUNDARY_GITHUB_SOURCE_REPO_PATHS.some((repoPath) => (
      pathname === repoPath || pathname.startsWith(`${repoPath}/`)
    ));
  }

  if (hostname === 'api.github.com') {
    return RELEASE_BOUNDARY_GITHUB_SOURCE_REPO_PATHS.some((sourceRepoPath) => {
      const repoPath = `/repos${sourceRepoPath}`;
      return pathname === `${repoPath}/tarball`
        || pathname.startsWith(`${repoPath}/tarball/`)
        || pathname === `${repoPath}/zipball`
        || pathname.startsWith(`${repoPath}/zipball/`)
        || pathname === `${repoPath}/contents`
        || pathname.startsWith(`${repoPath}/contents/`)
        || pathname === `${repoPath}/git`
        || pathname.startsWith(`${repoPath}/git/`)
        || pathname === `${repoPath}/commits`
        || pathname.startsWith(`${repoPath}/commits/`)
        || pathname === `${repoPath}/branches`
        || pathname.startsWith(`${repoPath}/branches/`)
        || pathname === `${repoPath}/tags`
        || pathname.startsWith(`${repoPath}/tags/`);
    });
  }

  return false;
}

function canonicalGitHubPathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
      .replace(/\/{2,}/gu, '/')
      .replace(/\/+$/u, '')
      .toLowerCase();
  } catch {
    return null;
  }
}

function isGitHubSourceHost(hostname: string): boolean {
  return hostname === 'github.com'
    || hostname === 'raw.githubusercontent.com'
    || hostname === 'codeload.github.com'
    || hostname === 'api.github.com';
}

function validateStringArray(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)) {
    failures.push({
      path,
      reason: `${path} must be an array of non-empty strings.`,
    });
    return undefined;
  }

  return value;
}

function validateEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  reason: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): string | undefined {
  if (typeof value !== 'string' || !allowed.has(value)) {
    failures.push({ path, reason });
    return undefined;
  }

  return value;
}

function validateLiteral(
  value: unknown,
  expected: string | number | boolean,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (value !== expected) {
    failures.push({
      path,
      reason: `${path} must be ${JSON.stringify(expected)}.`,
    });
  }
}

function validateRequiredString(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push({
      path,
      reason: `${path} must be a non-empty string.`,
    });
    return undefined;
  }

  return value;
}

function validatePlainSemver(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): string | undefined {
  const version = validateRequiredString(value, path, failures);
  if (!version) {
    return undefined;
  }

  if (!PLAIN_SEMVER_PATTERN.test(version)) {
    failures.push({
      path,
      reason: `${path} must be a plain semver x.y.z string.`,
    });
    return undefined;
  }

  return version;
}

function validateGitSha(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): string | undefined {
  const text = validateRequiredString(value, path, failures);
  if (text && !GIT_SHA_PATTERN.test(text)) {
    failures.push({
      path,
      reason: `${path} must be a 40-character lowercase git sha.`,
    });
    return undefined;
  }

  return text;
}

function validateDigest(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): string | undefined {
  const text = validateRequiredString(value, path, failures);
  if (text && !DIGEST_PATTERN.test(text)) {
    failures.push({
      path,
      reason: `${path} must be sha256:<64 lowercase hex>.`,
    });
    return undefined;
  }

  return text;
}

export function containsReleaseBoundarySecretLookingText(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export function validateNoSecretLeak(
  value: unknown,
  path: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (typeof value === 'string') {
    if (containsReleaseBoundarySecretLookingText(value)) {
      failures.push({
        path,
        reason: 'secret-looking value must not be persisted in release boundary truth.',
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNoSecretLeak(entry, `${path}[${index}]`, failures));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = normalizeFieldNameForSecretCheck(key);
    if (isForbiddenSecretValueField(key)) {
      failures.push({
        path: `${path}.${key}`,
        reason: `secret-bearing field "${key}" must use a reference field, not persist a value.`,
      });
    }
    if (isSecretReferenceFieldName(normalizedKey)) {
      validateSecretReferenceFieldValue(nestedValue, `${path}.${key}`, key, failures);
    }
    validateNoSecretLeak(nestedValue, `${path}.${key}`, failures);
  }
}

function buildReleaseKitEvidenceAggregateCanonicalShape(
  evidence: CurrentReleaseKitEvidence,
): CurrentReleaseKitEvidenceAggregateCanonicalShape | null {
  const mapping = CURRENT_RELEASE_KIT_EVIDENCE_MAPPING.find((entry) => entry.target === evidence.target);
  if (!mapping) {
    return null;
  }

  const writer = mapping.canonical_writer;
  if (
    writer.npm_script === undefined
    || writer.native_result_path === undefined
    || writer.evidence_root === undefined
    || writer.summary_section === undefined
  ) {
    return null;
  }

  return {
    schema_version: CURRENT_RELEASE_KIT_EVIDENCE_AGGREGATE_CANONICAL_SCHEMA_VERSION,
    release_contract_digest: evidence.release_contract_digest,
    release_id: evidence.release_id,
    git_sha: evidence.git_sha,
    release_kit_version: evidence.release_kit_version,
    target: evidence.target,
    summary_section: writer.summary_section,
    target_cluster: evidence.target_cluster,
    substrate_source: evidence.substrate_source,
    distribution: evidence.distribution,
    status: evidence.status,
    failure_class: evidence.failure_class,
    evidence_root: evidence.evidence_root,
    canonical_writer: {
      gate_id: writer.gate_id,
      line_kind: writer.line_kind,
      npm_script: writer.npm_script,
      native_result_path: writer.native_result_path,
      evidence_root: writer.evidence_root,
      summary_section: writer.summary_section,
    },
    artifact_provenance: {
      provenance_kind: evidence.artifact_provenance.provenance_kind,
      producer_repo: evidence.artifact_provenance.producer_repo,
      normalized_remote: evidence.artifact_provenance.normalized_remote,
      commit_sha: evidence.artifact_provenance.commit_sha,
      subject_name: evidence.artifact_provenance.subject_name,
      subject_sha256: evidence.artifact_provenance.subject_sha256,
      subject_uri: evidence.artifact_provenance.subject_uri,
      artifact_uri: evidence.artifact_provenance.artifact_uri,
      artifact_sha256: evidence.artifact_provenance.artifact_sha256,
      generated_at: evidence.artifact_provenance.generated_at,
      generator_version: evidence.artifact_provenance.generator_version,
    },
  };
}

function isForbiddenSecretValueField(key: string): boolean {
  const normalizedKey = normalizeFieldNameForSecretCheck(key);
  if (!SECRET_FIELD_NAME_PATTERN.test(normalizedKey)) {
    return false;
  }

  if (SECRET_REFERENCE_FIELD_PATTERN.test(normalizedKey)) {
    return false;
  }

  return normalizedKey !== 'redacted_fingerprint';
}

function isSecretReferenceFieldName(normalizedKey: string): boolean {
  return SECRET_FIELD_NAME_PATTERN.test(normalizedKey) && SECRET_REFERENCE_FIELD_PATTERN.test(normalizedKey);
}

function validateSecretReferenceFieldValue(
  value: unknown,
  path: string,
  fieldName: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): void {
  if (typeof value === 'string') {
    if (!isAllowedSecretReferenceValue(value)) {
      failures.push({
        path,
        reason: value.startsWith(SECRET_REF_PREFIX)
          ? `secret reference field "${fieldName}" must use secretRef: values or a safe sentinel; secretRef path/id must be non-empty and single-line.`
          : `secret reference field "${fieldName}" must use secretRef: values or a safe sentinel.`,
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSecretReferenceFieldValue(entry, `${path}[${index}]`, fieldName, failures));
    return;
  }

  if (isRecord(value)) {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      validateSecretReferenceFieldValue(nestedValue, `${path}.${nestedKey}`, fieldName, failures);
    }
    return;
  }

  failures.push({
    path,
    reason: `secret reference field "${fieldName}" must use secretRef: values or a safe sentinel.`,
  });
}

function isAllowedSecretReferenceValue(value: string): boolean {
  return isSafeSecretRefValue(value) || SAFE_SECRET_REFERENCE_SENTINELS.has(value);
}

function isSafeSecretRefValue(value: string): boolean {
  if (!value.startsWith(SECRET_REF_PREFIX) || /[\r\n]/u.test(value)) {
    return false;
  }

  const refPath = value.slice(SECRET_REF_PREFIX.length).trim();
  return refPath.length > 0 && !/^:+$/u.test(refPath);
}

function normalizeFieldNameForSecretCheck(key: string): string {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_|_$/gu, '')
    .toLowerCase();
}

function imageDigestSuffix(image: string): string | null {
  return IMAGE_DIGEST_SUFFIX_PATTERN.exec(image)?.[1] ?? null;
}

function hostFromEndpoint(endpoint: string): string {
  const normalized = endpoint.trim();
  if (hasUriScheme(normalized)) {
    try {
      const hostname = new URL(normalized).hostname;
      if (hostname) {
        return hostname;
      }
    } catch {
      // Fall through to host[:port]/path parsing below.
    }
  }

  const authority = normalized.startsWith('//')
    ? normalized.slice(2).split(/[/?#]/u)[0] ?? normalized
    : normalized.split(/[/?#]/u)[0] ?? normalized;
  if (authority.startsWith('[')) {
    const bracketEnd = authority.indexOf(']');
    if (bracketEnd > 1) {
      return authority.slice(1, bracketEnd);
    }
  }

  return authority.split(':')[0] ?? authority;
}

function modeKey(
  targetCluster: string,
  substrateSource: string,
  distribution: string,
): string {
  return `${targetCluster}|${substrateSource}|${distribution}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJson(nestedValue)]),
    );
  }

  return value;
}

function omitRecordKey(record: Record<string, unknown>, keyToOmit: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToOmit));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function finish<T>(
  value: T,
  failures: CurrentReleaseBoundaryValidationFailure[],
): CurrentReleaseBoundaryValidationResult<T> {
  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value,
  };
}

function invalid<T>(
  path: string,
  reason: string,
  failures: CurrentReleaseBoundaryValidationFailure[],
): CurrentReleaseBoundaryValidationResult<T> {
  return {
    ok: false,
    failures: [
      ...failures,
      { path, reason },
    ],
  };
}
