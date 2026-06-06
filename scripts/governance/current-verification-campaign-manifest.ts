import {
  CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY,
  CURRENT_RELEASE_FULL_CAMPAIGN_EVIDENCE_ARTIFACTS,
  findCurrentGateDefinitionById,
} from './current-gate-manifest';
import runtimeReadinessPolicy from './runtime-readiness-policy.json';

export type CurrentVerificationCampaignId = 'release-full';
export type CurrentVerificationCampaignStepRole =
  | 'preflight'
  | 'diagnostic'
  | 'evidence_owner'
  | 'terminal_verdict';
export type CurrentVerificationCampaignExecutionMode = 'execute' | 'aggregate_only';
export type CurrentVerificationCampaignFailureClass =
  | 'product_regression'
  | 'infra_setup_failure'
  | 'environment_conflict'
  | 'contract_drift'
  | 'evidence_missing';
export type CurrentVerificationCampaignEvidenceCheckKind =
  | 'file'
  | 'directory'
  | 'directory_non_empty'
  | 'recursive_file'
  | 'visual_baseline_automated_passes'
  | 'visual_run_manifest'
  | 'visual_baseline_reviews';
export type CurrentVerificationCampaignEvidenceSemantic =
  | 'unified_deploy_evidence'
  | 'ux_trace_bundle';
export type CurrentVerificationCampaignObservationTheme =
  | 'runtime_pending_readiness';
export type CurrentVerificationCampaignObservationBackoff =
  | 'increasing_after_consecutive_non_terminal';
export type CurrentVerificationCampaignRuntimeConvergenceSurface =
  | 'files'
  | 'agent_task_sandbox'
  | 'afscp_workspace_binding'
  | 'read_export';
export type CurrentVerificationCampaignRuntimeConvergenceState =
  | 'pending'
  | 'releasing'
  | 'offline'
  | 'not_found';

export interface CurrentVerificationCampaignEvidenceCheck {
  id: string;
  path: string;
  kind: CurrentVerificationCampaignEvidenceCheckKind;
  fileName?: string;
  minCount?: number;
  semantic?: CurrentVerificationCampaignEvidenceSemantic;
  expectedSchemaVersion?: string;
  expectedProducer?: string;
  expectedStatus?: string;
  expectedTheme?: string;
  expectedCommand?: string;
  expectedProfile?: string;
  expectedProductFlows?: readonly string[];
  expectedProductSmokes?: readonly string[];
}

export interface CurrentVerificationCampaignNativeResult {
  gateId: string;
  npmScript?: string;
  path: string;
}

export interface CurrentVerificationCampaignObservationPolicy {
  theme: CurrentVerificationCampaignObservationTheme;
  backoff: CurrentVerificationCampaignObservationBackoff;
  intervalMs: readonly number[];
  evidenceFocus: readonly string[];
  stateConvergence: Readonly<Record<
    CurrentVerificationCampaignRuntimeConvergenceSurface,
    Readonly<Record<CurrentVerificationCampaignRuntimeConvergenceState, string>>
  >>;
}

export interface CurrentVerificationCampaignStep {
  id: string;
  gateId: string;
  npmScript: string;
  command: string;
  timeoutMs: number;
  workflowRole: CurrentVerificationCampaignStepRole;
  executionMode: CurrentVerificationCampaignExecutionMode;
  resultRequired: boolean;
  evidenceRequired: boolean;
  lineKind: string;
  defaultFailureClass: CurrentVerificationCampaignFailureClass;
  dependsOn: readonly string[];
  evidenceHints: readonly string[];
  evidenceChecks: readonly CurrentVerificationCampaignEvidenceCheck[];
  observationPolicy?: CurrentVerificationCampaignObservationPolicy;
  nativeResult?: CurrentVerificationCampaignNativeResult;
}

export interface CurrentVerificationCampaignDefinition {
  id: CurrentVerificationCampaignId;
  description: string;
  runRootPattern: string;
  steps: readonly CurrentVerificationCampaignStep[];
}

type CurrentReleaseCampaignEvidenceTopologyKey = keyof typeof CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY;

const MINUTE_MS = 60_000;
const RUNTIME_READINESS_CONVERGENCE_SURFACES = [
  'files',
  'agent_task_sandbox',
  'afscp_workspace_binding',
  'read_export',
] as const satisfies readonly CurrentVerificationCampaignRuntimeConvergenceSurface[];
const RUNTIME_READINESS_CONVERGENCE_STATES = [
  'pending',
  'releasing',
  'offline',
  'not_found',
] as const satisfies readonly CurrentVerificationCampaignRuntimeConvergenceState[];

const CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS = {
  gateFast: 20 * MINUTE_MS,
  gateDefault: 45 * MINUTE_MS,
  laneVisual: 45 * MINUTE_MS,
  gateRelease: 90 * MINUTE_MS,
  gateReleaseFull: 10 * MINUTE_MS,
} as const;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => requireString(entry, `${label}[${String(index)}]`));
}

function requireIncreasingRuntimeReadinessIntervals(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  if (value.length < 3) {
    throw new Error(`${label} must define at least three increasing wait intervals.`);
  }

  return value.map((entry, index, entries) => {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry <= 0) {
      throw new Error(`${label}[${String(index)}] must be a positive safe integer.`);
    }
    const previous = entries[index - 1];
    if (index > 0 && typeof previous === 'number' && entry <= previous) {
      throw new Error(`${label} must be strictly increasing after consecutive runtime readiness waits.`);
    }
    return entry;
  });
}

function requireRuntimeReadinessStateConvergence(
  value: unknown,
): CurrentVerificationCampaignObservationPolicy['stateConvergence'] {
  const raw = requireRecord(value, 'runtime readiness state_convergence');
  const result: Partial<Record<
    CurrentVerificationCampaignRuntimeConvergenceSurface,
    Record<CurrentVerificationCampaignRuntimeConvergenceState, string>
  >> = {};

  for (const surface of RUNTIME_READINESS_CONVERGENCE_SURFACES) {
    const rawSurface = requireRecord(
      raw[surface],
      `runtime readiness state_convergence.${surface}`,
    );
    const surfaceResult: Partial<Record<CurrentVerificationCampaignRuntimeConvergenceState, string>> = {};

    for (const state of RUNTIME_READINESS_CONVERGENCE_STATES) {
      surfaceResult[state] = requireString(
        rawSurface[state],
        `runtime readiness state_convergence.${surface}.${state}`,
      );
    }

    result[surface] = surfaceResult as Record<CurrentVerificationCampaignRuntimeConvergenceState, string>;
  }

  return result as CurrentVerificationCampaignObservationPolicy['stateConvergence'];
}

export function validateRuntimeReadinessObservationPolicy(
  value: unknown,
): CurrentVerificationCampaignObservationPolicy {
  const raw = requireRecord(value, 'runtime readiness policy');
  const theme = requireString(raw.theme, 'runtime readiness policy theme');
  if (theme !== 'runtime_pending_readiness') {
    throw new Error('runtime readiness policy theme must be runtime_pending_readiness.');
  }
  const backoff = requireString(raw.backoff, 'runtime readiness policy backoff');
  if (backoff !== 'increasing_after_consecutive_non_terminal') {
    throw new Error('runtime readiness policy backoff must be increasing_after_consecutive_non_terminal.');
  }

  return {
    theme,
    backoff,
    intervalMs: requireIncreasingRuntimeReadinessIntervals(
      raw.interval_ms,
      'runtime readiness policy interval_ms',
    ),
    evidenceFocus: requireStringArray(raw.evidence_focus, 'runtime readiness policy evidence_focus'),
    stateConvergence: requireRuntimeReadinessStateConvergence(raw.state_convergence),
  };
}

const RUNTIME_READINESS_OBSERVATION_POLICY = validateRuntimeReadinessObservationPolicy(
  runtimeReadinessPolicy,
);

function campaignEvidenceChecks(
  key: CurrentReleaseCampaignEvidenceTopologyKey,
): readonly CurrentVerificationCampaignEvidenceCheck[] {
  return CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY[key].map((check) => ({
    ...check,
    ...(check.id === 'backend_real_ux_trace_reviews'
      ? { semantic: 'ux_trace_bundle' as const }
      : {}),
  }));
}

function campaignStep(
  step: Omit<CurrentVerificationCampaignStep, 'npmScript' | 'command'>,
): CurrentVerificationCampaignStep {
  const definition = findCurrentGateDefinitionById(step.gateId);
  if (!definition) {
    throw new Error(`Unknown current gate id in verification campaign: ${step.gateId}`);
  }

  return {
    ...step,
    npmScript: definition.npmScript,
    command: `npm run ${definition.npmScript}`,
  };
}

export const CURRENT_VERIFICATION_CAMPAIGN_MANIFEST: readonly CurrentVerificationCampaignDefinition[] = [
  {
    id: 'release-full',
    description: 'AgentSmith product-side readiness campaign for local completeness, contracts, and handoff inputs',
    runRootPattern: 'artifacts/release-runs/<campaign-run-id>',
    steps: [
      campaignStep({
        id: 'gate-fast',
        gateId: 'gate-fast',
        timeoutMs: CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS.gateFast,
        workflowRole: 'preflight',
        executionMode: 'execute',
        resultRequired: true,
        evidenceRequired: false,
        lineKind: 'release_campaign_preflight',
        defaultFailureClass: 'product_regression',
        dependsOn: [],
        evidenceHints: [],
        evidenceChecks: [],
      }),
      campaignStep({
        id: 'gate-default',
        gateId: 'gate-default',
        timeoutMs: CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS.gateDefault,
        workflowRole: 'preflight',
        executionMode: 'execute',
        resultRequired: true,
        evidenceRequired: false,
        lineKind: 'release_campaign_default',
        defaultFailureClass: 'product_regression',
        dependsOn: ['gate-fast'],
        evidenceHints: [],
        evidenceChecks: [],
      }),
      campaignStep({
        id: 'lane-visual',
        gateId: 'lane-visual',
        timeoutMs: CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS.laneVisual,
        workflowRole: 'evidence_owner',
        executionMode: 'execute',
        resultRequired: true,
        evidenceRequired: true,
        lineKind: 'visual',
        defaultFailureClass: 'product_regression',
        dependsOn: ['gate-fast'],
        evidenceHints: findCurrentGateDefinitionById('lane-visual')?.campaignEvidenceArtifacts ?? [],
        evidenceChecks: campaignEvidenceChecks('laneVisual'),
        nativeResult: {
          gateId: 'lane-visual',
          npmScript: 'lane:visual',
          path: '<campaign-root>/lane-visual/native/result.json',
        },
      }),
      campaignStep({
        id: 'gate-release',
        gateId: 'gate-release',
        timeoutMs: CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS.gateRelease,
        workflowRole: 'evidence_owner',
        executionMode: 'execute',
        resultRequired: true,
        evidenceRequired: true,
        lineKind: 'release_backend_real',
        defaultFailureClass: 'infra_setup_failure',
        dependsOn: ['gate-default'],
        evidenceHints: findCurrentGateDefinitionById('gate-release')?.campaignEvidenceArtifacts ?? [],
        evidenceChecks: campaignEvidenceChecks('gateRelease'),
        observationPolicy: RUNTIME_READINESS_OBSERVATION_POLICY,
        nativeResult: {
          gateId: 'lane-backend-real-release',
          npmScript: 'lane:backend-real:release',
          path: '<campaign-root>/gate-release/native/result.json',
        },
      }),
      campaignStep({
        id: 'gate-release-full',
        gateId: 'gate-release-full',
        timeoutMs: CURRENT_RELEASE_FULL_CAMPAIGN_STEP_TIMEOUT_MS.gateReleaseFull,
        workflowRole: 'terminal_verdict',
        executionMode: 'aggregate_only',
        resultRequired: true,
        evidenceRequired: true,
        lineKind: 'release_full_verdict',
        defaultFailureClass: 'evidence_missing',
        dependsOn: [
          'gate-fast',
          'gate-default',
          'lane-visual',
          'gate-release',
        ],
        evidenceHints: CURRENT_RELEASE_FULL_CAMPAIGN_EVIDENCE_ARTIFACTS,
        evidenceChecks: [
          {
            id: 'campaign_root',
            path: '<campaign-root>',
            kind: 'directory',
          },
        ],
      }),
    ],
  },
] as const;

export function listCurrentVerificationCampaigns(): readonly CurrentVerificationCampaignDefinition[] {
  return CURRENT_VERIFICATION_CAMPAIGN_MANIFEST;
}

export function currentObservationWaitMsForConsecutiveNonTerminal(
  policy: CurrentVerificationCampaignObservationPolicy,
  consecutiveNonTerminalCount: number,
): number {
  if (!Number.isSafeInteger(consecutiveNonTerminalCount) || consecutiveNonTerminalCount < 1) {
    throw new Error('consecutive non-terminal count must be a positive safe integer');
  }
  if (policy.intervalMs.length === 0) {
    throw new Error(`observation policy ${policy.theme} must define at least one interval`);
  }

  const index = Math.min(consecutiveNonTerminalCount - 1, policy.intervalMs.length - 1);
  const waitMs = policy.intervalMs[index];
  if (!Number.isSafeInteger(waitMs) || waitMs <= 0) {
    throw new Error(
      `observation policy ${policy.theme} has an invalid interval at index ${String(index)}`,
    );
  }
  return waitMs;
}

export function currentObservationWaitSchedule(
  policy: CurrentVerificationCampaignObservationPolicy,
  sampleCount = policy.intervalMs.length + 1,
): readonly number[] {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new Error('observation wait schedule sample count must be a positive safe integer');
  }

  return Array.from({ length: sampleCount }, (_, index) =>
    currentObservationWaitMsForConsecutiveNonTerminal(policy, index + 1),
  );
}

export function findCurrentVerificationCampaignById(
  id: string,
): CurrentVerificationCampaignDefinition | undefined {
  return CURRENT_VERIFICATION_CAMPAIGN_MANIFEST.find((campaign) => campaign.id === id);
}
