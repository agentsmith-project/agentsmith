import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PRODUCT_VERIFICATION_FLOW_IDS,
  type ProductVerificationFlowId,
} from '../unified-deploy/check-verification-report';
import {
  POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION,
  POST_DEPLOY_PRODUCT_SMOKE_PRODUCER,
  POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME,
  AGENTSMITH_POST_DEPLOY_PRODUCT_SMOKE_REPO,
  POST_DEPLOY_PRODUCT_SMOKE_SPECS,
  type PostDeployProductSmokeId,
} from './constants';
import {
  validateAgentSmithReleaseContract,
  type CurrentReleaseBoundaryValidationFailure,
} from '../governance/current-release-boundary-schema';

export {
  POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION,
  POST_DEPLOY_PRODUCT_SMOKE_PRODUCER,
  POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME,
  AGENTSMITH_POST_DEPLOY_PRODUCT_SMOKE_REPO,
  POST_DEPLOY_PRODUCT_SMOKE_SPECS,
  type PostDeployProductSmokeId,
} from './constants';

export const PRODUCT_FLOWS_AGGREGATE_SCHEMA_VERSION =
  'agentsmith.unified-deploy.product-flows.aggregate/v1' as const;
export const PRODUCT_FLOWS_AGGREGATE_PRODUCER =
  'unified-deploy-product-flows' as const;
export const PRODUCT_FLOWS_AGGREGATE_COMMAND =
  'npm run lane:unified-deploy:product-flows' as const;
export const FOCUSED_PRODUCT_FLOW_EVIDENCE_SCHEMA_VERSION =
  'agentsmith.focused-product-flow.evidence/v1' as const;

export type ProviderNeutralEndpointProof = {
  endpoint_type: 'custom';
  provider_family: 'custom';
  upstream_protocol: 'openai_chat_completions';
  credential_type: 'api_key';
  success_path: 'provider_neutral_endpoint';
};

export type PostDeployProductSmokeResult = {
  id: PostDeployProductSmokeId;
  status: 'passed';
  label: string;
  source_flow: ProductVerificationFlowId;
  source_evidence_path: string;
  source_evidence_sha256: string;
  proof?: ProviderNeutralEndpointProof;
};

type EvidenceFileDigest = {
  path: string;
  sha256: string;
};

type DeploymentTargetBinding = {
  profile: string;
  public_base_url: string;
  api_base_url: string;
  runner_public_api_base_url?: string;
  site_env: EvidenceFileDigest;
  substrate_truth: EvidenceFileDigest;
};

export type PostDeployProductSmokeReport = {
  schema_version: typeof POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION;
  producer: typeof POST_DEPLOY_PRODUCT_SMOKE_PRODUCER;
  owner: 'agentsmith';
  repo: typeof AGENTSMITH_POST_DEPLOY_PRODUCT_SMOKE_REPO;
  status: 'passed';
  generated_at: string;
  source: {
    product_flows_path: string;
    product_flows_sha256: string;
    aggregate_schema_version: typeof PRODUCT_FLOWS_AGGREGATE_SCHEMA_VERSION;
    aggregate_producer: typeof PRODUCT_FLOWS_AGGREGATE_PRODUCER;
    aggregate_generated_at?: string;
    aggregate_command: typeof PRODUCT_FLOWS_AGGREGATE_COMMAND;
  };
  release_contract: {
    path: string;
    input_sha256: string;
    release_id: string;
    git_sha: string;
  };
  deployment_target: DeploymentTargetBinding;
  smoke_results: Record<PostDeployProductSmokeId, PostDeployProductSmokeResult>;
  failures: [];
  paths: {
    report_path: string;
  };
};

export type PostDeployProductSmokeReportOptions = {
  productFlowsPath: string;
  releaseContractPath: string;
  outputDir?: string;
  pathRoot: string;
  now?: () => Date;
};

export type PostDeployProductSmokeReportResult = {
  status: 'passed';
  report: PostDeployProductSmokeReport;
  reportPath: string;
};

type CliOptions = {
  productFlowsPath: string;
  releaseContractPath: string;
  outputDir?: string;
  pathRoot: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function requireExactString(
  record: Record<string, unknown>,
  key: string,
  expected: string,
  pathLabel: string,
): void {
  const value = stringValue(record, key);
  if (value === expected) {
    return;
  }
  if (key === 'producer') {
    throw new Error(`${pathLabel}.${key} must be ${expected}; release-kit producers are not accepted.`);
  }
  if (pathLabel === 'product_flows' && key === 'command') {
    throw new Error(
      `${pathLabel}.${key} must be ${expected}; focused diagnostic aggregates are not accepted for post-deploy product smoke.`,
    );
  }
  throw new Error(`${pathLabel}.${key} must be ${expected}.`);
}

function sha256Digest(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

type JsonRecordFile = {
  record: Record<string, unknown>;
  input_sha256: string;
};

async function readJsonRecordFile(filePath: string, label: string): Promise<JsonRecordFile> {
  const raw = await readFile(filePath);
  const parsed = JSON.parse(raw.toString('utf8')) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return {
    record: parsed,
    input_sha256: sha256Digest(raw),
  };
}

type ReleaseContractBinding = {
  path: string;
  input_sha256: string;
  release_id: string;
  git_sha: string;
};

function formatValidationFailures(failures: readonly CurrentReleaseBoundaryValidationFailure[]): string {
  return failures.map((failure) => `${failure.path}: ${failure.reason}`).join('; ');
}

async function readReleaseContractBinding(
  releaseContractPath: string,
  reportReleaseContractPath: string,
): Promise<ReleaseContractBinding> {
  const raw = await readFile(releaseContractPath);
  const parsed = JSON.parse(raw.toString('utf8')) as unknown;
  const validation = validateAgentSmithReleaseContract(parsed);
  if (!validation.ok) {
    throw new Error(
      `release_contract failed full release contract validation: ${formatValidationFailures(validation.failures)}`,
    );
  }
  return {
    path: reportReleaseContractPath,
    input_sha256: sha256Digest(raw),
    release_id: validation.value.release_id,
    git_sha: validation.value.git_sha,
  };
}

function parseJsonRecord(source: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(source) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

function validateAggregateEnvelope(aggregate: Record<string, unknown>): void {
  requireExactString(
    aggregate,
    'schema_version',
    PRODUCT_FLOWS_AGGREGATE_SCHEMA_VERSION,
    'product_flows',
  );
  requireExactString(
    aggregate,
    'producer',
    PRODUCT_FLOWS_AGGREGATE_PRODUCER,
    'product_flows',
  );
  requireExactString(
    aggregate,
    'command',
    PRODUCT_FLOWS_AGGREGATE_COMMAND,
    'product_flows',
  );
  requireExactString(aggregate, 'status', 'passed', 'product_flows');

  if (!Array.isArray(aggregate.failures)) {
    throw new Error('product_flows.failures must be an array with no entries.');
  }
  if (aggregate.failures.length > 0) {
    throw new Error('product_flows.failures must be empty for a post-deploy product smoke report.');
  }
}

function flowMapFromAggregate(aggregate: Record<string, unknown>): Map<string, Record<string, unknown>> {
  if (!Array.isArray(aggregate.flows)) {
    throw new Error('product_flows.flows must be an array.');
  }

  const flows = new Map<string, Record<string, unknown>>();
  for (const flowValue of aggregate.flows) {
    const flow = asRecord(flowValue);
    const flowId = stringValue(flow, 'flow');
    if (!flowId) {
      throw new Error('product_flows.flows entries must include flow.');
    }
    if (flows.has(flowId)) {
      throw new Error(`product_flows.flows contains duplicate source flow: ${flowId}.`);
    }
    flows.set(flowId, flow);
  }

  return flows;
}

function validateRequiredSourceFlows(flowMap: Map<string, Record<string, unknown>>): void {
  for (const sourceFlow of PRODUCT_VERIFICATION_FLOW_IDS) {
    const flow = flowMap.get(sourceFlow);
    if (!flow) {
      throw new Error(`product_flows.flows is missing required source flow: ${sourceFlow}.`);
    }
    requireExactString(
      flow,
      'schema_version',
      FOCUSED_PRODUCT_FLOW_EVIDENCE_SCHEMA_VERSION,
      `product_flows.flows.${sourceFlow}`,
    );
    requireExactString(
      flow,
      'producer',
      PRODUCT_FLOWS_AGGREGATE_PRODUCER,
      `product_flows.flows.${sourceFlow}`,
    );
    if (stringValue(flow, 'status') !== 'passed') {
      throw new Error(`product_flows.flows.${sourceFlow}.status must be passed.`);
    }
  }
}

function requireNestedExpectedString(
  record: Record<string, unknown>,
  key: string,
  expected: string,
  pathLabel: string,
  issues: string[],
): void {
  const value = stringValue(record, key);
  if (value !== expected) {
    issues.push(`${pathLabel}.${key} must be ${expected}`);
  }
}

const PROVIDER_SPECIFIC_SUCCESS_MARKER_KEYS = new Set([
  'oauth_provider',
  'managed_credential_provider',
  'provider_specific_skill',
  'provider_specific_success',
]);

function collectProviderSpecificSuccessMarkers(
  value: unknown,
  pathLabel: string,
  issues: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectProviderSpecificSuccessMarkers(entry, `${pathLabel}[${index}]`, issues);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedPath = `${pathLabel}.${key}`;
    if (PROVIDER_SPECIFIC_SUCCESS_MARKER_KEYS.has(key)) {
      issues.push(`${nestedPath} is not allowed`);
    }
    if (key === 'credential_type' && nestedValue === 'oauth') {
      issues.push(`${nestedPath}=oauth is not allowed`);
    }
    if (key === 'success_path' && nestedValue === 'provider_specific_saas') {
      issues.push(`${nestedPath}=provider_specific_saas is not allowed`);
    }
    collectProviderSpecificSuccessMarkers(nestedValue, nestedPath, issues);
  }
}

function assertNoProviderSpecificSuccessMarkers(
  evidence: Record<string, unknown>,
  pathLabel: string,
): void {
  const issues: string[] = [];
  collectProviderSpecificSuccessMarkers(evidence, pathLabel, issues);
  if (issues.length > 0) {
    throw new Error(
      `${pathLabel} provider-specific SaaS/OAuth/skill success markers are not allowed in canonical post-deploy product smoke evidence: ${issues.join('; ')}.`,
    );
  }
}

function validateProviderNeutralEndpointEvidence(
  evidence: Record<string, unknown>,
  pathLabel: string,
): ProviderNeutralEndpointProof {
  const checks = asRecord(evidence.checks);
  const providerNeutralEndpoint = asRecord(checks.provider_neutral_endpoint);
  const issues: string[] = [];

  requireNestedExpectedString(
    providerNeutralEndpoint,
    'endpoint_type',
    'custom',
    `${pathLabel}.checks.provider_neutral_endpoint`,
    issues,
  );
  requireNestedExpectedString(
    providerNeutralEndpoint,
    'provider_family',
    'custom',
    `${pathLabel}.checks.provider_neutral_endpoint`,
    issues,
  );
  requireNestedExpectedString(
    providerNeutralEndpoint,
    'upstream_protocol',
    'openai_chat_completions',
    `${pathLabel}.checks.provider_neutral_endpoint`,
    issues,
  );
  requireNestedExpectedString(
    providerNeutralEndpoint,
    'credential_type',
    'api_key',
    `${pathLabel}.checks.provider_neutral_endpoint`,
    issues,
  );
  requireNestedExpectedString(
    providerNeutralEndpoint,
    'success_path',
    'provider_neutral_endpoint',
    `${pathLabel}.checks.provider_neutral_endpoint`,
    issues,
  );

  for (const forbiddenField of ['oauth_provider', 'managed_credential_provider', 'provider_specific_skill']) {
    if (Object.prototype.hasOwnProperty.call(providerNeutralEndpoint, forbiddenField)) {
      issues.push(`${pathLabel}.checks.provider_neutral_endpoint.${forbiddenField} is not allowed`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `${pathLabel}.checks.provider_neutral_endpoint must prove the provider-neutral Endpoint success path: ${issues.join('; ')}.`,
    );
  }

  return {
    endpoint_type: 'custom',
    provider_family: 'custom',
    upstream_protocol: 'openai_chat_completions',
    credential_type: 'api_key',
    success_path: 'provider_neutral_endpoint',
  };
}

function sourceEvidencePath(
  aggregate: Record<string, unknown>,
  resolvedAggregatePath: string,
  sourceFlow: ProductVerificationFlowId,
): string {
  if (!isRecord(aggregate.flow_evidence_paths)) {
    throw new Error('product_flows.flow_evidence_paths must be an object binding every required source flow.');
  }
  const flowEvidencePaths = aggregate.flow_evidence_paths;
  const rawPath = flowEvidencePaths[sourceFlow];
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error(`product_flows.flow_evidence_paths.${sourceFlow} is required.`);
  }

  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(path.dirname(resolvedAggregatePath), rawPath);
}

function resolveFocusedEvidencePaths(
  aggregate: Record<string, unknown>,
  resolvedAggregatePath: string,
): Record<ProductVerificationFlowId, string> {
  return Object.fromEntries(PRODUCT_VERIFICATION_FLOW_IDS.map((sourceFlow) => [
    sourceFlow,
    sourceEvidencePath(aggregate, resolvedAggregatePath, sourceFlow),
  ])) as Record<ProductVerificationFlowId, string>;
}

type FocusedEvidenceValidation = {
  digests: Record<ProductVerificationFlowId, string>;
  providerNeutralEndpointProof: ProviderNeutralEndpointProof;
};

async function validateFocusedEvidenceFiles(
  evidencePaths: Record<ProductVerificationFlowId, string>,
): Promise<FocusedEvidenceValidation> {
  const digests: Partial<Record<ProductVerificationFlowId, string>> = {};
  let providerNeutralEndpointProof: ProviderNeutralEndpointProof | undefined;
  for (const sourceFlow of PRODUCT_VERIFICATION_FLOW_IDS) {
    const evidencePath = evidencePaths[sourceFlow];
    let evidence: Record<string, unknown>;
    let raw: Buffer;
    try {
      raw = await readFile(evidencePath);
      evidence = parseJsonRecord(
        raw.toString('utf8'),
        `product_flows.flow_evidence_paths.${sourceFlow}`,
      );
    } catch (error: unknown) {
      throw new Error(
        `product_flows.flow_evidence_paths.${sourceFlow} must point to readable focused evidence: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    requireExactString(
      evidence,
      'schema_version',
      FOCUSED_PRODUCT_FLOW_EVIDENCE_SCHEMA_VERSION,
      `product_flows.flow_evidence_paths.${sourceFlow}`,
    );
    requireExactString(
      evidence,
      'producer',
      PRODUCT_FLOWS_AGGREGATE_PRODUCER,
      `product_flows.flow_evidence_paths.${sourceFlow}`,
    );
    requireExactString(evidence, 'flow', sourceFlow, `product_flows.flow_evidence_paths.${sourceFlow}`);
    requireExactString(evidence, 'status', 'passed', `product_flows.flow_evidence_paths.${sourceFlow}`);
    if (sourceFlow === 'chat_via_llmup') {
      providerNeutralEndpointProof = validateProviderNeutralEndpointEvidence(
        evidence,
        `product_flows.flow_evidence_paths.${sourceFlow}`,
      );
      assertNoProviderSpecificSuccessMarkers(
        evidence,
        `product_flows.flow_evidence_paths.${sourceFlow}`,
      );
    }
    digests[sourceFlow] = sha256Digest(raw);
  }

  if (!providerNeutralEndpointProof) {
    throw new Error('product_flows.flow_evidence_paths.chat_via_llmup must include provider-neutral endpoint proof.');
  }

  return {
    digests: digests as Record<ProductVerificationFlowId, string>,
    providerNeutralEndpointProof,
  };
}

function buildSmokeResults(
  evidencePaths: Record<ProductVerificationFlowId, string>,
  evidenceSha256: Record<ProductVerificationFlowId, string>,
  providerNeutralEndpointProof: ProviderNeutralEndpointProof,
): Record<PostDeployProductSmokeId, PostDeployProductSmokeResult> {
  return Object.fromEntries(POST_DEPLOY_PRODUCT_SMOKE_SPECS.map((spec) => {
    return [
      spec.id,
      {
        id: spec.id,
        status: 'passed' as const,
        label: spec.label,
        source_flow: spec.source_flow,
        source_evidence_path: evidencePaths[spec.source_flow],
        source_evidence_sha256: evidenceSha256[spec.source_flow],
        ...(spec.id === 'provider_neutral_endpoint' ? { proof: providerNeutralEndpointProof } : {}),
      },
    ];
  })) as Record<PostDeployProductSmokeId, PostDeployProductSmokeResult>;
}

function resolveRequiredPathRoot(pathRoot: string | undefined): string {
  if (pathRoot === undefined) {
    throw new Error('--path-root is required for canonical post-deploy product smoke reports.');
  }
  if (pathRoot.trim().length === 0) {
    throw new Error('--path-root must be a non-empty path.');
  }
  return path.resolve(pathRoot);
}

function pathRelativeToRoot(pathRoot: string, absolutePath: string, label: string): string {
  const relativePath = path.relative(pathRoot, absolutePath);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay under --path-root: ${absolutePath} is outside ${pathRoot}.`);
  }
  return relativePath.replace(/\\/g, '/');
}

function serializePathForReport(absolutePath: string, pathRoot: string, label: string): string {
  return pathRelativeToRoot(pathRoot, absolutePath, label);
}

function serializeEvidencePathsForReport(
  evidencePaths: Record<ProductVerificationFlowId, string>,
  pathRoot: string,
): Record<ProductVerificationFlowId, string> {
  return Object.fromEntries(POST_DEPLOY_PRODUCT_SMOKE_SPECS.map((spec) => [
    spec.source_flow,
    serializePathForReport(
      evidencePaths[spec.source_flow],
      pathRoot,
      `smoke_results.${spec.id}.source_evidence_path`,
    ),
  ])) as Record<ProductVerificationFlowId, string>;
}

type SourceFileBinding = EvidenceFileDigest & {
  source: string;
};

function resolveAggregateSourcePath(
  rawPath: string,
  resolvedAggregatePath: string,
): string {
  return path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(path.dirname(resolvedAggregatePath), rawPath);
}

async function readRequiredAggregateSourceFileBinding(
  aggregate: Record<string, unknown>,
  sourceKey: string,
  resolvedAggregatePath: string,
  pathRoot: string,
  reportPathLabel: string,
): Promise<SourceFileBinding> {
  const source = asRecord(aggregate.source);
  const rawPath = stringValue(source, sourceKey).trim();
  if (!rawPath) {
    throw new Error(`${reportPathLabel} is required.`);
  }

  const resolvedPath = resolveAggregateSourcePath(rawPath, resolvedAggregatePath);
  const reportPath = serializePathForReport(resolvedPath, pathRoot, reportPathLabel);
  let raw: Buffer;
  try {
    raw = await readFile(resolvedPath);
  } catch (error: unknown) {
    throw new Error(
      `${reportPathLabel} must point to a readable file: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    path: reportPath,
    sha256: sha256Digest(raw),
    source: raw.toString('utf8'),
  };
}

function parseEnvValue(source: string, key: string): string {
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 1) {
      continue;
    }
    if (trimmed.slice(0, separatorIndex) !== key) {
      continue;
    }
    return trimmed.slice(separatorIndex + 1).trim();
  }
  return '';
}

function normalizeUrlBinding(value: string): string {
  return value.trim().replace(/\/+$/u, '');
}

function requireSiteEnvValue(source: string, key: string, label: string): string {
  const value = parseEnvValue(source, key);
  if (!value) {
    throw new Error(`${label} must be backed by ${key} from deployment_target.site_env.path.`);
  }
  return value;
}

function assertSiteEnvUrlMatchesSource(input: {
  label: string;
  sourceValue: string;
  envKey: string;
  envValue: string;
}): void {
  if (normalizeUrlBinding(input.sourceValue) !== normalizeUrlBinding(input.envValue)) {
    throw new Error(
      `${input.label} must match ${input.envKey} from deployment_target.site_env.path.`,
    );
  }
}

function buildDeploymentTargetBinding(
  aggregate: Record<string, unknown>,
  siteEnv: SourceFileBinding,
  substrateTruth: SourceFileBinding,
): DeploymentTargetBinding {
  const source = asRecord(aggregate.source);
  const profile = parseEnvValue(siteEnv.source, 'UNIFIED_DEPLOY_PROFILE');
  const publicBaseUrl = stringValue(source, 'public_base_url');
  const apiBaseUrl = stringValue(source, 'api_base_url');
  const runnerPublicApiBaseUrl = stringValue(source, 'runner_public_api_base_url');
  const siteEnvPublicBaseUrl = requireSiteEnvValue(
    siteEnv.source,
    'PUBLIC_BASE_URL',
    'deployment_target.public_base_url',
  );
  const siteEnvApiBaseUrl = parseEnvValue(siteEnv.source, 'PUBLIC_API_BASE_URL');
  const siteEnvRunnerPublicApiBaseUrl = parseEnvValue(siteEnv.source, 'RUNNER_PUBLIC_API_BASE_URL');
  if (!profile) {
    throw new Error('deployment_target.profile is required from deployment_target.site_env.path.');
  }
  if (!publicBaseUrl) {
    throw new Error('deployment_target.public_base_url is required.');
  }
  if (!apiBaseUrl) {
    throw new Error('deployment_target.api_base_url is required.');
  }
  assertSiteEnvUrlMatchesSource({
    label: 'deployment_target.public_base_url',
    sourceValue: publicBaseUrl,
    envKey: 'PUBLIC_BASE_URL',
    envValue: siteEnvPublicBaseUrl,
  });
  if (siteEnvApiBaseUrl) {
    assertSiteEnvUrlMatchesSource({
      label: 'deployment_target.api_base_url',
      sourceValue: apiBaseUrl,
      envKey: 'PUBLIC_API_BASE_URL',
      envValue: siteEnvApiBaseUrl,
    });
  }
  if (runnerPublicApiBaseUrl && siteEnvRunnerPublicApiBaseUrl) {
    assertSiteEnvUrlMatchesSource({
      label: 'deployment_target.runner_public_api_base_url',
      sourceValue: runnerPublicApiBaseUrl,
      envKey: 'RUNNER_PUBLIC_API_BASE_URL',
      envValue: siteEnvRunnerPublicApiBaseUrl,
    });
  }
  const boundRunnerPublicApiBaseUrl = runnerPublicApiBaseUrl || siteEnvRunnerPublicApiBaseUrl;
  return {
    profile,
    public_base_url: publicBaseUrl,
    api_base_url: apiBaseUrl,
    ...(boundRunnerPublicApiBaseUrl
      ? { runner_public_api_base_url: normalizeUrlBinding(boundRunnerPublicApiBaseUrl) }
      : {}),
    site_env: { path: siteEnv.path, sha256: siteEnv.sha256 },
    substrate_truth: { path: substrateTruth.path, sha256: substrateTruth.sha256 },
  };
}

function buildReport(
  aggregate: Record<string, unknown>,
  productFlowsPath: string,
  productFlowsSha256: string,
  releaseContract: ReleaseContractBinding,
  reportPath: string,
  generatedAt: string,
  evidencePaths: Record<ProductVerificationFlowId, string>,
  evidenceSha256: Record<ProductVerificationFlowId, string>,
  providerNeutralEndpointProof: ProviderNeutralEndpointProof,
  deploymentTarget: DeploymentTargetBinding,
): PostDeployProductSmokeReport {
  const aggregateGeneratedAt = stringValue(aggregate, 'generated_at');

  return {
    schema_version: POST_DEPLOY_PRODUCT_SMOKE_REPORT_SCHEMA_VERSION,
    producer: POST_DEPLOY_PRODUCT_SMOKE_PRODUCER,
    owner: 'agentsmith',
    repo: AGENTSMITH_POST_DEPLOY_PRODUCT_SMOKE_REPO,
    status: 'passed',
    generated_at: generatedAt,
    source: {
      product_flows_path: productFlowsPath,
      product_flows_sha256: productFlowsSha256,
      aggregate_schema_version: PRODUCT_FLOWS_AGGREGATE_SCHEMA_VERSION,
      aggregate_producer: PRODUCT_FLOWS_AGGREGATE_PRODUCER,
      ...(aggregateGeneratedAt ? { aggregate_generated_at: aggregateGeneratedAt } : {}),
      aggregate_command: PRODUCT_FLOWS_AGGREGATE_COMMAND,
    },
    release_contract: releaseContract,
    deployment_target: deploymentTarget,
    smoke_results: buildSmokeResults(evidencePaths, evidenceSha256, providerNeutralEndpointProof),
    failures: [],
    paths: {
      report_path: reportPath,
    },
  };
}

export async function runPostDeployProductSmokeReportProducer(
  options: PostDeployProductSmokeReportOptions,
): Promise<PostDeployProductSmokeReportResult> {
  if (typeof options.releaseContractPath !== 'string' || options.releaseContractPath.trim().length === 0) {
    throw new Error('releaseContractPath is required.');
  }

  const resolvedProductFlowsPath = path.resolve(options.productFlowsPath);
  const resolvedReleaseContractPath = path.resolve(options.releaseContractPath);
  const outputDir = path.resolve(options.outputDir ?? path.dirname(resolvedProductFlowsPath));
  const reportPath = path.join(outputDir, POST_DEPLOY_PRODUCT_SMOKE_REPORT_FILENAME);
  const resolvedPathRoot = resolveRequiredPathRoot(options.pathRoot);
  const reportProductFlowsPath = serializePathForReport(
    resolvedProductFlowsPath,
    resolvedPathRoot,
    'source.product_flows_path',
  );
  const reportReportPath = serializePathForReport(
    reportPath,
    resolvedPathRoot,
    'paths.report_path',
  );
  const reportReleaseContractPath = serializePathForReport(
    resolvedReleaseContractPath,
    resolvedPathRoot,
    'release_contract.path',
  );

  const productFlowsFile = await readJsonRecordFile(
    resolvedProductFlowsPath,
    'product-flows aggregate',
  );
  const aggregate = productFlowsFile.record;
  const releaseContract = await readReleaseContractBinding(
    resolvedReleaseContractPath,
    reportReleaseContractPath,
  );
  validateAggregateEnvelope(aggregate);
  const flowMap = flowMapFromAggregate(aggregate);
  validateRequiredSourceFlows(flowMap);
  const evidencePaths = resolveFocusedEvidencePaths(aggregate, resolvedProductFlowsPath);
  const reportEvidencePaths = serializeEvidencePathsForReport(evidencePaths, resolvedPathRoot);
  const focusedEvidence = await validateFocusedEvidenceFiles(evidencePaths);
  const siteEnv = await readRequiredAggregateSourceFileBinding(
    aggregate,
    'site_env_path',
    resolvedProductFlowsPath,
    resolvedPathRoot,
    'deployment_target.site_env.path',
  );
  const substrateTruth = await readRequiredAggregateSourceFileBinding(
    aggregate,
    'substrate_truth_path',
    resolvedProductFlowsPath,
    resolvedPathRoot,
    'deployment_target.substrate_truth.path',
  );
  const deploymentTarget = buildDeploymentTargetBinding(aggregate, siteEnv, substrateTruth);

  await mkdir(outputDir, { recursive: true });
  const report = buildReport(
    aggregate,
    reportProductFlowsPath,
    productFlowsFile.input_sha256,
    releaseContract,
    reportReportPath,
    (options.now ?? (() => new Date()))().toISOString(),
    reportEvidencePaths,
    focusedEvidence.digests,
    focusedEvidence.providerNeutralEndpointProof,
    deploymentTarget,
  );
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return {
    status: 'passed',
    report,
    reportPath,
  };
}

function requireArgValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: Partial<CliOptions> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--product-flows') {
      options.productFlowsPath = requireArgValue(argv, index, '--product-flows');
      index += 1;
    } else if (arg.startsWith('--product-flows=')) {
      options.productFlowsPath = arg.slice('--product-flows='.length);
    } else if (arg === '--release-contract') {
      options.releaseContractPath = requireArgValue(argv, index, '--release-contract');
      index += 1;
    } else if (arg.startsWith('--release-contract=')) {
      options.releaseContractPath = arg.slice('--release-contract='.length);
    } else if (arg === '--output-dir') {
      options.outputDir = requireArgValue(argv, index, '--output-dir');
      index += 1;
    } else if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length);
    } else if (arg === '--path-root') {
      options.pathRoot = requireArgValue(argv, index, '--path-root');
      index += 1;
    } else if (arg.startsWith('--path-root=')) {
      options.pathRoot = arg.slice('--path-root='.length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!options.productFlowsPath) {
    throw new Error('--product-flows is required.');
  }
  if (!options.releaseContractPath || options.releaseContractPath.trim().length === 0) {
    throw new Error('--release-contract is required.');
  }
  if (!options.pathRoot || options.pathRoot.trim().length === 0) {
    throw new Error('--path-root is required for canonical post-deploy product smoke reports.');
  }

  return {
    productFlowsPath: options.productFlowsPath,
    releaseContractPath: options.releaseContractPath,
    ...(options.outputDir ? { outputDir: options.outputDir } : {}),
    pathRoot: options.pathRoot,
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const result = await runPostDeployProductSmokeReportProducer({
    productFlowsPath: options.productFlowsPath,
    releaseContractPath: options.releaseContractPath,
    outputDir: options.outputDir,
    pathRoot: options.pathRoot,
  });

  process.stdout.write(
    `[post-deploy-product-smoke] report passed\n[post-deploy-product-smoke] evidence: ${result.reportPath}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
