import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REPO_ROOT,
  asRecord,
  type CheckFailure,
} from './manifest';

type VerificationReportStatus = 'passed' | 'blocked';
type SectionStatus = 'passed' | 'failed' | 'missing';
type ProductFlowStatus = 'passed' | 'required_not_passed';

export type ProductVerificationFlowId =
  | 'login_profile'
  | 'workspace_project'
  | 'chat_via_llmup'
  | 'agent_task_managed_runner'
  | 'files'
  | 'audit'
  | 'usage';

export const PRODUCT_VERIFICATION_FLOWS: Array<{
  id: ProductVerificationFlowId;
  label: string;
  requiredCommand: string;
  evidenceInput: string;
}> = [
  {
    id: 'login_profile',
    label: 'login/profile',
    requiredCommand: 'npm run test:e2e:integration:minimal:with-api',
    evidenceInput: 'authenticated login/profile backend-real or e2e evidence JSON',
  },
  {
    id: 'workspace_project',
    label: 'workspace/project',
    requiredCommand: 'npm run test:e2e:integration:workspace-governance-switch',
    evidenceInput: 'workspace/project backend-real or e2e evidence JSON',
  },
  {
    id: 'chat_via_llmup',
    label: 'Chat via llmup',
    requiredCommand: 'npm run test:e2e:integration:chat:with-api',
    evidenceInput: 'Chat backend-real evidence proving API -> llmup -> provider path',
  },
  {
    id: 'agent_task_managed_runner',
    label: 'Agent task managed runner',
    requiredCommand: 'npm run test:agent-task:backend-real:runner',
    evidenceInput: 'Agent task managed runner backend-real evidence JSON',
  },
  {
    id: 'files',
    label: 'Files',
    requiredCommand: 'npm run test:files:backend-real:smoke',
    evidenceInput: 'Files object storage/file-library backend-real evidence JSON',
  },
  {
    id: 'audit',
    label: 'audit',
    requiredCommand: 'backend-real audit evidence producer for key actions',
    evidenceInput: 'audit evidence JSON tied to deploy/product actions',
  },
  {
    id: 'usage',
    label: 'usage',
    requiredCommand: 'backend-real usage evidence producer for key actions',
    evidenceInput: 'usage evidence JSON tied to deploy/product actions',
  },
];

export const PRODUCT_VERIFICATION_FLOW_IDS: readonly ProductVerificationFlowId[] =
  PRODUCT_VERIFICATION_FLOWS.map((flow) => flow.id);

type ProductEvidenceInput = Partial<Record<ProductVerificationFlowId, string>>;

type ProductFlowEvidence = {
  status: ProductFlowStatus;
  label: string;
  required_command: string;
  required_evidence_input: string;
  evidence_path?: string;
  producer?: string;
  diagnostic?: string;
};

type VerificationReportEvidence = {
  schema_version: 'agentsmith.unified-deploy.verification-report.evidence/v1';
  producer: 'verification-report';
  status: VerificationReportStatus;
  generated_at: string;
  substrate_status: {
    status: SectionStatus;
    source_evidence_path?: string;
    substrate_truth_fingerprint?: string;
    diagnostic?: string;
  };
  app_rollout_status: {
    status: SectionStatus;
    source_evidence_path?: string;
    rollouts: Array<{ deployment: string; status: string }>;
  };
  ingress_route_probes: {
    status: SectionStatus;
    source_evidence_path?: string;
    probes: Array<{ name: string; status: string; status_code?: number }>;
  };
  llmup_path_config_proof: {
    status: SectionStatus;
    source_evidence_path?: string;
    config_map?: string;
    admin_token_secret?: string;
    readiness_path?: string;
    liveness_path?: string;
    rollout_status?: string;
  };
  product_verification_matrix: Record<ProductVerificationFlowId, ProductFlowEvidence>;
  required_evidence_inputs: Array<{
    flow: ProductVerificationFlowId;
    command: string;
    input: string;
  }>;
  failures: CheckFailure[];
  paths: {
    report_path: string;
    log_path: string;
  };
};

export type VerificationReportProducerOptions = {
  existingClusterSmokePath?: string;
  localKindEvidencePath?: string;
  productEvidence?: ProductEvidenceInput;
  productFlowsAggregatePath?: string;
  evidenceDir?: string;
};

export type VerificationReportProducerResult = {
  status: VerificationReportStatus;
  failures: CheckFailure[];
  evidence: VerificationReportEvidence;
};

const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'artifacts', 'unified-deploy');
const FOCUSED_PRODUCT_FLOW_SCHEMA = 'agentsmith.focused-product-flow.evidence/v1';
const PRODUCT_FLOWS_AGGREGATE_SCHEMA = 'agentsmith.unified-deploy.product-flows.aggregate/v1';
const PRODUCT_FLOWS_PRODUCER = 'unified-deploy-product-flows';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addFailure(failures: CheckFailure[], failurePath: string, message: string): void {
  failures.push({ path: failurePath, message });
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  const source = await readFile(filePath, 'utf8');
  return asRecord(JSON.parse(source) as unknown);
}

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function sourceEvidencePath(options: VerificationReportProducerOptions): string | undefined {
  return options.existingClusterSmokePath ?? options.localKindEvidencePath;
}

function itemStatus(value: unknown): string {
  return stringValue(asRecord(value), 'status');
}

function aggregateStatus(statuses: readonly string[]): SectionStatus {
  if (statuses.length === 0) {
    return 'missing';
  }
  return statuses.every((status) => status === 'passed') ? 'passed' : 'failed';
}

function buildMissingSectionEvidence(sourcePath: string | undefined): Pick<
  VerificationReportEvidence,
  'substrate_status' | 'app_rollout_status' | 'ingress_route_probes' | 'llmup_path_config_proof'
> {
  return {
    substrate_status: {
      status: 'missing',
      ...(sourcePath ? { source_evidence_path: sourcePath } : {}),
      diagnostic: 'unified deploy smoke evidence is required',
    },
    app_rollout_status: {
      status: 'missing',
      ...(sourcePath ? { source_evidence_path: sourcePath } : {}),
      rollouts: [],
    },
    ingress_route_probes: {
      status: 'missing',
      ...(sourcePath ? { source_evidence_path: sourcePath } : {}),
      probes: [],
    },
    llmup_path_config_proof: {
      status: 'missing',
      ...(sourcePath ? { source_evidence_path: sourcePath } : {}),
    },
  };
}

function buildSmokeSections(
  sourcePath: string,
  smokeEvidence: Record<string, unknown>,
): Pick<VerificationReportEvidence, 'substrate_status' | 'app_rollout_status' | 'ingress_route_probes' | 'llmup_path_config_proof'> {
  const rollouts = Array.isArray(smokeEvidence.rollouts) ? smokeEvidence.rollouts.map(asRecord) : [];
  const routeProbes = Array.isArray(smokeEvidence.route_probes) ? smokeEvidence.route_probes.map(asRecord) : [];
  const llmup = asRecord(smokeEvidence.llmup_config_health);
  const smokeStatus = stringValue(smokeEvidence, 'status');
  const substrateFingerprint = stringValue(smokeEvidence, 'substrate_truth_fingerprint');

  return {
    substrate_status: {
      status: smokeStatus === 'passed' && substrateFingerprint ? 'passed' : 'failed',
      source_evidence_path: sourcePath,
      substrate_truth_fingerprint: substrateFingerprint || undefined,
      diagnostic: substrateFingerprint ? undefined : 'substrate truth fingerprint is missing',
    },
    app_rollout_status: {
      status: aggregateStatus(rollouts.map(itemStatus)),
      source_evidence_path: sourcePath,
      rollouts: rollouts.map((rollout) => ({
        deployment: stringValue(rollout, 'deployment'),
        status: stringValue(rollout, 'status'),
      })),
    },
    ingress_route_probes: {
      status: aggregateStatus(routeProbes.map(itemStatus)),
      source_evidence_path: sourcePath,
      probes: routeProbes.map((probe) => {
        const statusCode = asRecord(probe).status_code;
        return {
          name: stringValue(probe, 'name'),
          status: stringValue(probe, 'status'),
          ...(typeof statusCode === 'number' ? { status_code: statusCode } : {}),
        };
      }),
    },
    llmup_path_config_proof: {
      status: stringValue(llmup, 'status') === 'passed' ? 'passed' : 'failed',
      source_evidence_path: sourcePath,
      config_map: stringValue(llmup, 'config_map') || undefined,
      admin_token_secret: stringValue(llmup, 'admin_token_secret') || undefined,
      readiness_path: stringValue(llmup, 'readiness_path') || undefined,
      liveness_path: stringValue(llmup, 'liveness_path') || undefined,
      rollout_status: stringValue(llmup, 'rollout_status') || undefined,
    },
  };
}

async function buildInfrastructureSections(
  options: VerificationReportProducerOptions,
  failures: CheckFailure[],
): Promise<Pick<VerificationReportEvidence, 'substrate_status' | 'app_rollout_status' | 'ingress_route_probes' | 'llmup_path_config_proof'>> {
  const sourcePath = sourceEvidencePath(options);
  if (!sourcePath) {
    addFailure(failures, 'evidence:smoke', 'existing-cluster or local-kind smoke evidence path is required');
    return buildMissingSectionEvidence(undefined);
  }

  const resolved = path.resolve(sourcePath);
  if (!existsSync(resolved)) {
    addFailure(failures, 'evidence:smoke', `smoke evidence file does not exist: ${resolved}`);
    return buildMissingSectionEvidence(resolved);
  }

  try {
    const evidence = await readJsonFile(resolved);
    return buildSmokeSections(resolved, evidence);
  } catch (error: unknown) {
    addFailure(failures, 'evidence:smoke', `smoke evidence must be readable JSON: ${errorMessage(error)}`);
    return buildMissingSectionEvidence(resolved);
  }
}

async function validateProductEvidence(
  flow: ProductVerificationFlowId,
  evidencePath: string,
): Promise<{ ok: true; producer?: string } | { ok: false; diagnostic: string }> {
  const resolved = path.resolve(evidencePath);
  if (!existsSync(resolved)) {
    return { ok: false, diagnostic: `product evidence file does not exist: ${resolved}` };
  }

  try {
    const evidence = await readJsonFile(resolved);
    if (stringValue(evidence, 'schema_version') !== FOCUSED_PRODUCT_FLOW_SCHEMA) {
      return { ok: false, diagnostic: `product evidence schema_version must be ${FOCUSED_PRODUCT_FLOW_SCHEMA}` };
    }
    if (stringValue(evidence, 'producer') !== PRODUCT_FLOWS_PRODUCER) {
      return { ok: false, diagnostic: `product evidence producer must be ${PRODUCT_FLOWS_PRODUCER}` };
    }
    if (stringValue(evidence, 'flow') !== flow || stringValue(evidence, 'status') !== 'passed') {
      return { ok: false, diagnostic: `product evidence must contain flow=${flow} and status=passed` };
    }
    if (!stringValue(evidence, 'command').trim()) {
      return { ok: false, diagnostic: 'product evidence command is required' };
    }
    if (Number.isNaN(Date.parse(stringValue(evidence, 'generated_at')))) {
      return { ok: false, diagnostic: 'product evidence generated_at must be an ISO timestamp' };
    }
    return {
      ok: true,
      producer: PRODUCT_FLOWS_PRODUCER,
    };
  } catch (error: unknown) {
    return { ok: false, diagnostic: `product evidence must be readable JSON: ${errorMessage(error)}` };
  }
}

async function resolveProductEvidenceInput(
  options: VerificationReportProducerOptions,
  failures: CheckFailure[],
): Promise<ProductEvidenceInput> {
  const productEvidence: ProductEvidenceInput = { ...(options.productEvidence ?? {}) };
  const aggregatePath = options.productFlowsAggregatePath;
  if (!aggregatePath) {
    return productEvidence;
  }

  const resolvedAggregatePath = path.resolve(aggregatePath);
  if (!existsSync(resolvedAggregatePath)) {
    addFailure(failures, 'product:aggregate', `product flows aggregate evidence file does not exist: ${resolvedAggregatePath}`);
    return productEvidence;
  }

  try {
    const aggregate = await readJsonFile(resolvedAggregatePath);
    if (stringValue(aggregate, 'schema_version') !== PRODUCT_FLOWS_AGGREGATE_SCHEMA) {
      addFailure(failures, 'product:aggregate', 'product flows aggregate evidence has an unsupported schema_version');
      return productEvidence;
    }
    if (stringValue(aggregate, 'producer') !== PRODUCT_FLOWS_PRODUCER) {
      addFailure(failures, 'product:aggregate', `product flows aggregate evidence producer must be ${PRODUCT_FLOWS_PRODUCER}`);
      return productEvidence;
    }
    if (stringValue(aggregate, 'status') !== 'passed') {
      addFailure(failures, 'product:aggregate', 'product flows aggregate evidence status must be passed');
      return productEvidence;
    }
    if (!stringValue(aggregate, 'command').trim()) {
      addFailure(failures, 'product:aggregate', 'product flows aggregate evidence command is required');
      return productEvidence;
    }
    if (Number.isNaN(Date.parse(stringValue(aggregate, 'generated_at')))) {
      addFailure(failures, 'product:aggregate', 'product flows aggregate evidence generated_at must be an ISO timestamp');
      return productEvidence;
    }

    const flowPaths = asRecord(aggregate.flow_evidence_paths);
    let mappedCount = 0;
    for (const flow of PRODUCT_VERIFICATION_FLOWS) {
      const rawPath = flowPaths[flow.id];
      if (typeof rawPath !== 'string' || !rawPath.trim() || productEvidence[flow.id]) {
        continue;
      }
      mappedCount += 1;
      productEvidence[flow.id] = path.isAbsolute(rawPath)
        ? rawPath
        : path.resolve(path.dirname(resolvedAggregatePath), rawPath);
    }
    if (mappedCount === 0) {
      addFailure(failures, 'product:aggregate', 'product flows aggregate evidence does not map any known focused evidence paths');
    }
  } catch (error: unknown) {
    addFailure(failures, 'product:aggregate', `product flows aggregate evidence must be readable JSON: ${errorMessage(error)}`);
  }

  return productEvidence;
}

async function buildProductMatrix(
  options: VerificationReportProducerOptions,
  failures: CheckFailure[],
): Promise<Record<ProductVerificationFlowId, ProductFlowEvidence>> {
  const resolvedProductEvidence = await resolveProductEvidenceInput(options, failures);
  const entries = await Promise.all(PRODUCT_VERIFICATION_FLOWS.map(async (flow) => {
    const evidencePath = resolvedProductEvidence[flow.id];
    const base = {
      label: flow.label,
      required_command: flow.requiredCommand,
      required_evidence_input: flow.evidenceInput,
      ...(evidencePath ? { evidence_path: path.resolve(evidencePath) } : {}),
    };

    if (!evidencePath) {
      addFailure(failures, `product:${flow.id}`, `${flow.label} requires focused product evidence; route smoke is not enough`);
      return [flow.id, {
        ...base,
        status: 'required_not_passed' as const,
        diagnostic: 'missing focused evidence input',
      }] as const;
    }

    const validation = await validateProductEvidence(flow.id, evidencePath);
    if (!validation.ok) {
      addFailure(failures, `product:${flow.id}`, validation.diagnostic);
      return [flow.id, {
        ...base,
        status: 'required_not_passed' as const,
        diagnostic: validation.diagnostic,
      }] as const;
    }

    return [flow.id, {
      ...base,
      status: 'passed' as const,
      ...(validation.producer ? { producer: validation.producer } : {}),
    }] as const;
  }));

  return Object.fromEntries(entries) as Record<ProductVerificationFlowId, ProductFlowEvidence>;
}

async function buildVerificationReportEvidence(
  options: VerificationReportProducerOptions,
): Promise<Omit<VerificationReportEvidence, 'status' | 'generated_at' | 'paths'>> {
  const failures: CheckFailure[] = [];
  const infrastructure = await buildInfrastructureSections(options, failures);
  const productMatrix = await buildProductMatrix(options, failures);

  return {
    schema_version: 'agentsmith.unified-deploy.verification-report.evidence/v1',
    producer: 'verification-report',
    ...infrastructure,
    product_verification_matrix: productMatrix,
    required_evidence_inputs: PRODUCT_VERIFICATION_FLOWS.map((flow) => ({
      flow: flow.id,
      command: flow.requiredCommand,
      input: flow.evidenceInput,
    })),
    failures,
  };
}

async function writeVerificationReportEvidence(
  evidence: Omit<VerificationReportEvidence, 'status' | 'generated_at' | 'paths'>,
  evidenceDir: string,
): Promise<VerificationReportEvidence> {
  const resolvedEvidenceDir = path.resolve(evidenceDir);
  await mkdir(resolvedEvidenceDir, { recursive: true });

  const sectionStatuses = [
    evidence.substrate_status.status,
    evidence.app_rollout_status.status,
    evidence.ingress_route_probes.status,
    evidence.llmup_path_config_proof.status,
  ];
  const productStatuses = Object.values(evidence.product_verification_matrix).map((entry) => entry.status);
  const status: VerificationReportStatus = evidence.failures.length === 0
    && sectionStatuses.every((sectionStatus) => sectionStatus === 'passed')
    && productStatuses.every((productStatus) => productStatus === 'passed')
    ? 'passed'
    : 'blocked';
  const basename = `verification-report-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
  const reportPath = path.join(resolvedEvidenceDir, `${basename}.json`);
  const logPath = path.join(resolvedEvidenceDir, `${basename}.log`);
  const evidenceWithPaths: VerificationReportEvidence = {
    ...evidence,
    status,
    generated_at: new Date().toISOString(),
    paths: {
      report_path: reportPath,
      log_path: logPath,
    },
  };

  await writeFile(reportPath, `${JSON.stringify(evidenceWithPaths, null, 2)}\n`, 'utf8');
  await writeFile(
    logPath,
    [
      'producer=verification-report',
      `status=${status}`,
      `failures=${evidence.failures.length}`,
      `report_path=${reportPath}`,
    ].join('\n') + '\n',
    'utf8',
  );

  return evidenceWithPaths;
}

export async function runUnifiedDeployVerificationReportProducer(
  options: VerificationReportProducerOptions = {},
): Promise<VerificationReportProducerResult> {
  const evidence = await buildVerificationReportEvidence(options);
  const written = await writeVerificationReportEvidence(evidence, options.evidenceDir ?? DEFAULT_EVIDENCE_DIR);

  return {
    status: written.status,
    failures: written.failures,
    evidence: written,
  };
}

function parseProductEvidence(value: string): { flow: ProductVerificationFlowId; path: string } {
  const separator = value.indexOf('=');
  if (separator <= 0) {
    throw new Error('--product-evidence must use flow=path');
  }
  const flow = value.slice(0, separator);
  const evidencePath = value.slice(separator + 1);
  if (!PRODUCT_VERIFICATION_FLOWS.some((item) => item.id === flow)) {
    throw new Error(`unknown product evidence flow: ${flow}`);
  }

  return { flow: flow as ProductVerificationFlowId, path: evidencePath };
}

function parseCliOptions(argv: readonly string[]): VerificationReportProducerOptions {
  const options: VerificationReportProducerOptions = {};
  const productEvidence: ProductEvidenceInput = {};

  for (const arg of argv) {
    if (arg.startsWith('--existing-cluster-smoke=')) {
      options.existingClusterSmokePath = arg.slice('--existing-cluster-smoke='.length);
    } else if (arg.startsWith('--local-kind-evidence=')) {
      options.localKindEvidencePath = arg.slice('--local-kind-evidence='.length);
    } else if (arg.startsWith('--product-evidence=')) {
      const parsed = parseProductEvidence(arg.slice('--product-evidence='.length));
      productEvidence[parsed.flow] = parsed.path;
    } else if (arg.startsWith('--product-flows=')) {
      options.productFlowsAggregatePath = arg.slice('--product-flows='.length);
    } else if (arg.startsWith('--evidence-dir=')) {
      options.evidenceDir = arg.slice('--evidence-dir='.length);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (Object.keys(productEvidence).length > 0) {
    options.productEvidence = productEvidence;
  }

  return options;
}

async function main(): Promise<void> {
  const result = await runUnifiedDeployVerificationReportProducer(parseCliOptions(process.argv.slice(2)));
  const message = `[unified-deploy] verification report ${result.status}\n[unified-deploy] evidence: ${result.evidence.paths.report_path}\n`;

  if (result.status === 'passed') {
    process.stdout.write(message);
    return;
  }

  process.stderr.write(`${result.failures.map((failure) => `${failure.path}: ${failure.message}`).join('\n')}\n${message}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
