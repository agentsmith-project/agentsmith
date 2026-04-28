import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  findCurrentGateDefinitionById,
  listCurrentGateDefinitions,
} from './current-gate-manifest';
import { listCurrentResourceLocks } from './current-resource-lock-manifest';
import {
  findCurrentVerificationCampaignById,
  listCurrentVerificationCampaigns,
  type CurrentVerificationCampaignId,
} from './current-verification-campaign-manifest';

export const CURRENT_REAL_SESSION_COVERAGE_MANIFEST_SCHEMA = 'current-real-session-coverage-manifest.v1' as const;
export const CURRENT_REAL_SESSION_COVERAGE_MANIFEST_VERSION = 1 as const;

export type CurrentRealSessionCoverageSourceKind =
  | 'current_gate'
  | 'release_campaign_step'
  | 'npm_script'
  | 'playwright_spec'
  | 'playwright_grep';

export type CurrentRealSessionProposedShardId =
  | 'backend-real-substrate'
  | 'identity-governance'
  | 'files'
  | 'external-chat-runner'
  | 'external-notebook-context'
  | 'terminal-runtime'
  | 'usage-audit'
  | 'internal-k8s'
  | 'provider-credential'
  | 'api-key-endpoint'
  | 'release-backend-real';

export type CurrentRealSessionIsolationLevel = 'process' | 'workspace' | 'db-checkpoint' | 'serialized';

export type CurrentRealSessionMutableResource =
  | 'workspace'
  | 'project'
  | 'ws_default'
  | 'fixed_user'
  | 'context_store'
  | 'runner_task'
  | 'runner_mount'
  | 'terminal_session'
  | 'files'
  | 'usage_audit'
  | 'provider_quota'
  | 'endpoint_credentials'
  | 'managed_credentials'
  | 'internal_k8s'
  | 'runner_image'
  | 'keycloak'
  | 'local_ports'
  | 'shared_local_substrate'
  | 'release_campaign_root'
  | 'visual_artifacts';

export const CURRENT_REAL_SESSION_EVIDENCE_OWNER_IDS = [
  'current-gate-result:test-backend-real-core',
  'current-gate-result:lane-backend-real-core',
  'current-gate-result:gate-release',
  'current-gate-result:lane-backend-real-release',
  'current-gate-result:gate-release-full',
  'release-campaign-step:gate-release',
  'backend-real-substrate:core',
  'backend-real-runner:external-chat',
  'backend-real-runner:external-notebook',
  'backend-real-runner:context-store-isolation',
  'backend-real-runner:terminal',
  'backend-real-runner:internal-chat',
  'backend-real-runner:internal-notebook',
  'backend-real-files:file-library',
  'backend-real-files:management-ux',
  'backend-real-governance:identity',
  'backend-real-governance:usage-audit',
  'backend-real-provider:credential',
  'backend-real-provider:api-key-endpoint',
  'backend-real-release:visual-review',
  'backend-real-release:user-story',
] as const;

export type CurrentRealSessionEvidenceOwnerId = (typeof CURRENT_REAL_SESSION_EVIDENCE_OWNER_IDS)[number];

export interface CurrentRealSessionCoverageEntry {
  id: string;
  source_kind: CurrentRealSessionCoverageSourceKind;
  gate_id?: string;
  campaign_id?: CurrentVerificationCampaignId;
  campaign_step_id?: string;
  npm_script?: string;
  spec?: string;
  grep?: string;
  proposed_shard_id: CurrentRealSessionProposedShardId;
  evidence_owner: CurrentRealSessionEvidenceOwnerId;
  isolation_level: CurrentRealSessionIsolationLevel;
  mutable_resources: readonly CurrentRealSessionMutableResource[];
  lock_ids: readonly string[];
  merge_allowed: boolean;
  reason: string;
}

export interface CurrentRealSessionCoverageManifest {
  schema: typeof CURRENT_REAL_SESSION_COVERAGE_MANIFEST_SCHEMA;
  version: typeof CURRENT_REAL_SESSION_COVERAGE_MANIFEST_VERSION;
  coverage: readonly CurrentRealSessionCoverageEntry[];
}

export interface CurrentRealSessionCoverageSourceReference {
  source_kind: CurrentRealSessionCoverageSourceKind;
  gate_id?: string;
  campaign_id?: CurrentVerificationCampaignId;
  campaign_step_id?: string;
  npm_script?: string;
  spec?: string;
  grep?: string;
}

export interface CurrentRealSessionCoverageManifestFailure {
  index: number;
  id?: string;
  path: string;
  reason: string;
}

export interface CurrentRealSessionCoverageDiscoveryOptions {
  packageScripts?: Record<string, string>;
  readShellFile?: (relativePath: string) => string | undefined;
  includeStaticSourceFiles?: boolean;
}

export interface CurrentRealSessionCoverageSourceDiscoveryResult {
  sources: readonly CurrentRealSessionCoverageSourceReference[];
  failures: readonly CurrentRealSessionCoverageManifestFailure[];
}

export type CurrentRealSessionCoverageManifestValidationResult =
  | {
      ok: true;
      value: CurrentRealSessionCoverageManifest;
    }
  | {
      ok: false;
      failures: readonly CurrentRealSessionCoverageManifestFailure[];
    };

const BACKEND_REAL_LOCK_IDS = [
  'shared-local-substrate',
  'fixed-local-ports',
  'backend-real-provider-quota',
  'provider-secret-profile',
] as const;

const RELEASE_BACKEND_REAL_LOCK_IDS = [
  ...BACKEND_REAL_LOCK_IDS,
  'release-campaign-root-writes',
] as const;

const LOCAL_MANUAL_RUNNER_LOCK_IDS = [
  'shared-local-substrate',
  'fixed-local-ports',
  'runtime-current-aliases',
] as const;

const DESTRUCTIVE_BACKEND_REAL_LOCK_IDS = [
  'shared-local-substrate',
  'destructive-lifecycle',
] as const;

const PROVIDER_CREDENTIAL_LOCK_IDS = [
  'provider-secret-profile',
] as const;

const TOP_LEVEL_FIELDS = ['schema', 'version', 'coverage'] as const;
const ENTRY_FIELDS = [
  'id',
  'source_kind',
  'gate_id',
  'campaign_id',
  'campaign_step_id',
  'npm_script',
  'spec',
  'grep',
  'proposed_shard_id',
  'evidence_owner',
  'isolation_level',
  'mutable_resources',
  'lock_ids',
  'merge_allowed',
  'reason',
] as const;
const SOURCE_REFERENCE_FIELDS = [
  'gate_id',
  'campaign_id',
  'campaign_step_id',
  'npm_script',
  'spec',
  'grep',
] as const;
const REQUIRED_ENTRY_FIELDS = [
  'id',
  'source_kind',
  'proposed_shard_id',
  'evidence_owner',
  'isolation_level',
  'mutable_resources',
  'lock_ids',
  'merge_allowed',
  'reason',
] as const;
const SOURCE_KINDS = [
  'current_gate',
  'release_campaign_step',
  'npm_script',
  'playwright_spec',
  'playwright_grep',
] as const satisfies readonly CurrentRealSessionCoverageSourceKind[];
const SOURCE_REFERENCE_ALLOWED_FIELDS = {
  current_gate: ['gate_id', 'npm_script'],
  release_campaign_step: ['campaign_id', 'campaign_step_id', 'gate_id', 'npm_script'],
  npm_script: ['npm_script'],
  playwright_spec: ['spec'],
  playwright_grep: ['spec', 'grep'],
} as const satisfies Record<CurrentRealSessionCoverageSourceKind, readonly (typeof SOURCE_REFERENCE_FIELDS)[number][]>;
const PROPOSED_SHARD_IDS = [
  'backend-real-substrate',
  'identity-governance',
  'files',
  'external-chat-runner',
  'external-notebook-context',
  'terminal-runtime',
  'usage-audit',
  'internal-k8s',
  'provider-credential',
  'api-key-endpoint',
  'release-backend-real',
] as const satisfies readonly CurrentRealSessionProposedShardId[];
const ISOLATION_LEVELS = [
  'process',
  'workspace',
  'db-checkpoint',
  'serialized',
] as const satisfies readonly CurrentRealSessionIsolationLevel[];
const MUTABLE_RESOURCES = [
  'workspace',
  'project',
  'ws_default',
  'fixed_user',
  'context_store',
  'runner_task',
  'runner_mount',
  'terminal_session',
  'files',
  'usage_audit',
  'provider_quota',
  'endpoint_credentials',
  'managed_credentials',
  'internal_k8s',
  'runner_image',
  'keycloak',
  'local_ports',
  'shared_local_substrate',
  'release_campaign_root',
  'visual_artifacts',
] as const satisfies readonly CurrentRealSessionMutableResource[];
const FORBIDDEN_RUNTIME_FIELDS = new Set([
  'status',
  'runtime_status',
  'runtime_truth',
  'runtimeTruth',
  'verdict',
  'passed',
  'failed',
  'claim_id',
  'claimId',
  'evidence_claim_id',
  'result_status',
  'exit_code',
  'failure_class',
  'started_at',
  'finished_at',
  'pid',
  'retry_count',
  'cache_hit',
  'claim_reuse',
]);
const HIGH_RISK_MERGE_RESOURCES = new Set<CurrentRealSessionMutableResource>([
  'ws_default',
  'fixed_user',
  'context_store',
  'runner_mount',
  'terminal_session',
  'usage_audit',
  'provider_quota',
  'endpoint_credentials',
  'managed_credentials',
  'internal_k8s',
  'runner_image',
  'shared_local_substrate',
  'release_campaign_root',
]);
const HIGH_RISK_MERGE_LOCK_IDS = new Set([
  'shared-local-substrate',
  'destructive-lifecycle',
  'fixed-local-ports',
  'runtime-current-aliases',
  'release-campaign-root-writes',
  'backend-real-provider-quota',
  'provider-secret-profile',
]);
const GENERIC_IDS = new Set(['', 'coverage', 'mapping', 'source', 'gate', 'script', 'spec', 'grep']);
const TOP_LEVEL_FIELD_SET = new Set<string>(TOP_LEVEL_FIELDS);
const ENTRY_FIELD_SET = new Set<string>(ENTRY_FIELDS);
const REQUIRED_ENTRY_FIELD_SET = new Set<string>(REQUIRED_ENTRY_FIELDS);
const SOURCE_KIND_SET = new Set<string>(SOURCE_KINDS);
const SHARD_ID_SET = new Set<string>(PROPOSED_SHARD_IDS);
const ISOLATION_LEVEL_SET = new Set<string>(ISOLATION_LEVELS);
const MUTABLE_RESOURCE_SET = new Set<string>(MUTABLE_RESOURCES);
const EVIDENCE_OWNER_SET = new Set<string>(CURRENT_REAL_SESSION_EVIDENCE_OWNER_IDS);
const EXPLICIT_REAL_SESSION_NPM_SCRIPTS = new Set([
  'test:api-key-endpoint-access',
  'test:e2e:integration:agents:chat',
  'test:e2e:integration:notebook',
  'test:e2e:integration:notebook:docker',
]);
const REQUIRED_SPEC_SOURCE_FILES = [
  'scripts/workspace-project-default-gate.sh',
  'scripts/backend-real-run.sh',
  'scripts/backend-real-full-gate.sh',
  'scripts/skills-runtime-backend-real-gate.sh',
  'scripts/chat-runtime-backend-real-gate.sh',
  'scripts/run-internal-chat-real-gate.sh',
  'scripts/run-internal-notebook-real-gate.sh',
  'scripts/member-isolation-backend-real-gate.sh',
  'scripts/workspace-governance-switch-gate.sh',
  'scripts/api-key-endpoint-access-gate.sh',
  'scripts/backend-real-visual-review.sh',
  'scripts/run-integration-release-user-story.sh',
  'scripts/notebook-real-smoke-gate.sh',
  'scripts/files-management-ux-real-gate.sh',
  'scripts/notebook-terminal-ux-real-gate.sh',
] as const;

interface ScriptCoverageDefaults {
  proposed_shard_id: CurrentRealSessionProposedShardId;
  evidence_owner: CurrentRealSessionEvidenceOwnerId;
  isolation_level: CurrentRealSessionIsolationLevel;
  mutable_resources: readonly CurrentRealSessionMutableResource[];
  lock_ids: readonly string[];
  reason: string;
}

function toIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defineCoverage(entry: CurrentRealSessionCoverageEntry): CurrentRealSessionCoverageEntry {
  return entry;
}

function currentGateCoverage(input: {
  gate_id: string;
  proposed_shard_id: CurrentRealSessionProposedShardId;
  evidence_owner: CurrentRealSessionEvidenceOwnerId;
  isolation_level: CurrentRealSessionIsolationLevel;
  mutable_resources: readonly CurrentRealSessionMutableResource[];
  lock_ids: readonly string[];
  reason: string;
}): CurrentRealSessionCoverageEntry {
  const gate = findCurrentGateDefinitionById(input.gate_id);
  if (!gate) {
    throw new Error(`Missing current gate for real session coverage: ${input.gate_id}`);
  }

  return defineCoverage({
    id: `current-gate-${input.gate_id}`,
    source_kind: 'current_gate',
    gate_id: gate.id,
    npm_script: gate.npmScript,
    proposed_shard_id: input.proposed_shard_id,
    evidence_owner: input.evidence_owner,
    isolation_level: input.isolation_level,
    mutable_resources: input.mutable_resources,
    lock_ids: input.lock_ids,
    merge_allowed: false,
    reason: input.reason,
  });
}

function releaseCampaignStepCoverage(input: {
  campaign_id: CurrentVerificationCampaignId;
  campaign_step_id: string;
  proposed_shard_id: CurrentRealSessionProposedShardId;
  evidence_owner: CurrentRealSessionEvidenceOwnerId;
  isolation_level: CurrentRealSessionIsolationLevel;
  mutable_resources: readonly CurrentRealSessionMutableResource[];
  lock_ids: readonly string[];
  reason: string;
}): CurrentRealSessionCoverageEntry {
  const campaign = findCurrentVerificationCampaignById(input.campaign_id);
  const step = campaign?.steps.find((candidate) => candidate.id === input.campaign_step_id);
  if (!campaign || !step) {
    throw new Error(`Missing campaign step for real session coverage: ${input.campaign_id}/${input.campaign_step_id}`);
  }

  return defineCoverage({
    id: `campaign-step-${input.campaign_id}-${input.campaign_step_id}`,
    source_kind: 'release_campaign_step',
    campaign_id: input.campaign_id,
    campaign_step_id: step.id,
    gate_id: step.gateId,
    npm_script: step.npmScript,
    proposed_shard_id: input.proposed_shard_id,
    evidence_owner: input.evidence_owner,
    isolation_level: input.isolation_level,
    mutable_resources: input.mutable_resources,
    lock_ids: input.lock_ids,
    merge_allowed: false,
    reason: input.reason,
  });
}

function npmScriptCoverage(
  npmScript: string,
  defaults: ScriptCoverageDefaults,
): CurrentRealSessionCoverageEntry {
  return defineCoverage({
    id: `npm-script-${toIdPart(npmScript)}`,
    source_kind: 'npm_script',
    npm_script: npmScript,
    proposed_shard_id: defaults.proposed_shard_id,
    evidence_owner: defaults.evidence_owner,
    isolation_level: defaults.isolation_level,
    mutable_resources: defaults.mutable_resources,
    lock_ids: defaults.lock_ids,
    merge_allowed: false,
    reason: defaults.reason,
  });
}

function npmScriptCoverageGroup(
  npmScripts: readonly string[],
  defaults: ScriptCoverageDefaults,
): readonly CurrentRealSessionCoverageEntry[] {
  return npmScripts.map((npmScript) => npmScriptCoverage(npmScript, defaults));
}

function specCoverage(input: {
  spec: string;
  proposed_shard_id: CurrentRealSessionProposedShardId;
  evidence_owner: CurrentRealSessionEvidenceOwnerId;
  isolation_level: CurrentRealSessionIsolationLevel;
  mutable_resources: readonly CurrentRealSessionMutableResource[];
  lock_ids: readonly string[];
  reason: string;
}): CurrentRealSessionCoverageEntry {
  return defineCoverage({
    id: `playwright-spec-${toIdPart(input.spec)}`,
    source_kind: 'playwright_spec',
    spec: input.spec,
    proposed_shard_id: input.proposed_shard_id,
    evidence_owner: input.evidence_owner,
    isolation_level: input.isolation_level,
    mutable_resources: input.mutable_resources,
    lock_ids: input.lock_ids,
    merge_allowed: false,
    reason: input.reason,
  });
}

function grepCoverage(input: {
  spec: string;
  grep: string;
  proposed_shard_id: CurrentRealSessionProposedShardId;
  evidence_owner: CurrentRealSessionEvidenceOwnerId;
  isolation_level: CurrentRealSessionIsolationLevel;
  mutable_resources: readonly CurrentRealSessionMutableResource[];
  lock_ids: readonly string[];
  reason: string;
}): CurrentRealSessionCoverageEntry {
  return defineCoverage({
    id: `playwright-grep-${toIdPart(input.spec)}-${toIdPart(input.grep)}`,
    source_kind: 'playwright_grep',
    spec: input.spec,
    grep: input.grep,
    proposed_shard_id: input.proposed_shard_id,
    evidence_owner: input.evidence_owner,
    isolation_level: input.isolation_level,
    mutable_resources: input.mutable_resources,
    lock_ids: input.lock_ids,
    merge_allowed: false,
    reason: input.reason,
  });
}

const CURRENT_GATE_COVERAGE = [
  currentGateCoverage({
    gate_id: 'test-backend-real-core',
    proposed_shard_id: 'identity-governance',
    evidence_owner: 'current-gate-result:test-backend-real-core',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'ws_default', 'fixed_user', 'keycloak', 'shared_local_substrate'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Default-tier backend-real gate mutates ws_default and shared local substrate, so it remains serialized until workspace isolation is proven.',
  }),
  currentGateCoverage({
    gate_id: 'lane-backend-real-core',
    proposed_shard_id: 'backend-real-substrate',
    evidence_owner: 'current-gate-result:lane-backend-real-core',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'ws_default', 'fixed_user', 'provider_quota', 'shared_local_substrate'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Core backend-real lane owns the current backend-real wrapper stack and cannot merge before session-level reset/isolation exists.',
  }),
  currentGateCoverage({
    gate_id: 'gate-release',
    proposed_shard_id: 'release-backend-real',
    evidence_owner: 'current-gate-result:gate-release',
    isolation_level: 'process',
    mutable_resources: ['release_campaign_root', 'provider_quota', 'visual_artifacts', 'shared_local_substrate'],
    lock_ids: RELEASE_BACKEND_REAL_LOCK_IDS,
    reason: 'Release gate delegates backend-real evidence ownership and writes campaign-scoped evidence, so it stays process-isolated.',
  }),
  currentGateCoverage({
    gate_id: 'lane-backend-real-release',
    proposed_shard_id: 'release-backend-real',
    evidence_owner: 'current-gate-result:lane-backend-real-release',
    isolation_level: 'process',
    mutable_resources: ['release_campaign_root', 'provider_quota', 'visual_artifacts', 'internal_k8s', 'shared_local_substrate'],
    lock_ids: RELEASE_BACKEND_REAL_LOCK_IDS,
    reason: 'Release backend-real lane starts its own API/Web/runner/internal-k8s flow and owns release UX trace evidence.',
  }),
  currentGateCoverage({
    gate_id: 'gate-release-full',
    proposed_shard_id: 'release-backend-real',
    evidence_owner: 'current-gate-result:gate-release-full',
    isolation_level: 'serialized',
    mutable_resources: ['release_campaign_root'],
    lock_ids: ['release-campaign-root-writes'],
    reason: 'Aggregate-only release gate consumes backend-real campaign evidence but does not create a mergeable session shard.',
  }),
] as const satisfies readonly CurrentRealSessionCoverageEntry[];

const CAMPAIGN_STEP_COVERAGE = [
  releaseCampaignStepCoverage({
    campaign_id: 'release-full',
    campaign_step_id: 'gate-release',
    proposed_shard_id: 'release-backend-real',
    evidence_owner: 'release-campaign-step:gate-release',
    isolation_level: 'process',
    mutable_resources: ['release_campaign_root', 'provider_quota', 'visual_artifacts', 'internal_k8s', 'shared_local_substrate'],
    lock_ids: RELEASE_BACKEND_REAL_LOCK_IDS,
    reason: 'release-full/gate-release is the campaign backend-real evidence owner and cannot merge with other campaign writers.',
  }),
] as const satisfies readonly CurrentRealSessionCoverageEntry[];

const NPM_SCRIPT_COVERAGE = [
  ...npmScriptCoverageGroup([
    'backend-real:bootstrap',
    'backend-real:ready',
    'backend-real:report',
  ], {
    proposed_shard_id: 'backend-real-substrate',
    evidence_owner: 'backend-real-substrate:core',
    isolation_level: 'serialized',
    mutable_resources: ['shared_local_substrate', 'local_ports', 'keycloak', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Backend-real substrate and core aliases share fixed local services and provider profile state.',
  }),
  ...npmScriptCoverageGroup([
    'backend-real:run',
    'lane:backend-real:core',
    'verify:real',
    'test:e2e:lane:backend-real',
  ], {
    proposed_shard_id: 'backend-real-substrate',
    evidence_owner: 'current-gate-result:lane-backend-real-core',
    isolation_level: 'serialized',
    mutable_resources: [
      'workspace',
      'project',
      'runner_task',
      'context_store',
      'files',
      'usage_audit',
      'provider_quota',
      'shared_local_substrate',
    ],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'The backend-real lane can execute broad integration coverage across identity, runner, files, usage/audit, and provider quota state.',
  }),
  ...npmScriptCoverageGroup([
    'backend-real:reset',
  ], {
    proposed_shard_id: 'backend-real-substrate',
    evidence_owner: 'backend-real-substrate:core',
    isolation_level: 'process',
    mutable_resources: ['shared_local_substrate', 'local_ports'],
    lock_ids: DESTRUCTIVE_BACKEND_REAL_LOCK_IDS,
    reason: 'Reset is destructive local substrate lifecycle work and cannot merge into any shard session.',
  }),
  ...npmScriptCoverageGroup([
    'test:backend-real:core',
  ], {
    proposed_shard_id: 'identity-governance',
    evidence_owner: 'current-gate-result:test-backend-real-core',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'ws_default', 'fixed_user', 'keycloak', 'shared_local_substrate'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'The current default backend-real script uses fixed workspace/project fixtures and must stay serialized.',
  }),
  ...npmScriptCoverageGroup([
    'gate:release',
    'lane:backend-real:release',
    'verify:release-real',
  ], {
    proposed_shard_id: 'release-backend-real',
    evidence_owner: 'current-gate-result:lane-backend-real-release',
    isolation_level: 'process',
    mutable_resources: ['release_campaign_root', 'provider_quota', 'visual_artifacts', 'internal_k8s', 'shared_local_substrate'],
    lock_ids: RELEASE_BACKEND_REAL_LOCK_IDS,
    reason: 'Release backend-real adapters own campaign evidence roots and cannot be merged with non-release shards.',
  }),
  ...npmScriptCoverageGroup([
    'gate:release:full',
  ], {
    proposed_shard_id: 'release-backend-real',
    evidence_owner: 'current-gate-result:gate-release-full',
    isolation_level: 'serialized',
    mutable_resources: ['release_campaign_root'],
    lock_ids: ['release-campaign-root-writes'],
    reason: 'gate:release:full is aggregate-only over a release campaign root and does not execute backend-real shards.',
  }),
  ...npmScriptCoverageGroup([
    'test:skills:backend-real',
    'test:notebook:runner:backend-real',
  ], {
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:external-notebook',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'context_store', 'runner_task', 'runner_mount', 'managed_credentials', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Notebook skill runtime checks mutate task/member Context Store state and runner workspaces.',
  }),
  ...npmScriptCoverageGroup([
    'test:chat:runner:backend-real',
    'test:e2e:integration:agents:chat',
    'test:e2e:integration:chat:real',
    'test:e2e:integration:chat:real:with-api',
  ], {
    proposed_shard_id: 'external-chat-runner',
    evidence_owner: 'backend-real-runner:external-chat',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'provider_quota', 'usage_audit'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Chat runner real checks share provider quota, usage/audit, and current runner task state.',
  }),
  ...npmScriptCoverageGroup([
    'test:e2e:integration:member-isolation',
    'test:e2e:integration:workspace-governance-switch',
  ], {
    proposed_shard_id: 'identity-governance',
    evidence_owner: 'backend-real-governance:identity',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'ws_default', 'fixed_user', 'usage_audit', 'keycloak'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Identity and workspace governance checks rely on shared users, ws_default, and audit/usage side effects.',
  }),
  ...npmScriptCoverageGroup([
    'test:internal:backend-real:chat',
  ], {
    proposed_shard_id: 'internal-k8s',
    evidence_owner: 'backend-real-runner:internal-chat',
    isolation_level: 'process',
    mutable_resources: ['internal_k8s', 'runner_image', 'runner_mount', 'runner_task', 'files', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Internal chat runner coverage owns a kind namespace, runner image, CSI mount, and sandbox lifecycle.',
  }),
  ...npmScriptCoverageGroup([
    'test:internal:backend-real:ownership',
    'test:internal:backend-real:notebook-workspace',
  ], {
    proposed_shard_id: 'internal-k8s',
    evidence_owner: 'backend-real-runner:internal-notebook',
    isolation_level: 'process',
    mutable_resources: ['internal_k8s', 'runner_image', 'runner_mount', 'runner_task', 'files', 'context_store', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Internal notebook ownership coverage uses shared kind/CSI state and cannot merge before namespace and mount isolation are proven.',
  }),
  ...npmScriptCoverageGroup([
    'test:notebook:backend-real:smoke',
    'test:e2e:integration:notebook',
    'test:e2e:integration:notebook:docker',
  ], {
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:external-notebook',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'context_store', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Notebook smoke uses the same backend-real substrate and seeded notebook project.',
  }),
  ...npmScriptCoverageGroup([
    'test:notebook:backend-real:terminal',
    'test:notebook:backend-real:terminal:internal',
    'test:notebook:backend-real:terminal:matrix',
    'test:notebook:release:strict',
    'test:e2e:integration:notebook:terminal:ux',
  ], {
    proposed_shard_id: 'terminal-runtime',
    evidence_owner: 'backend-real-runner:terminal',
    isolation_level: 'serialized',
    mutable_resources: ['terminal_session', 'runner_task', 'runner_mount', 'context_store', 'internal_k8s', 'shared_local_substrate'],
    lock_ids: LOCAL_MANUAL_RUNNER_LOCK_IDS,
    reason: 'Terminal runtime checks use local-manual current state, runner socket state, and terminal sessions.',
  }),
  ...npmScriptCoverageGroup([
    'test:agents:backend-real:runner',
  ], {
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:external-notebook',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'runner_mount', 'context_store', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Combined external runner script spans chat and notebook runner specs on one backend-real substrate.',
  }),
  ...npmScriptCoverageGroup([
    'test:e2e:integration:files:management-ux',
    'test:files:backend-real:smoke',
    'test:files:backend-real:sync',
    'test:files:backend-real:ui-sync',
    'test:files:release:strict',
  ], {
    proposed_shard_id: 'files',
    evidence_owner: 'backend-real-files:file-library',
    isolation_level: 'serialized',
    mutable_resources: ['files', 'project', 'runner_mount', 'shared_local_substrate', 'local_ports'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Files real checks mutate file libraries and local JuiceFS mount state, so they remain serialized.',
  }),
  ...npmScriptCoverageGroup([
    'test:feishu:real:credential',
  ], {
    proposed_shard_id: 'provider-credential',
    evidence_owner: 'backend-real-provider:credential',
    isolation_level: 'serialized',
    mutable_resources: ['managed_credentials', 'provider_quota'],
    lock_ids: PROVIDER_CREDENTIAL_LOCK_IDS,
    reason: 'Managed credential checks cross the provider secret boundary and are not mergeable with session shards.',
  }),
  ...npmScriptCoverageGroup([
    'test:api-key-endpoint-access',
  ], {
    proposed_shard_id: 'api-key-endpoint',
    evidence_owner: 'backend-real-provider:api-key-endpoint',
    isolation_level: 'serialized',
    mutable_resources: ['endpoint_credentials', 'provider_quota', 'shared_local_substrate'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'API key endpoint access uses shared endpoint credentials and provider quota.',
  }),
  ...npmScriptCoverageGroup([
    'test:visual:backend-real:review',
  ], {
    proposed_shard_id: 'release-backend-real',
    evidence_owner: 'backend-real-release:visual-review',
    isolation_level: 'process',
    mutable_resources: ['visual_artifacts', 'provider_quota', 'shared_local_substrate'],
    lock_ids: RELEASE_BACKEND_REAL_LOCK_IDS,
    reason: 'Backend-real visual review writes release review artifacts and UX trace bundles.',
  }),
] as const satisfies readonly CurrentRealSessionCoverageEntry[];

const SPEC_COVERAGE = [
  specCoverage({
    spec: 'e2e/integration-minimal.spec.ts',
    proposed_shard_id: 'identity-governance',
    evidence_owner: 'backend-real-governance:identity',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'ws_default', 'fixed_user', 'keycloak'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Minimal backend-real spec uses the default workspace/project bootstrap path.',
  }),
  specCoverage({
    spec: 'e2e/integration-system-notebook-default.spec.ts',
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:external-notebook',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'context_store', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'System notebook default smoke exercises seeded notebook state and runner task creation.',
  }),
  specCoverage({
    spec: 'e2e/integration-chat-llm-runner.spec.ts',
    proposed_shard_id: 'external-chat-runner',
    evidence_owner: 'backend-real-runner:external-chat',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'provider_quota', 'usage_audit'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Full chat runner spec shares runner task and provider quota state.',
  }),
  grepCoverage({
    spec: 'e2e/integration-chat-llm-runner.spec.ts',
    grep: 'streams multi-turn chat through the real local chat runner and persists replies',
    proposed_shard_id: 'external-chat-runner',
    evidence_owner: 'backend-real-runner:external-chat',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'provider_quota', 'usage_audit'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Chat stream grep mutates real conversation and provider quota state.',
  }),
  grepCoverage({
    spec: 'e2e/integration-chat-llm-runner.spec.ts',
    grep: 'preserves conversation continuity across refresh with story-bound trace evidence',
    proposed_shard_id: 'external-chat-runner',
    evidence_owner: 'backend-real-runner:external-chat',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'provider_quota', 'usage_audit'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Chat continuity grep writes story-bound trace evidence and conversation state.',
  }),
  grepCoverage({
    spec: 'e2e/integration-chat-llm-runner.spec.ts',
    grep: 'warns and recreates the session workspace when the local chat workspace has been reclaimed',
    proposed_shard_id: 'external-chat-runner',
    evidence_owner: 'backend-real-runner:external-chat',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'runner_mount', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Chat workspace reclaim coverage intentionally mutates runner workspace lifecycle state.',
  }),
  specCoverage({
    spec: 'e2e/integration-chat.spec.ts',
    proposed_shard_id: 'external-chat-runner',
    evidence_owner: 'backend-real-runner:external-chat',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'provider_quota', 'usage_audit'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Chat backend-real spec touches provider quota and persisted thread state.',
  }),
  grepCoverage({
    spec: 'e2e/integration-chat.spec.ts',
    grep: 'stop escalation resyncs authoritative thread truth after refresh and keeps composer ready',
    proposed_shard_id: 'external-chat-runner',
    evidence_owner: 'backend-real-runner:external-chat',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'provider_quota', 'usage_audit'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Stop escalation grep mutates authoritative thread state and usage/audit observations.',
  }),
  grepCoverage({
    spec: 'e2e/integration-chat.spec.ts',
    grep: 'real deepseek',
    proposed_shard_id: 'external-chat-runner',
    evidence_owner: 'backend-real-runner:external-chat',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'provider_quota', 'usage_audit'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Real completion grep consumes provider quota and writes persisted chat output.',
  }),
  specCoverage({
    spec: 'e2e/integration-notebook-codex-runner.spec.ts',
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:external-notebook',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'runner_mount', 'context_store', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Full notebook runner spec uses task workspaces, runner mount, and Context Store state.',
  }),
  grepCoverage({
    spec: 'e2e/integration-notebook-codex-runner.spec.ts',
    grep: 'docker',
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:external-notebook',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'runner_mount', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Notebook docker grep mutates runner workspace and depends on local runner substrate.',
  }),
  grepCoverage({
    spec: 'e2e/integration-notebook-codex-runner.spec.ts',
    grep: 'reads task context through mbos-context in a real notebook codex runner task',
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:external-notebook',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'context_store', 'runner_mount'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Task Context Store read coverage depends on task-owned context and runner mount state.',
  }),
  grepCoverage({
    spec: 'e2e/integration-notebook-codex-runner.spec.ts',
    grep: 'writes task context through mbos-context and persists it for the task owner',
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:external-notebook',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'context_store', 'runner_mount'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Task Context Store write coverage mutates owner-scoped task context.',
  }),
  grepCoverage({
    spec: 'e2e/integration-notebook-codex-runner.spec.ts',
    grep: 'uses jira-ops task context before member context in a real notebook codex runner task',
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:external-notebook',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'context_store', 'runner_mount'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Context precedence coverage mutates shared task/member context ordering.',
  }),
  grepCoverage({
    spec: 'e2e/integration-notebook-codex-runner.spec.ts',
    grep: 'uses feishu-docs managed credential projection in a real notebook codex runner task',
    proposed_shard_id: 'provider-credential',
    evidence_owner: 'backend-real-provider:credential',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'runner_task', 'context_store', 'managed_credentials', 'runner_mount'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Managed credential projection crosses the secret profile boundary and must stay serialized.',
  }),
  grepCoverage({
    spec: 'e2e/integration-notebook-codex-runner.spec.ts',
    grep: 'reads task context through mbos-context inside a real notebook terminal session',
    proposed_shard_id: 'terminal-runtime',
    evidence_owner: 'backend-real-runner:terminal',
    isolation_level: 'serialized',
    mutable_resources: ['terminal_session', 'runner_task', 'context_store', 'runner_mount'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Terminal Context Store read coverage shares task terminal session state.',
  }),
  grepCoverage({
    spec: 'e2e/integration-notebook-codex-runner.spec.ts',
    grep: 'rejects shared workspace context writes inside a real notebook terminal session',
    proposed_shard_id: 'terminal-runtime',
    evidence_owner: 'backend-real-runner:terminal',
    isolation_level: 'serialized',
    mutable_resources: ['terminal_session', 'runner_task', 'context_store', 'runner_mount'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Terminal Context Store write rejection intentionally probes shared workspace write boundaries.',
  }),
  grepCoverage({
    spec: 'e2e/integration-context-store-isolation.spec.ts',
    grep: 'member context stays private between workspace members',
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:context-store-isolation',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'fixed_user', 'context_store'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Member context isolation uses fixed workspace members and private Context Store state.',
  }),
  grepCoverage({
    spec: 'e2e/integration-context-store-isolation.spec.ts',
    grep: 'task context stays private to the task owner within the same workspace',
    proposed_shard_id: 'external-notebook-context',
    evidence_owner: 'backend-real-runner:context-store-isolation',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'fixed_user', 'context_store', 'runner_task'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Task context isolation mutates task-owner context in the same shared workspace.',
  }),
  specCoverage({
    spec: 'e2e/integration-membership-chat-isolation.spec.ts',
    proposed_shard_id: 'identity-governance',
    evidence_owner: 'backend-real-governance:identity',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'fixed_user', 'runner_task', 'usage_audit'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Membership chat isolation uses fixed member identities and chat runner side effects.',
  }),
  specCoverage({
    spec: 'e2e/integration-external-task-isolation.spec.ts',
    proposed_shard_id: 'identity-governance',
    evidence_owner: 'backend-real-governance:identity',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'fixed_user', 'runner_task', 'context_store'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'External task isolation mutates shared member/task ownership state.',
  }),
  specCoverage({
    spec: 'e2e/integration-usage-self-scope.spec.ts',
    proposed_shard_id: 'usage-audit',
    evidence_owner: 'backend-real-governance:usage-audit',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'fixed_user', 'usage_audit'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Usage self-scope assertions depend on audit/usage observations and fixed users.',
  }),
  specCoverage({
    spec: 'e2e/integration-agent-member-permissions.spec.ts',
    proposed_shard_id: 'identity-governance',
    evidence_owner: 'backend-real-governance:identity',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'fixed_user'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Agent member permission coverage mutates membership and permission fixtures.',
  }),
  specCoverage({
    spec: 'e2e/integration-workspace-project-governance-matrix.spec.ts',
    proposed_shard_id: 'identity-governance',
    evidence_owner: 'backend-real-governance:identity',
    isolation_level: 'serialized',
    mutable_resources: ['workspace', 'project', 'ws_default', 'fixed_user', 'keycloak'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Workspace governance matrix switches identity/workspace policy state and is not mergeable.',
  }),
  specCoverage({
    spec: 'e2e/integration-api-key-gateway.spec.ts',
    proposed_shard_id: 'api-key-endpoint',
    evidence_owner: 'backend-real-provider:api-key-endpoint',
    isolation_level: 'serialized',
    mutable_resources: ['endpoint_credentials', 'provider_quota', 'shared_local_substrate'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'API key gateway coverage mutates endpoint credentials and provider access observations.',
  }),
  specCoverage({
    spec: 'e2e/integration-internal-chat-runner.spec.ts',
    proposed_shard_id: 'internal-k8s',
    evidence_owner: 'backend-real-runner:internal-chat',
    isolation_level: 'process',
    mutable_resources: ['internal_k8s', 'runner_image', 'runner_mount', 'runner_task', 'files', 'provider_quota'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Internal chat spec owns kind/CSI/sandbox lifecycle and runner image state.',
  }),
  specCoverage({
    spec: 'e2e/integration-internal-notebook-workspace.spec.ts',
    proposed_shard_id: 'internal-k8s',
    evidence_owner: 'backend-real-runner:internal-notebook',
    isolation_level: 'process',
    mutable_resources: ['internal_k8s', 'runner_image', 'runner_mount', 'runner_task', 'files', 'context_store'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Internal notebook workspace spec owns namespace, CSI mount, and runner workspace lifecycle.',
  }),
  specCoverage({
    spec: 'e2e/integration-internal-sandbox-reclaim.spec.ts',
    proposed_shard_id: 'internal-k8s',
    evidence_owner: 'backend-real-runner:internal-notebook',
    isolation_level: 'process',
    mutable_resources: ['internal_k8s', 'runner_image', 'runner_mount', 'runner_task', 'files'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Sandbox reclaim coverage intentionally mutates internal workload lifecycle state.',
  }),
  specCoverage({
    spec: 'e2e/integration-visual-review.spec.ts',
    proposed_shard_id: 'release-backend-real',
    evidence_owner: 'backend-real-release:visual-review',
    isolation_level: 'process',
    mutable_resources: ['visual_artifacts', 'provider_quota', 'shared_local_substrate'],
    lock_ids: RELEASE_BACKEND_REAL_LOCK_IDS,
    reason: 'Backend-real visual review writes release review screenshots and UX trace artifacts.',
  }),
  specCoverage({
    spec: 'e2e/integration-release-user-story.spec.ts',
    proposed_shard_id: 'release-backend-real',
    evidence_owner: 'backend-real-release:user-story',
    isolation_level: 'process',
    mutable_resources: ['release_campaign_root', 'internal_k8s', 'runner_image', 'runner_mount', 'files', 'provider_quota'],
    lock_ids: RELEASE_BACKEND_REAL_LOCK_IDS,
    reason: 'Release user story spans backend-real, files, runner, and internal-k8s evidence in one release lane.',
  }),
  specCoverage({
    spec: 'e2e/integration-files-management-ux.spec.ts',
    proposed_shard_id: 'files',
    evidence_owner: 'backend-real-files:management-ux',
    isolation_level: 'serialized',
    mutable_resources: ['files', 'project', 'shared_local_substrate'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Files management UX spec mutates file library UI state on shared backend-real substrate.',
  }),
  specCoverage({
    spec: 'e2e/integration-files-mount-sync.spec.ts',
    proposed_shard_id: 'files',
    evidence_owner: 'backend-real-files:file-library',
    isolation_level: 'serialized',
    mutable_resources: ['files', 'runner_mount', 'project', 'shared_local_substrate'],
    lock_ids: BACKEND_REAL_LOCK_IDS,
    reason: 'Files mount sync spec uses local mount state and shared file library resources.',
  }),
  specCoverage({
    spec: 'e2e/integration-notebook-terminal-ux.spec.ts',
    proposed_shard_id: 'terminal-runtime',
    evidence_owner: 'backend-real-runner:terminal',
    isolation_level: 'serialized',
    mutable_resources: ['terminal_session', 'runner_task', 'runner_mount', 'context_store', 'shared_local_substrate'],
    lock_ids: LOCAL_MANUAL_RUNNER_LOCK_IDS,
    reason: 'Notebook terminal UX coverage depends on local-manual runner socket and terminal session state.',
  }),
] as const satisfies readonly CurrentRealSessionCoverageEntry[];

export const CURRENT_REAL_SESSION_COVERAGE_MANIFEST: CurrentRealSessionCoverageManifest = {
  schema: CURRENT_REAL_SESSION_COVERAGE_MANIFEST_SCHEMA,
  version: CURRENT_REAL_SESSION_COVERAGE_MANIFEST_VERSION,
  coverage: [
    ...CURRENT_GATE_COVERAGE,
    ...CAMPAIGN_STEP_COVERAGE,
    ...NPM_SCRIPT_COVERAGE,
    ...SPEC_COVERAGE,
  ],
};

export function listCurrentRealSessionCoverageEntries(): readonly CurrentRealSessionCoverageEntry[] {
  return CURRENT_REAL_SESSION_COVERAGE_MANIFEST.coverage;
}

export function listCurrentRealSessionCoverageRequiredSources(
  options: CurrentRealSessionCoverageDiscoveryOptions = {},
): readonly CurrentRealSessionCoverageSourceReference[] {
  return discoverCurrentRealSessionCoverageRequiredSources(options).sources;
}

export function discoverCurrentRealSessionCoverageRequiredSources(
  options: CurrentRealSessionCoverageDiscoveryOptions = {},
): CurrentRealSessionCoverageSourceDiscoveryResult {
  const failures: CurrentRealSessionCoverageManifestFailure[] = [];
  const packageScripts = options.packageScripts ?? readPackageScripts(failures);
  const sources: CurrentRealSessionCoverageSourceReference[] = [];

  for (const gate of listCurrentGateDefinitions().filter((definition) => definition.backendRealPolicy === 'required')) {
    sources.push({
      source_kind: 'current_gate',
      gate_id: gate.id,
      npm_script: gate.npmScript,
    });
  }

  for (const campaign of listCurrentVerificationCampaigns()) {
    for (const step of campaign.steps) {
      if (step.lineKind.includes('backend_real') || step.nativeResult?.gateId.includes('backend-real')) {
        sources.push({
          source_kind: 'release_campaign_step',
          campaign_id: campaign.id,
          campaign_step_id: step.id,
          gate_id: step.gateId,
          npm_script: step.npmScript,
        });
      }
    }
  }

  for (const npmScript of listCurrentRealSessionNpmScripts(packageScripts)) {
    sources.push({
      source_kind: 'npm_script',
      npm_script: npmScript,
    });
  }

  sources.push(...listCurrentRealSessionSpecSources(packageScripts, {
    readShellFile: options.readShellFile,
    includeStaticSourceFiles: options.includeStaticSourceFiles,
    failures,
  }));

  return {
    sources: uniqueSourceReferences(sources),
    failures,
  };
}

export function validateCurrentRealSessionCoverageManifest(
  manifest: unknown = CURRENT_REAL_SESSION_COVERAGE_MANIFEST,
  options: {
    requiredSources?: readonly CurrentRealSessionCoverageSourceReference[];
    discoveryFailures?: readonly CurrentRealSessionCoverageManifestFailure[];
    discoveryOptions?: CurrentRealSessionCoverageDiscoveryOptions;
  } = {},
): CurrentRealSessionCoverageManifestValidationResult {
  const failures: CurrentRealSessionCoverageManifestFailure[] = [];
  const packageScripts = options.discoveryOptions?.packageScripts ?? readPackageScripts(failures);

  validateForbiddenRuntimeFields(manifest, 'manifest', -1, undefined, failures);

  if (!isRecord(manifest)) {
    return {
      ok: false,
      failures: [
        ...failures,
        {
          index: -1,
          path: 'manifest',
          reason: 'manifest must be an object.',
        },
      ],
    };
  }

  validateAllowedFields(manifest, TOP_LEVEL_FIELD_SET, 'top-level', 'manifest', -1, undefined, failures);
  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in manifest)) {
      failures.push({
        index: -1,
        path: `manifest.${field}`,
        reason: `${field} is required.`,
      });
    }
  }
  if (manifest.schema !== CURRENT_REAL_SESSION_COVERAGE_MANIFEST_SCHEMA) {
    failures.push({
      index: -1,
      path: 'manifest.schema',
      reason: `schema must be ${CURRENT_REAL_SESSION_COVERAGE_MANIFEST_SCHEMA}.`,
    });
  }
  if (manifest.version !== CURRENT_REAL_SESSION_COVERAGE_MANIFEST_VERSION) {
    failures.push({
      index: -1,
      path: 'manifest.version',
      reason: `version must be ${String(CURRENT_REAL_SESSION_COVERAGE_MANIFEST_VERSION)}.`,
    });
  }
  if (!Array.isArray(manifest.coverage)) {
    failures.push({
      index: -1,
      path: 'manifest.coverage',
      reason: 'coverage must be an array.',
    });
    return {
      ok: false,
      failures,
    };
  }

  validateCoverageEntries(manifest.coverage, packageScripts, failures);
  const discovery = options.requiredSources
    ? { sources: options.requiredSources, failures: options.discoveryFailures ?? [] }
    : discoverCurrentRealSessionCoverageRequiredSources({
        ...options.discoveryOptions,
        packageScripts,
      });
  failures.push(...discovery.failures);
  validateRequiredSources(manifest.coverage, discovery.sources, failures);

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: manifest as CurrentRealSessionCoverageManifest,
  };
}

function listCurrentRealSessionNpmScripts(packageScripts: Record<string, string>): readonly string[] {
  const backendRealGateScripts = listCurrentGateDefinitions()
    .filter((definition) => definition.backendRealPolicy === 'required')
    .map((definition) => definition.npmScript);
  const detectedScripts = Object.entries(packageScripts)
    .filter(([name, command]) => isCurrentRealSessionNpmScript(name, command))
    .map(([name]) => name);

  return [...new Set([...backendRealGateScripts, ...detectedScripts])].sort();
}

function isCurrentRealSessionNpmScript(name: string, command: string): boolean {
  if (/^(manual:|agent:|integration:deps|api:node|dev|start|build|cluster:|demo:|rehearse:|release:status|release:ready|release:aggregate|release:campaign)/.test(name)) {
    return false;
  }

  const searchable = `${name} ${command}`;

  return EXPLICIT_REAL_SESSION_NPM_SCRIPTS.has(name)
    || /^backend-real:/.test(name)
    || /^verify:.*real/.test(name)
    || /backend-real/.test(searchable)
    || /^test:[a-z0-9:-]*:real(?::|$)/.test(name)
    || /^test:e2e:integration:(?:member-isolation|workspace-governance-switch|files:management-ux|notebook:terminal:ux|chat:real(?::with-api)?)/.test(name)
    || /^test:(?:notebook|files):release:strict$/.test(name)
    || /run-integration-e2e-full\.sh/.test(command)
    || /(?:^|\/)scripts\/[a-z0-9-]*(?:real|backend-real)[a-z0-9-]*\.sh/.test(command);
}

function listCurrentRealSessionSpecSources(
  packageScripts: Record<string, string>,
  options: {
    readShellFile?: (relativePath: string) => string | undefined;
    includeStaticSourceFiles?: boolean;
    failures: CurrentRealSessionCoverageManifestFailure[];
  },
): readonly CurrentRealSessionCoverageSourceReference[] {
  const sources: CurrentRealSessionCoverageSourceReference[] = [];
  const readShellFile = options.readShellFile ?? readShellFileFromWorkspace;

  for (const [name, command] of Object.entries(packageScripts)) {
    if (!isCurrentRealSessionNpmScript(name, command)) {
      continue;
    }
    sources.push(...extractSpecSources(command));
    for (const shellFile of extractShellScriptReferences(command)) {
      const shellContent = readShellFile(shellFile);
      if (shellContent === undefined) {
        options.failures.push({
          index: -1,
          path: `package.json.scripts.${name}`,
          reason: `current real session npm script references missing shell file: ${shellFile}.`,
        });
        continue;
      }
      sources.push(...extractSpecSources(shellContent));
    }
  }

  if (options.includeStaticSourceFiles === false) {
    return uniqueSourceReferences(sources);
  }

  for (const relativePath of REQUIRED_SPEC_SOURCE_FILES) {
    const shellContent = readShellFile(relativePath);
    if (shellContent === undefined) {
      continue;
    }
    sources.push(...extractSpecSources(shellContent));
  }

  return uniqueSourceReferences(sources);
}

function readShellFileFromWorkspace(relativePath: string): string | undefined {
  const absolutePath = path.join(process.cwd(), relativePath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  return readFileSync(absolutePath, 'utf8');
}

function extractShellScriptReferences(command: string): readonly string[] {
  const references: string[] = [];
  const patterns = [
    /\b(?:bash|sh)\s+(?:"([^"]*scripts\/[A-Za-z0-9_./-]+\.sh)"|'([^']*scripts\/[A-Za-z0-9_./-]+\.sh)'|([^\s;&|()]*scripts\/[A-Za-z0-9_./-]+\.sh))/g,
    /(?:^|[\s;&|])(?:"([^"]*scripts\/[A-Za-z0-9_./-]+\.sh)"|'([^']*scripts\/[A-Za-z0-9_./-]+\.sh)'|(\.?(?:\/)?[^\s;&|()]*scripts\/[A-Za-z0-9_./-]+\.sh))/g,
  ] as const;

  for (const pattern of patterns) {
    let match = pattern.exec(command);
    while (match) {
      const raw = match[1] ?? match[2] ?? match[3] ?? '';
      const normalized = normalizeShellScriptReference(raw);
      if (normalized) {
        references.push(normalized);
      }
      match = pattern.exec(command);
    }
  }

  return [...new Set(references)];
}

function normalizeShellScriptReference(raw: string): string | undefined {
  const withoutRoot = raw
    .replace(/^\$\{ROOT_DIR\}\//, '')
    .replace(/^\$ROOT_DIR\//, '')
    .replace(/^\.\//, '');
  const scriptIndex = withoutRoot.indexOf('scripts/');
  if (scriptIndex === -1) {
    return undefined;
  }

  return withoutRoot.slice(scriptIndex);
}

function extractSpecSources(content: string): readonly CurrentRealSessionCoverageSourceReference[] {
  const sources: CurrentRealSessionCoverageSourceReference[] = [];
  const runGrepPattern = /run_grep\s+(e2e\/integration-[^\s"']+\.spec\.ts)\s+"([^"]*)"/g;
  let runGrepMatch = runGrepPattern.exec(content);
  while (runGrepMatch) {
    const [, spec, grep] = runGrepMatch;
    sources.push(grep.length > 0
      ? { source_kind: 'playwright_grep', spec, grep }
      : { source_kind: 'playwright_spec', spec });
    runGrepMatch = runGrepPattern.exec(content);
  }

  const specPattern = /e2e\/integration-[A-Za-z0-9_./-]+\.spec\.ts/g;
  let specMatch = specPattern.exec(content);
  while (specMatch) {
    const spec = specMatch[0];
    const lineStart = content.lastIndexOf('\n', specMatch.index);
    const lineEnd = content.indexOf('\n', specMatch.index);
    const line = content.slice(lineStart + 1, lineEnd === -1 ? content.length : lineEnd);

    if (/run_grep\s+/.test(line)) {
      specMatch = specPattern.exec(content);
      continue;
    }

    const afterSpec = line.slice(line.indexOf(spec) + spec.length).split('&&', 1)[0] ?? '';
    const grep = extractGrepValue(afterSpec);
    sources.push(grep
      ? { source_kind: 'playwright_grep', spec, grep }
      : { source_kind: 'playwright_spec', spec });
    specMatch = specPattern.exec(content);
  }

  return uniqueSourceReferences(sources);
}

function extractGrepValue(value: string): string | undefined {
  const match = /--grep\s+(?:"([^"]+)"|'([^']+)'|([^\s&;]+))/.exec(value);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function uniqueSourceReferences(
  sources: readonly CurrentRealSessionCoverageSourceReference[],
): readonly CurrentRealSessionCoverageSourceReference[] {
  const seen = new Set<string>();
  const output: CurrentRealSessionCoverageSourceReference[] = [];

  for (const source of sources) {
    const key = sourceReferenceKey(source);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(source);
  }

  return output;
}

function sourceReferenceKey(source: CurrentRealSessionCoverageSourceReference): string {
  switch (source.source_kind) {
    case 'current_gate':
      return `current_gate:${source.gate_id ?? ''}`;
    case 'release_campaign_step':
      return `release_campaign_step:${source.campaign_id ?? ''}:${source.campaign_step_id ?? ''}`;
    case 'npm_script':
      return `npm_script:${source.npm_script ?? ''}`;
    case 'playwright_spec':
      return `playwright_spec:${source.spec ?? ''}`;
    case 'playwright_grep':
      return `playwright_grep:${source.spec ?? ''}:${source.grep ?? ''}`;
  }
}

function validateCoverageEntries(
  entries: readonly unknown[],
  packageScripts: Record<string, string>,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  const seenIds = new Set<string>();
  const lockIds = new Set(listCurrentResourceLocks().map((lock) => lock.id));

  entries.forEach((entry, index) => {
    if (!isRecord(entry)) {
      failures.push({
        index,
        path: `coverage[${index}]`,
        reason: 'coverage entry must be an object.',
      });
      return;
    }

    const id = typeof entry.id === 'string' ? entry.id : undefined;
    validateAllowedFields(entry, ENTRY_FIELD_SET, 'coverage entry', `coverage[${index}]`, index, id, failures);
    for (const field of REQUIRED_ENTRY_FIELD_SET) {
      if (!(field in entry)) {
        failures.push({
          index,
          id,
          path: `coverage[${index}].${field}`,
          reason: `${field} is required.`,
        });
      }
    }

    validateId(entry.id, index, seenIds, failures);
    validateEnum(entry.source_kind, SOURCE_KIND_SET, 'source_kind', index, id, failures);
    validateEnum(entry.proposed_shard_id, SHARD_ID_SET, 'proposed_shard_id', index, id, failures);
    validateEnum(entry.evidence_owner, EVIDENCE_OWNER_SET, 'evidence_owner', index, id, failures);
    validateEnum(entry.isolation_level, ISOLATION_LEVEL_SET, 'isolation_level', index, id, failures);
    validateStringArray(entry.mutable_resources, 'mutable_resources', index, id, failures, MUTABLE_RESOURCE_SET);
    validateStringArray(entry.lock_ids, 'lock_ids', index, id, failures, lockIds);
    validateBoolean(entry.merge_allowed, 'merge_allowed', index, id, failures);
    validateRequiredString(entry.reason, 'reason', index, id, failures);
    validateSourceReference(entry, packageScripts, index, id, failures);
    validateMergeSafety(entry, index, id, failures);
  });
}

function validateSourceReference(
  entry: Record<string, unknown>,
  packageScripts: Record<string, string>,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  validateSourceReferenceFieldCompatibility(entry, index, id, failures);

  if (typeof entry.npm_script === 'string' && !(entry.npm_script in packageScripts)) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].npm_script`,
      reason: `unknown npm script "${entry.npm_script}".`,
    });
  }
  if (typeof entry.gate_id === 'string' && !findCurrentGateDefinitionById(entry.gate_id)) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].gate_id`,
      reason: `unknown gate id "${entry.gate_id}".`,
    });
  }
  if (typeof entry.spec === 'string') {
    if (!/^e2e\/integration-[A-Za-z0-9_.-]+\.spec\.ts$/.test(entry.spec)) {
      failures.push({
        index,
        id,
        path: `coverage[${index}].spec`,
        reason: 'spec must reference a current e2e integration spec.',
      });
    } else if (!existsSync(path.join(process.cwd(), entry.spec))) {
      failures.push({
        index,
        id,
        path: `coverage[${index}].spec`,
        reason: `unknown spec reference "${entry.spec}".`,
      });
    }
  }

  switch (entry.source_kind) {
    case 'current_gate':
      validateCurrentGateSource(entry, index, id, failures);
      return;
    case 'release_campaign_step':
      validateReleaseCampaignStepSource(entry, index, id, failures);
      return;
    case 'npm_script':
      validateRequiredString(entry.npm_script, 'npm_script', index, id, failures);
      return;
    case 'playwright_spec':
      validateRequiredString(entry.spec, 'spec', index, id, failures);
      return;
    case 'playwright_grep':
      validateRequiredString(entry.spec, 'spec', index, id, failures);
      validateRequiredString(entry.grep, 'grep', index, id, failures);
      return;
    default:
      return;
  }
}

function validateSourceReferenceFieldCompatibility(
  entry: Record<string, unknown>,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  if (typeof entry.source_kind !== 'string' || !SOURCE_KIND_SET.has(entry.source_kind)) {
    return;
  }

  const sourceKind = entry.source_kind as CurrentRealSessionCoverageSourceKind;
  const allowedFields = new Set<string>(SOURCE_REFERENCE_ALLOWED_FIELDS[sourceKind]);

  for (const field of SOURCE_REFERENCE_FIELDS) {
    if (!(field in entry) || allowedFields.has(field)) {
      continue;
    }

    failures.push({
      index,
      id,
      path: `coverage[${index}].${field}`,
      reason: `${sourceKind} coverage must not declare ${field}.`,
    });
  }
}

function validateCurrentGateSource(
  entry: Record<string, unknown>,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  if (typeof entry.gate_id !== 'string') {
    validateRequiredString(entry.gate_id, 'gate_id', index, id, failures);
    return;
  }
  const gate = findCurrentGateDefinitionById(entry.gate_id);
  if (!gate) {
    return;
  }
  if (entry.npm_script !== gate.npmScript) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].npm_script`,
      reason: `current_gate coverage npm_script must match gate ${entry.gate_id}.`,
    });
  }
}

function validateReleaseCampaignStepSource(
  entry: Record<string, unknown>,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  validateRequiredString(entry.campaign_id, 'campaign_id', index, id, failures);
  validateRequiredString(entry.campaign_step_id, 'campaign_step_id', index, id, failures);

  if (typeof entry.campaign_id !== 'string' || typeof entry.campaign_step_id !== 'string') {
    return;
  }

  const campaign = findCurrentVerificationCampaignById(entry.campaign_id);
  const step = campaign?.steps.find((candidate) => candidate.id === entry.campaign_step_id);
  if (!campaign || !step) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].campaign_step_id`,
      reason: `unknown release campaign step "${entry.campaign_id}/${entry.campaign_step_id}".`,
    });
    return;
  }

  if (entry.gate_id !== step.gateId) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].gate_id`,
      reason: `release_campaign_step coverage gate_id must match ${entry.campaign_id}/${entry.campaign_step_id}.`,
    });
  }
  if (entry.npm_script !== step.npmScript) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].npm_script`,
      reason: `release_campaign_step coverage npm_script must match ${entry.campaign_id}/${entry.campaign_step_id}.`,
    });
  }
}

function validateRequiredSources(
  entries: readonly unknown[],
  requiredSources: readonly CurrentRealSessionCoverageSourceReference[],
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  const recordEntries = entries.filter(isRecord);

  for (const source of requiredSources) {
    if (recordEntries.some((entry) => entryCoversSource(entry, source))) {
      continue;
    }

    failures.push({
      index: -1,
      path: 'manifest.coverage',
      reason: `missing current real session coverage source: ${describeSource(source)}.`,
    });
  }
}

function entryCoversSource(
  entry: Record<string, unknown>,
  source: CurrentRealSessionCoverageSourceReference,
): boolean {
  switch (source.source_kind) {
    case 'current_gate':
      return entry.source_kind === 'current_gate' && entry.gate_id === source.gate_id;
    case 'release_campaign_step':
      return entry.source_kind === 'release_campaign_step'
        && entry.campaign_id === source.campaign_id
        && entry.campaign_step_id === source.campaign_step_id;
    case 'npm_script':
      return entry.source_kind === 'npm_script' && entry.npm_script === source.npm_script;
    case 'playwright_spec':
      return entry.source_kind === 'playwright_spec' && entry.spec === source.spec;
    case 'playwright_grep':
      return entry.source_kind === 'playwright_grep'
        && entry.spec === source.spec
        && entry.grep === source.grep;
  }
}

function describeSource(source: CurrentRealSessionCoverageSourceReference): string {
  switch (source.source_kind) {
    case 'current_gate':
      return `current_gate:${source.gate_id ?? '<missing>'}`;
    case 'release_campaign_step':
      return `release_campaign_step:${source.campaign_id ?? '<missing>'}/${source.campaign_step_id ?? '<missing>'}`;
    case 'npm_script':
      return `npm_script:${source.npm_script ?? '<missing>'}`;
    case 'playwright_spec':
      return `playwright_spec:${source.spec ?? '<missing>'}`;
    case 'playwright_grep':
      return `playwright_grep:${source.spec ?? '<missing>'} --grep ${source.grep ?? '<missing>'}`;
  }
}

function validateMergeSafety(
  entry: Record<string, unknown>,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  if (entry.merge_allowed !== true) {
    return;
  }

  if (entry.isolation_level === 'serialized' || entry.isolation_level === 'process') {
    failures.push({
      index,
      id,
      path: `coverage[${index}].merge_allowed`,
      reason: 'merge_allowed=true is only allowed for workspace or db-checkpoint isolated coverage.',
    });
  }

  const mutableResources = Array.isArray(entry.mutable_resources)
    ? entry.mutable_resources.filter((value): value is CurrentRealSessionMutableResource => typeof value === 'string' && MUTABLE_RESOURCE_SET.has(value))
    : [];
  const lockIds = Array.isArray(entry.lock_ids)
    ? entry.lock_ids.filter((value): value is string => typeof value === 'string')
    : [];

  if (mutableResources.some((resource) => HIGH_RISK_MERGE_RESOURCES.has(resource))) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].merge_allowed`,
      reason: 'merge_allowed=true is not allowed for ws_default, Context Store, runner mount, usage/audit, provider quota, internal-k8s, or shared local substrate resources.',
    });
  }
  if (lockIds.some((lockId) => HIGH_RISK_MERGE_LOCK_IDS.has(lockId))) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].merge_allowed`,
      reason: 'merge_allowed=true is not allowed while high-risk real-lane locks are required.',
    });
  }
}

function readPackageScripts(failures: CurrentRealSessionCoverageManifestFailure[] = []): Record<string, string> {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as unknown;
    if (!isRecord(packageJson) || !isRecord(packageJson.scripts)) {
      failures.push({
        index: -1,
        path: 'package.json.scripts',
        reason: 'package.json scripts must be readable for current real session coverage validation.',
      });
      return {};
    }

    const scripts: Record<string, string> = {};
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      if (typeof command === 'string') {
        scripts[name] = command;
      }
    }
    return scripts;
  } catch (error: unknown) {
    failures.push({
      index: -1,
      path: 'package.json',
      reason: `package.json scripts must be readable for current real session coverage validation: ${String(error)}`,
    });
    return {};
  }
}

function validateAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  label: string,
  ownerPath: string,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      failures.push({
        index,
        id,
        path: `${ownerPath}.${key}`,
        reason: `unknown ${label} field "${key}".`,
      });
    }
  }
}

function validateForbiddenRuntimeFields(
  value: unknown,
  ownerPath: string,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, entryIndex) => {
      validateForbiddenRuntimeFields(entry, `${ownerPath}[${entryIndex}]`, entryIndex, undefined, failures);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const currentId = typeof value.id === 'string' ? value.id : id;
  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_RUNTIME_FIELDS.has(key)) {
      failures.push({
        index,
        id: currentId,
        path: `${ownerPath}.${key}`,
        reason: `forbidden runtime truth field "${key}".`,
      });
    }
    validateForbiddenRuntimeFields(nestedValue, `${ownerPath}.${key}`, index, currentId, failures);
  }
}

function validateId(
  value: unknown,
  index: number,
  seenIds: Set<string>,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  if (typeof value !== 'string') {
    failures.push({
      index,
      path: `coverage[${index}].id`,
      reason: 'id must be a stable non-generic kebab-case string.',
    });
    return;
  }

  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) || GENERIC_IDS.has(value)) {
    failures.push({
      index,
      id: value,
      path: `coverage[${index}].id`,
      reason: 'id must be a stable non-generic kebab-case string.',
    });
  }
  if (seenIds.has(value)) {
    failures.push({
      index,
      id: value,
      path: `coverage[${index}].id`,
      reason: `duplicate coverage id "${value}".`,
    });
    return;
  }
  seenIds.add(value);
}

function validateEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  if (typeof value !== 'string' || !allowed.has(value)) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].${field}`,
      reason: `${field} is required and must be one of the current real session coverage schema values.`,
    });
  }
}

function validateStringArray(
  value: unknown,
  field: string,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
  allowedValues?: ReadonlySet<string>,
): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].${field}`,
      reason: `${field} must be a string array.`,
    });
    return;
  }

  const seen = new Set<string>();
  value.forEach((item, itemIndex) => {
    if (seen.has(item)) {
      failures.push({
        index,
        id,
        path: `coverage[${index}].${field}[${itemIndex}]`,
        reason: `duplicate ${field} value "${item}".`,
      });
    }
    seen.add(item);

    if (allowedValues && !allowedValues.has(item)) {
      failures.push({
        index,
        id,
        path: `coverage[${index}].${field}[${itemIndex}]`,
        reason: `unknown ${field} value "${item}".`,
      });
    }
  });
}

function validateBoolean(
  value: unknown,
  field: string,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  if (typeof value !== 'boolean') {
    failures.push({
      index,
      id,
      path: `coverage[${index}].${field}`,
      reason: `${field} must be boolean.`,
    });
  }
}

function validateRequiredString(
  value: unknown,
  field: string,
  index: number,
  id: string | undefined,
  failures: CurrentRealSessionCoverageManifestFailure[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push({
      index,
      id,
      path: `coverage[${index}].${field}`,
      reason: `${field} is required.`,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
