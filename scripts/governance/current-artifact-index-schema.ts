import {
  findCurrentGateDefinitionById,
  listCurrentGateDefinitions,
  type CurrentGateRequirement,
} from './current-gate-manifest';
import {
  CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
  CURRENT_JOB_METADATA_MANIFEST_VERSION,
  listCurrentJobMetadata,
  type CurrentJobMetadata,
  type CurrentJobMetadataKind,
} from './current-job-metadata-manifest';
import {
  listCurrentVerificationCampaigns,
  type CurrentVerificationCampaignDefinition,
  type CurrentVerificationCampaignExecutionMode,
  type CurrentVerificationCampaignStep,
} from './current-verification-campaign-manifest';

export const CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA = 'current-artifact-template-index.v1' as const;
export const CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION = 1 as const;

export type CurrentArtifactTemplateKind =
  | 'campaign_evidence_hint'
  | 'native_result_template'
  | 'declared_output_template';

export type CurrentArtifactTemplateProjectionKind = 'declared_template_index';
export type CurrentArtifactTemplateSchemaValidation = 'fail_closed';
export type CurrentArtifactTemplateSource = 'current_job_metadata_manifest';
export type CurrentArtifactTemplateSourceField = 'outputs.expected_artifact_path_templates';
export type CurrentArtifactTemplateCampaignStepField = 'evidence_hints' | 'native_result_path' | null;
export type CurrentArtifactTemplateGateField = 'campaign_evidence_artifacts' | null;

export interface CurrentArtifactTemplateIndexSourceTruth {
  current_job_metadata_manifest: {
    schema: typeof CURRENT_JOB_METADATA_MANIFEST_SCHEMA;
    version: typeof CURRENT_JOB_METADATA_MANIFEST_VERSION;
    job_count: number;
    output_template_source: CurrentArtifactTemplateSourceField;
  };
  current_verification_campaign_manifest: {
    campaign_ids: readonly string[];
    campaign_count: number;
  };
  current_gate_manifest: {
    gate_ids: readonly string[];
    gate_count: number;
  };
}

export interface CurrentArtifactTemplateIndexSummary {
  projection_kind: CurrentArtifactTemplateProjectionKind;
  artifact_directory_inspection: false;
  creates_evidence_claim: false;
  schema_validation: CurrentArtifactTemplateSchemaValidation;
  job_count: number;
  template_count: number;
  required_template_count: number;
  campaign_id_count: number;
  template_kind_counts: Record<CurrentArtifactTemplateKind, number>;
  producer_kind_counts: Record<CurrentJobMetadataKind, number>;
}

export interface CurrentArtifactTemplateProducer {
  kind: CurrentJobMetadataKind;
  job_id: string;
  campaign_id: string | null;
  gate_id: string;
  step_id: string | null;
  npm_script: string;
}

export interface CurrentArtifactTemplateTopology {
  line_kind: string;
  execution_mode: CurrentVerificationCampaignExecutionMode;
  depends_on: readonly string[];
  evidence_required: boolean;
  result_required: boolean;
}

export interface CurrentArtifactTemplateProvenance {
  source: CurrentArtifactTemplateSource;
  source_field: CurrentArtifactTemplateSourceField;
  campaign_step_field: CurrentArtifactTemplateCampaignStepField;
  gate_id: string;
  gate_field: CurrentArtifactTemplateGateField;
}

export interface CurrentArtifactTemplateEntry {
  id: string;
  template: string;
  kind: CurrentArtifactTemplateKind;
  required_for: readonly CurrentGateRequirement[];
  producer: CurrentArtifactTemplateProducer;
  topology: CurrentArtifactTemplateTopology;
  provenance: CurrentArtifactTemplateProvenance;
}

export interface CurrentArtifactTemplateIndex {
  schema: typeof CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA;
  version: typeof CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION;
  source_truth: CurrentArtifactTemplateIndexSourceTruth;
  summary: CurrentArtifactTemplateIndexSummary;
  templates: readonly CurrentArtifactTemplateEntry[];
}

export interface CurrentArtifactTemplateIndexValidationFailure {
  index: number;
  id?: string;
  path: string;
  reason: string;
}

export type CurrentArtifactTemplateIndexValidationResult =
  | {
      ok: true;
      value: CurrentArtifactTemplateIndex;
    }
  | {
      ok: false;
      failures: readonly CurrentArtifactTemplateIndexValidationFailure[];
    };

const TOP_LEVEL_FIELDS = ['schema', 'version', 'source_truth', 'summary', 'templates'] as const;
const SOURCE_TRUTH_FIELDS = [
  'current_job_metadata_manifest',
  'current_verification_campaign_manifest',
  'current_gate_manifest',
] as const;
const JOB_SOURCE_FIELDS = ['schema', 'version', 'job_count', 'output_template_source'] as const;
const CAMPAIGN_SOURCE_FIELDS = ['campaign_ids', 'campaign_count'] as const;
const GATE_SOURCE_FIELDS = ['gate_ids', 'gate_count'] as const;
const SUMMARY_FIELDS = [
  'projection_kind',
  'artifact_directory_inspection',
  'creates_evidence_claim',
  'schema_validation',
  'job_count',
  'template_count',
  'required_template_count',
  'campaign_id_count',
  'template_kind_counts',
  'producer_kind_counts',
] as const;
const TEMPLATE_FIELDS = [
  'id',
  'template',
  'kind',
  'required_for',
  'producer',
  'topology',
  'provenance',
] as const;
const PRODUCER_FIELDS = ['kind', 'job_id', 'campaign_id', 'gate_id', 'step_id', 'npm_script'] as const;
const TOPOLOGY_FIELDS = [
  'line_kind',
  'execution_mode',
  'depends_on',
  'evidence_required',
  'result_required',
] as const;
const PROVENANCE_FIELDS = ['source', 'source_field', 'campaign_step_field', 'gate_id', 'gate_field'] as const;
const TEMPLATE_KINDS = [
  'campaign_evidence_hint',
  'native_result_template',
  'declared_output_template',
] as const satisfies readonly CurrentArtifactTemplateKind[];
const PRODUCER_KINDS = ['standalone_gate', 'campaign_step'] as const satisfies readonly CurrentJobMetadataKind[];
const EXECUTION_MODES = ['execute', 'aggregate_only'] as const satisfies readonly CurrentVerificationCampaignExecutionMode[];
const REQUIRED_FOR_VALUES = ['default', 'release', 'visual'] as const satisfies readonly CurrentGateRequirement[];
const CAMPAIGN_STEP_FIELDS = ['evidence_hints', 'native_result_path'] as const;
const GATE_FIELDS = ['campaign_evidence_artifacts'] as const;
const TOP_LEVEL_FIELD_SET = new Set<string>(TOP_LEVEL_FIELDS);
const SOURCE_TRUTH_FIELD_SET = new Set<string>(SOURCE_TRUTH_FIELDS);
const JOB_SOURCE_FIELD_SET = new Set<string>(JOB_SOURCE_FIELDS);
const CAMPAIGN_SOURCE_FIELD_SET = new Set<string>(CAMPAIGN_SOURCE_FIELDS);
const GATE_SOURCE_FIELD_SET = new Set<string>(GATE_SOURCE_FIELDS);
const SUMMARY_FIELD_SET = new Set<string>(SUMMARY_FIELDS);
const TEMPLATE_FIELD_SET = new Set<string>(TEMPLATE_FIELDS);
const PRODUCER_FIELD_SET = new Set<string>(PRODUCER_FIELDS);
const TOPOLOGY_FIELD_SET = new Set<string>(TOPOLOGY_FIELDS);
const PROVENANCE_FIELD_SET = new Set<string>(PROVENANCE_FIELDS);
const TEMPLATE_KIND_SET = new Set<string>(TEMPLATE_KINDS);
const PRODUCER_KIND_SET = new Set<string>(PRODUCER_KINDS);
const EXECUTION_MODE_SET = new Set<string>(EXECUTION_MODES);
const REQUIRED_FOR_SET = new Set<string>(REQUIRED_FOR_VALUES);
const CAMPAIGN_STEP_FIELD_SET = new Set<string>(CAMPAIGN_STEP_FIELDS);
const GATE_FIELD_SET = new Set<string>(GATE_FIELDS);
const FORBIDDEN_RUNTIME_FIELDS = new Set<string>([
  'exists',
  'status',
  'exit_code',
  'passed',
  'failed',
  'stale',
  'reusable',
  'cache_hit',
  'claim_id',
  'claim_reuse',
  'verdict',
  'result_status',
  'failure_class',
  'artifact_digest',
  'result_digest',
  'input_digest',
  'run_id',
  'campaign_root',
]);
const SECRET_VALUE_PATTERNS = [
  /sk-/i,
  /\bBearer\s+/i,
  /api_key=/i,
  /access_token=/i,
  /client_secret=/i,
  /password=/i,
  /ticket=/i,
] as const;
const SNAKE_CASE_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

type CampaignStepContext = {
  campaignId: string;
  step: CurrentVerificationCampaignStep;
};

export function buildCurrentArtifactTemplateIndex(args: {
  jobs?: readonly CurrentJobMetadata[];
  verificationCampaigns?: readonly CurrentVerificationCampaignDefinition[];
} = {}): CurrentArtifactTemplateIndex {
  const jobs = args.jobs ?? listCurrentJobMetadata();
  const verificationCampaigns = args.verificationCampaigns ?? listCurrentVerificationCampaigns();
  const campaignStepsById = buildCampaignStepsById(verificationCampaigns);
  const templates = jobs.flatMap((job) => buildTemplatesForJob(job, campaignStepsById));
  const campaignIds = uniqueSorted(jobs.map((job) => job.campaign_id).filter(isDefinedString));
  const gateIds = listCurrentGateDefinitions().map((definition) => definition.id);

  return {
    schema: CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA,
    version: CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION,
    source_truth: {
      current_job_metadata_manifest: {
        schema: CURRENT_JOB_METADATA_MANIFEST_SCHEMA,
        version: CURRENT_JOB_METADATA_MANIFEST_VERSION,
        job_count: jobs.length,
        output_template_source: 'outputs.expected_artifact_path_templates',
      },
      current_verification_campaign_manifest: {
        campaign_ids: verificationCampaigns.map((campaign) => campaign.id),
        campaign_count: verificationCampaigns.length,
      },
      current_gate_manifest: {
        gate_ids: gateIds,
        gate_count: gateIds.length,
      },
    },
    summary: {
      projection_kind: 'declared_template_index',
      artifact_directory_inspection: false,
      creates_evidence_claim: false,
      schema_validation: 'fail_closed',
      job_count: jobs.length,
      template_count: templates.length,
      required_template_count: templates.filter((entry) => entry.required_for.length > 0).length,
      campaign_id_count: campaignIds.length,
      template_kind_counts: countTemplateKinds(templates),
      producer_kind_counts: countProducerKinds(templates),
    },
    templates,
  };
}

export const CURRENT_ARTIFACT_TEMPLATE_INDEX = buildCurrentArtifactTemplateIndex();

export function listCurrentArtifactTemplates(): readonly CurrentArtifactTemplateEntry[] {
  return CURRENT_ARTIFACT_TEMPLATE_INDEX.templates;
}

export function validateCurrentArtifactTemplateIndex(
  index: unknown = CURRENT_ARTIFACT_TEMPLATE_INDEX,
): CurrentArtifactTemplateIndexValidationResult {
  const failures: CurrentArtifactTemplateIndexValidationFailure[] = [];

  validateForbiddenRuntimeFields(index, 'index', failures);
  validateNoSecretLookingValues(index, 'index', failures);
  validateSnakeCaseKeys(index, 'index', failures);

  if (!isRecord(index)) {
    return {
      ok: false,
      failures: [
        ...failures,
        {
          index: -1,
          path: 'index',
          reason: 'artifact template index must be an object.',
        },
      ],
    };
  }

  validateAllowedFields(index, TOP_LEVEL_FIELD_SET, 'top-level', 'index', -1, undefined, failures);
  validateRequiredFields(index, TOP_LEVEL_FIELDS, 'index', -1, undefined, failures);
  validateTopLevelVersion(index, failures);
  validateSourceTruth(index.source_truth, failures);
  validateSummary(index.summary, failures);

  if (!Array.isArray(index.templates)) {
    failures.push({
      index: -1,
      path: 'index.templates',
      reason: 'templates must be an array.',
    });
  } else {
    validateTemplates(index.templates, failures);
  }

  validateMirrorsCurrentDerivedIndex(index, failures);

  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  return {
    ok: true,
    value: index as CurrentArtifactTemplateIndex,
  };
}

function buildCampaignStepsById(
  campaigns: readonly CurrentVerificationCampaignDefinition[],
): ReadonlyMap<string, CampaignStepContext> {
  const entries = new Map<string, CampaignStepContext>();

  for (const campaign of campaigns) {
    for (const step of campaign.steps) {
      entries.set(step.id, {
        campaignId: campaign.id,
        step,
      });
    }
  }

  return entries;
}

function buildTemplatesForJob(
  job: CurrentJobMetadata,
  campaignStepsById: ReadonlyMap<string, CampaignStepContext>,
): CurrentArtifactTemplateEntry[] {
  const stepContext = job.step_id ? campaignStepsById.get(job.step_id) : undefined;
  const gate = findCurrentGateDefinitionById(job.gate_id);

  return job.outputs.expected_artifact_path_templates.map((template, templateIndex) => {
    const kind = classifyTemplateKind(template, stepContext?.step);
    const templateInStepHints = stepContext?.step.evidenceHints.includes(template) ?? false;
    const templateIsNative = stepContext?.step.nativeResult?.path === template;
    const templateInGateCampaignArtifacts = gate?.campaignEvidenceArtifacts.includes(template) ?? false;

    return {
      id: `${job.id}-artifact-${String(templateIndex + 1).padStart(3, '0')}`,
      template,
      kind,
      required_for: requiredForJob(job),
      producer: {
        kind: job.kind,
        job_id: job.id,
        campaign_id: job.campaign_id ?? null,
        gate_id: job.gate_id,
        step_id: job.step_id ?? null,
        npm_script: job.npm_script,
      },
      topology: {
        line_kind: sanitizeTemplateTopologyToken(job.line_kind),
        execution_mode: job.execution_mode,
        depends_on: [...job.depends_on],
        evidence_required: job.outputs.evidence_required,
        result_required: job.outputs.result_required,
      },
      provenance: {
        source: 'current_job_metadata_manifest',
        source_field: 'outputs.expected_artifact_path_templates',
        campaign_step_field: templateIsNative
          ? 'native_result_path'
          : templateInStepHints
            ? 'evidence_hints'
            : null,
        gate_id: job.gate_id,
        gate_field: templateInGateCampaignArtifacts ? 'campaign_evidence_artifacts' : null,
      },
    };
  });
}

function classifyTemplateKind(
  template: string,
  step: CurrentVerificationCampaignStep | undefined,
): CurrentArtifactTemplateKind {
  if (step?.nativeResult?.path === template) {
    return 'native_result_template';
  }
  if (step?.evidenceHints.includes(template)) {
    return 'campaign_evidence_hint';
  }
  return 'declared_output_template';
}

function requiredForJob(job: CurrentJobMetadata): readonly CurrentGateRequirement[] {
  if (job.campaign_id === 'release-full') {
    return ['release'];
  }

  const gate = findCurrentGateDefinitionById(job.gate_id);
  return orderRequiredFor(gate?.requiredFor ?? []);
}

function orderRequiredFor(values: readonly CurrentGateRequirement[]): readonly CurrentGateRequirement[] {
  const selected = new Set(values);
  return REQUIRED_FOR_VALUES.filter((value) => selected.has(value));
}

function countTemplateKinds(
  templates: readonly CurrentArtifactTemplateEntry[],
): Record<CurrentArtifactTemplateKind, number> {
  return {
    campaign_evidence_hint: templates.filter((entry) => entry.kind === 'campaign_evidence_hint').length,
    native_result_template: templates.filter((entry) => entry.kind === 'native_result_template').length,
    declared_output_template: templates.filter((entry) => entry.kind === 'declared_output_template').length,
  };
}

function countProducerKinds(
  templates: readonly CurrentArtifactTemplateEntry[],
): Record<CurrentJobMetadataKind, number> {
  return {
    standalone_gate: templates.filter((entry) => entry.producer.kind === 'standalone_gate').length,
    campaign_step: templates.filter((entry) => entry.producer.kind === 'campaign_step').length,
  };
}

function sanitizeTemplateTopologyToken(value: string): string {
  return value
    .replaceAll('campaign_root', 'campaign_boundary')
    .replaceAll('verdict', 'terminal_decision');
}

function validateTopLevelVersion(
  index: Record<string, unknown>,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (index.schema !== CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA) {
    failures.push({
      index: -1,
      path: 'index.schema',
      reason: `schema must be ${CURRENT_ARTIFACT_TEMPLATE_INDEX_SCHEMA}.`,
    });
  }
  if (index.version !== CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION) {
    failures.push({
      index: -1,
      path: 'index.version',
      reason: `version must be ${String(CURRENT_ARTIFACT_TEMPLATE_INDEX_VERSION)}.`,
    });
  }
}

function validateSourceTruth(
  value: unknown,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index: -1,
      path: 'index.source_truth',
      reason: 'source_truth must be an object.',
    });
    return;
  }

  validateAllowedFields(value, SOURCE_TRUTH_FIELD_SET, 'source_truth', 'index.source_truth', -1, undefined, failures);
  validateRequiredFields(value, SOURCE_TRUTH_FIELDS, 'index.source_truth', -1, undefined, failures);
  validateJobSourceTruth(value.current_job_metadata_manifest, failures);
  validateCampaignSourceTruth(value.current_verification_campaign_manifest, failures);
  validateGateSourceTruth(value.current_gate_manifest, failures);
}

function validateJobSourceTruth(
  value: unknown,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index: -1,
      path: 'index.source_truth.current_job_metadata_manifest',
      reason: 'current_job_metadata_manifest source truth must be an object.',
    });
    return;
  }

  validateAllowedFields(
    value,
    JOB_SOURCE_FIELD_SET,
    'current_job_metadata_manifest source truth',
    'index.source_truth.current_job_metadata_manifest',
    -1,
    undefined,
    failures,
  );
  validateRequiredFields(
    value,
    JOB_SOURCE_FIELDS,
    'index.source_truth.current_job_metadata_manifest',
    -1,
    undefined,
    failures,
  );
  validateNumber(value.job_count, 'index.source_truth.current_job_metadata_manifest.job_count', -1, undefined, failures);
}

function validateCampaignSourceTruth(
  value: unknown,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index: -1,
      path: 'index.source_truth.current_verification_campaign_manifest',
      reason: 'current_verification_campaign_manifest source truth must be an object.',
    });
    return;
  }

  validateAllowedFields(
    value,
    CAMPAIGN_SOURCE_FIELD_SET,
    'current_verification_campaign_manifest source truth',
    'index.source_truth.current_verification_campaign_manifest',
    -1,
    undefined,
    failures,
  );
  validateRequiredFields(
    value,
    CAMPAIGN_SOURCE_FIELDS,
    'index.source_truth.current_verification_campaign_manifest',
    -1,
    undefined,
    failures,
  );
  validateStringArray(
    value.campaign_ids,
    'index.source_truth.current_verification_campaign_manifest.campaign_ids',
    -1,
    undefined,
    failures,
  );
  validateNumber(
    value.campaign_count,
    'index.source_truth.current_verification_campaign_manifest.campaign_count',
    -1,
    undefined,
    failures,
  );
}

function validateGateSourceTruth(
  value: unknown,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index: -1,
      path: 'index.source_truth.current_gate_manifest',
      reason: 'current_gate_manifest source truth must be an object.',
    });
    return;
  }

  validateAllowedFields(
    value,
    GATE_SOURCE_FIELD_SET,
    'current_gate_manifest source truth',
    'index.source_truth.current_gate_manifest',
    -1,
    undefined,
    failures,
  );
  validateRequiredFields(
    value,
    GATE_SOURCE_FIELDS,
    'index.source_truth.current_gate_manifest',
    -1,
    undefined,
    failures,
  );
  validateStringArray(value.gate_ids, 'index.source_truth.current_gate_manifest.gate_ids', -1, undefined, failures);
  validateNumber(value.gate_count, 'index.source_truth.current_gate_manifest.gate_count', -1, undefined, failures);
}

function validateSummary(
  value: unknown,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index: -1,
      path: 'index.summary',
      reason: 'summary must be an object.',
    });
    return;
  }

  validateAllowedFields(value, SUMMARY_FIELD_SET, 'summary', 'index.summary', -1, undefined, failures);
  validateRequiredFields(value, SUMMARY_FIELDS, 'index.summary', -1, undefined, failures);
  validateLiteral(value.projection_kind, 'declared_template_index', 'index.summary.projection_kind', failures);
  validateLiteral(value.artifact_directory_inspection, false, 'index.summary.artifact_directory_inspection', failures);
  validateLiteral(value.creates_evidence_claim, false, 'index.summary.creates_evidence_claim', failures);
  validateLiteral(value.schema_validation, 'fail_closed', 'index.summary.schema_validation', failures);
  validateNumber(value.job_count, 'index.summary.job_count', -1, undefined, failures);
  validateNumber(value.template_count, 'index.summary.template_count', -1, undefined, failures);
  validateNumber(value.required_template_count, 'index.summary.required_template_count', -1, undefined, failures);
  validateNumber(value.campaign_id_count, 'index.summary.campaign_id_count', -1, undefined, failures);
  validateCountRecord(value.template_kind_counts, TEMPLATE_KIND_SET, 'index.summary.template_kind_counts', failures);
  validateCountRecord(value.producer_kind_counts, PRODUCER_KIND_SET, 'index.summary.producer_kind_counts', failures);
}

function validateTemplates(
  templates: readonly unknown[],
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  const seenIds = new Set<string>();

  templates.forEach((entry, index) => {
    if (!isRecord(entry)) {
      failures.push({
        index,
        path: `index.templates[${index}]`,
        reason: 'artifact template entry must be an object.',
      });
      return;
    }

    const id = typeof entry.id === 'string' ? entry.id : undefined;
    validateAllowedFields(entry, TEMPLATE_FIELD_SET, 'template', `index.templates[${index}]`, index, id, failures);
    validateRequiredFields(entry, TEMPLATE_FIELDS, `index.templates[${index}]`, index, id, failures);
    validateTemplateId(entry.id, index, seenIds, failures);
    validateRequiredString(entry.template, `index.templates[${index}].template`, index, id, failures);
    validateEnum(entry.kind, TEMPLATE_KIND_SET, `index.templates[${index}].kind`, index, id, failures);
    validateRequiredFor(entry.required_for, index, id, failures);
    validateProducer(entry.producer, index, id, failures);
    validateTopology(entry.topology, index, id, failures);
    validateProvenance(entry.provenance, index, id, failures);
  });
}

function validateProducer(
  value: unknown,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index,
      id,
      path: `index.templates[${index}].producer`,
      reason: 'producer must be an object.',
    });
    return;
  }

  validateAllowedFields(value, PRODUCER_FIELD_SET, 'producer', `index.templates[${index}].producer`, index, id, failures);
  validateRequiredFields(value, PRODUCER_FIELDS, `index.templates[${index}].producer`, index, id, failures);
  validateEnum(value.kind, PRODUCER_KIND_SET, `index.templates[${index}].producer.kind`, index, id, failures);
  validateRequiredString(value.job_id, `index.templates[${index}].producer.job_id`, index, id, failures);
  validateNullableString(value.campaign_id, `index.templates[${index}].producer.campaign_id`, index, id, failures);
  validateRequiredString(value.gate_id, `index.templates[${index}].producer.gate_id`, index, id, failures);
  validateNullableString(value.step_id, `index.templates[${index}].producer.step_id`, index, id, failures);
  validateRequiredString(value.npm_script, `index.templates[${index}].producer.npm_script`, index, id, failures);

  if (typeof value.gate_id === 'string') {
    const gate = findCurrentGateDefinitionById(value.gate_id);
    if (!gate) {
      failures.push({
        index,
        id,
        path: `index.templates[${index}].producer.gate_id`,
        reason: `unknown producer gate_id "${value.gate_id}".`,
      });
    } else if (value.npm_script !== gate.npmScript) {
      failures.push({
        index,
        id,
        path: `index.templates[${index}].producer.npm_script`,
        reason: `producer npm_script must match current gate manifest for gate_id ${value.gate_id}.`,
      });
    }
  }
}

function validateTopology(
  value: unknown,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index,
      id,
      path: `index.templates[${index}].topology`,
      reason: 'topology must be an object.',
    });
    return;
  }

  validateAllowedFields(value, TOPOLOGY_FIELD_SET, 'topology', `index.templates[${index}].topology`, index, id, failures);
  validateRequiredFields(value, TOPOLOGY_FIELDS, `index.templates[${index}].topology`, index, id, failures);
  validateRequiredString(value.line_kind, `index.templates[${index}].topology.line_kind`, index, id, failures);
  validateEnum(
    value.execution_mode,
    EXECUTION_MODE_SET,
    `index.templates[${index}].topology.execution_mode`,
    index,
    id,
    failures,
  );
  validateStringArray(value.depends_on, `index.templates[${index}].topology.depends_on`, index, id, failures);
  validateBoolean(value.evidence_required, `index.templates[${index}].topology.evidence_required`, index, id, failures);
  validateBoolean(value.result_required, `index.templates[${index}].topology.result_required`, index, id, failures);
}

function validateProvenance(
  value: unknown,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index,
      id,
      path: `index.templates[${index}].provenance`,
      reason: 'provenance must be an object.',
    });
    return;
  }

  validateAllowedFields(
    value,
    PROVENANCE_FIELD_SET,
    'provenance',
    `index.templates[${index}].provenance`,
    index,
    id,
    failures,
  );
  validateRequiredFields(value, PROVENANCE_FIELDS, `index.templates[${index}].provenance`, index, id, failures);
  validateLiteral(value.source, 'current_job_metadata_manifest', `index.templates[${index}].provenance.source`, failures);
  validateLiteral(
    value.source_field,
    'outputs.expected_artifact_path_templates',
    `index.templates[${index}].provenance.source_field`,
    failures,
  );
  validateNullableEnum(
    value.campaign_step_field,
    CAMPAIGN_STEP_FIELD_SET,
    `index.templates[${index}].provenance.campaign_step_field`,
    index,
    id,
    failures,
  );
  validateRequiredString(value.gate_id, `index.templates[${index}].provenance.gate_id`, index, id, failures);
  validateNullableEnum(
    value.gate_field,
    GATE_FIELD_SET,
    `index.templates[${index}].provenance.gate_field`,
    index,
    id,
    failures,
  );
}

function validateMirrorsCurrentDerivedIndex(
  value: Record<string, unknown>,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  const expected = buildCurrentArtifactTemplateIndex();

  if (JSON.stringify(value.source_truth) !== JSON.stringify(expected.source_truth)) {
    failures.push({
      index: -1,
      path: 'index.source_truth',
      reason: 'source_truth must mirror the current job metadata, verification campaign, and gate manifests.',
    });
  }
  if (JSON.stringify(value.summary) !== JSON.stringify(expected.summary)) {
    failures.push({
      index: -1,
      path: 'index.summary',
      reason: 'summary must mirror the current declared artifact template projection.',
    });
  }
  if (Array.isArray(value.templates) && JSON.stringify(value.templates) !== JSON.stringify(expected.templates)) {
    failures.push({
      index: -1,
      path: 'index.templates',
      reason: 'templates must mirror current job metadata outputs.expected_artifact_path_templates.',
    });
  }
}

function validateAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  label: string,
  path: string,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      failures.push({
        index,
        id,
        path: `${path}.${key}`,
        reason: `unknown ${label} field "${key}".`,
      });
    }
  }
}

function validateRequiredFields(
  value: Record<string, unknown>,
  requiredFields: readonly string[],
  path: string,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  for (const field of requiredFields) {
    if (!(field in value)) {
      failures.push({
        index,
        id,
        path: `${path}.${field}`,
        reason: `${field} is required.`,
      });
    }
  }
}

function validateTemplateId(
  value: unknown,
  index: number,
  seenIds: Set<string>,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (typeof value !== 'string' || !TEMPLATE_ID_PATTERN.test(value)) {
    failures.push({
      index,
      path: `index.templates[${index}].id`,
      reason: 'id must be a stable kebab-case string.',
    });
    return;
  }
  if (seenIds.has(value)) {
    failures.push({
      index,
      id: value,
      path: `index.templates[${index}].id`,
      reason: `duplicate artifact template id "${value}".`,
    });
    return;
  }
  seenIds.add(value);
}

function validateRequiredFor(
  value: unknown,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  const entries = validateStringArray(value, `index.templates[${index}].required_for`, index, id, failures);
  if (!entries) {
    return;
  }
  if (entries.length === 0) {
    failures.push({
      index,
      id,
      path: `index.templates[${index}].required_for`,
      reason: 'required_for must not be empty.',
    });
  }
  for (const entry of entries) {
    if (!REQUIRED_FOR_SET.has(entry)) {
      failures.push({
        index,
        id,
        path: `index.templates[${index}].required_for`,
        reason: `required_for must contain only: ${REQUIRED_FOR_VALUES.join(', ')}.`,
      });
    }
  }
}

function validateCountRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  path: string,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (!isRecord(value)) {
    failures.push({
      index: -1,
      path,
      reason: `${path} must be an object.`,
    });
    return;
  }

  validateAllowedFields(value, allowedKeys, 'count', path, -1, undefined, failures);
  for (const key of allowedKeys) {
    if (!(key in value)) {
      failures.push({
        index: -1,
        path: `${path}.${key}`,
        reason: `${key} is required.`,
      });
    } else {
      validateNumber(value[key], `${path}.${key}`, -1, undefined, failures);
    }
  }
}

function validateLiteral(
  actual: unknown,
  expected: string | number | boolean,
  path: string,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (actual !== expected) {
    failures.push({
      index: -1,
      path,
      reason: `${path} must be ${String(expected)}.`,
    });
  }
}

function validateEnum(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  path: string,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (typeof value !== 'string' || !allowedValues.has(value)) {
    failures.push({
      index,
      id,
      path,
      reason: `${path} must be one of: ${[...allowedValues].join(', ')}.`,
    });
  }
}

function validateNullableEnum(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  path: string,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  validateEnum(value, allowedValues, path, index, id, failures);
}

function validateRequiredString(
  value: unknown,
  path: string,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    failures.push({
      index,
      id,
      path,
      reason: `${path} must be a non-empty string.`,
    });
  }
}

function validateNullableString(
  value: unknown,
  path: string,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (value === null) {
    return;
  }
  validateRequiredString(value, path, index, id, failures);
}

function validateStringArray(
  value: unknown,
  path: string,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): readonly string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    failures.push({
      index,
      id,
      path,
      reason: `${path} must be a string array.`,
    });
    return null;
  }
  return value;
}

function validateBoolean(
  value: unknown,
  path: string,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (typeof value !== 'boolean') {
    failures.push({
      index,
      id,
      path,
      reason: `${path} must be a boolean.`,
    });
  }
}

function validateNumber(
  value: unknown,
  path: string,
  index: number,
  id: string | undefined,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    failures.push({
      index,
      id,
      path,
      reason: `${path} must be a non-negative integer.`,
    });
  }
}

function validateForbiddenRuntimeFields(
  value: unknown,
  path: string,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateForbiddenRuntimeFields(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (FORBIDDEN_RUNTIME_FIELDS.has(key)) {
      failures.push({
        index: -1,
        path: nestedPath,
        reason: `forbidden runtime field "${key}".`,
      });
    }
    validateForbiddenRuntimeFields(nested, nestedPath, failures);
  }
}

function validateNoSecretLookingValues(
  value: unknown,
  path: string,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      failures.push({
        index: -1,
        path,
        reason: `secret-looking value is not allowed at ${path}.`,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateNoSecretLookingValues(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    validateNoSecretLookingValues(nested, `${path}.${key}`, failures);
  }
}

function validateSnakeCaseKeys(
  value: unknown,
  path: string,
  failures: CurrentArtifactTemplateIndexValidationFailure[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateSnakeCaseKeys(entry, `${path}[${index}]`, failures));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (!SNAKE_CASE_KEY_PATTERN.test(key)) {
      failures.push({
        index: -1,
        path: `${path}.${key}`,
        reason: `keys must be snake_case: ${key}.`,
      });
    }
    validateSnakeCaseKeys(nested, `${path}.${key}`, failures);
  }
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isDefinedString(value: string | null | undefined): value is string {
  return typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
