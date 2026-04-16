export const CURRENT_GATE_DOCUMENT_FILES = [
  'docs/current-engineering-governance-model.md',
  'docs/contracts/current-gate-manifest-contract.md',
  'docs/contracts/current-gate-result-schema-contract.md',
  'docs/testing/verification-campaigns-v1.md',
  'docs/user-guides/workspace-project-default-engineering-gate-checklist.md',
  'docs/user-guides/governance-default-engineering-gate-checklist.md',
  'docs/user-guides/release-readiness-checklist.md',
  '.github/workflows/quality-gates.yml',
  '.github/workflows/contracts-check.yml',
  'scripts/workspace-project-default-gate.sh',
  'scripts/governance-default-gate.sh',
  'scripts/backend-real-full-gate.sh',
  'scripts/contracts/check-current-gates.ts',
  'scripts/contracts/check-current-gate-results.ts',
  'scripts/contracts/check-engineering-governance.ts',
  'scripts/governance/current-gate-manifest.ts',
  'scripts/governance/current-gate-result-schema.ts',
] as const;

export type CurrentGateKind = 'test' | 'gate' | 'lane';
export type CurrentGateVisualPolicy = 'none' | 'targeted' | 'full';
export type CurrentGateBackendRealPolicy = 'none' | 'optional' | 'required';
export type CurrentGateRequirement = 'default' | 'release' | 'visual';
export type CurrentGateStoryEvidencePolicy = 'none' | 'required';
export type CurrentGateStoryEvidenceKind = 'visual_scene_catalog' | 'ux_trace_bundle';
export type CurrentGateUxTraceExpectedMembership = {
  suite: string;
  storyId: string;
  scenarioId?: string;
};
export type CurrentGateEvidenceArtifactKind =
  | 'file'
  | 'directory'
  | 'directory_non_empty'
  | 'recursive_file'
  | 'visual_run_manifest'
  | 'visual_baseline_reviews';
export type CurrentGateExecutionTarget =
  | {
      kind: 'npm_script';
      npmScript: string;
    }
  | {
      kind: 'shell_script';
      scriptPath: string;
      args?: readonly string[];
    }
  | {
      kind: 'npx_command';
      command: string;
      args?: readonly string[];
    };

export interface CurrentGateEvidenceArtifact {
  id: string;
  path: string;
  kind: CurrentGateEvidenceArtifactKind;
  fileName?: string;
  minCount?: number;
  expectedMembership?: readonly CurrentGateUxTraceExpectedMembership[];
}

export interface CurrentGateDefinition {
  id: string;
  npmScript: string;
  adapterAliases: readonly string[];
  command: string;
  executionTargets: readonly CurrentGateExecutionTarget[];
  description: string;
  kind: CurrentGateKind;
  visualPolicy: CurrentGateVisualPolicy;
  backendRealPolicy: CurrentGateBackendRealPolicy;
  storyEvidencePolicy: CurrentGateStoryEvidencePolicy;
  storyEvidenceKinds: readonly CurrentGateStoryEvidenceKind[];
  storyEvidenceArtifacts: readonly string[];
  standaloneEvidenceArtifacts: readonly string[];
  campaignEvidenceArtifacts: readonly string[];
  storyEvidenceRequiredFor: readonly CurrentGateRequirement[];
  storyEvidenceSceneSource?: string;
  ciJob?: string;
  checklistDocs: readonly string[];
  requiredFor: readonly CurrentGateRequirement[];
}

function defineCurrentGate(
  definition: Omit<
    CurrentGateDefinition,
    | 'adapterAliases'
    | 'storyEvidencePolicy'
    | 'storyEvidenceKinds'
    | 'storyEvidenceArtifacts'
    | 'standaloneEvidenceArtifacts'
    | 'campaignEvidenceArtifacts'
    | 'storyEvidenceRequiredFor'
  > &
    Partial<
      Pick<
        CurrentGateDefinition,
        | 'adapterAliases'
        | 'storyEvidencePolicy'
        | 'storyEvidenceKinds'
        | 'storyEvidenceArtifacts'
        | 'standaloneEvidenceArtifacts'
        | 'campaignEvidenceArtifacts'
        | 'storyEvidenceRequiredFor'
      >
    >,
): CurrentGateDefinition {
  const storyEvidenceArtifacts = definition.storyEvidenceArtifacts
    ?? definition.standaloneEvidenceArtifacts
    ?? [];
  const standaloneEvidenceArtifacts = definition.standaloneEvidenceArtifacts
    ?? storyEvidenceArtifacts;
  const campaignEvidenceArtifacts = definition.campaignEvidenceArtifacts ?? [];

  return {
    adapterAliases: [],
    storyEvidencePolicy: 'none',
    storyEvidenceKinds: [],
    storyEvidenceRequiredFor: [],
    ...definition,
    storyEvidenceArtifacts,
    standaloneEvidenceArtifacts,
    campaignEvidenceArtifacts,
  };
}

function npmScriptTarget(npmScript: string): CurrentGateExecutionTarget {
  return {
    kind: 'npm_script',
    npmScript,
  };
}

function shellScriptTarget(scriptPath: string, args: readonly string[] = []): CurrentGateExecutionTarget {
  return {
    kind: 'shell_script',
    scriptPath,
    args,
  };
}

function npxCommandTarget(command: string, args: readonly string[] = []): CurrentGateExecutionTarget {
  return {
    kind: 'npx_command',
    command,
    args,
  };
}

export const CURRENT_RELEASE_BACKEND_REAL_UX_TRACE_MEMBERSHIP = [
  {
    suite: 'integration-release-user-story',
    storyId: 'release-user-story-end-to-end',
    scenarioId: 'integration-release-user-story',
  },
] as const satisfies readonly CurrentGateUxTraceExpectedMembership[];

export const CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY = {
  laneVisual: [
    {
      id: 'visual_scene_catalog_source',
      path: 'e2e/visual-baseline-support.ts',
      kind: 'file',
    },
    {
      id: 'visual_committed_screenshots',
      path: 'e2e/__screenshots__/visual.spec.ts',
      kind: 'directory_non_empty',
    },
    {
      id: 'visual_run_manifest',
      path: '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/run-manifest.json',
      kind: 'visual_run_manifest',
    },
    {
      id: 'visual_review_artifacts',
      path: '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/<visual-scenario-id>/review.md',
      kind: 'visual_baseline_reviews',
    },
  ],
  gateRelease: [
    {
      id: 'backend_real_native_result',
      path: '<campaign-root>/gate-release/native/result.json',
      kind: 'file',
    },
    {
      id: 'backend_real_visual_review',
      path: '<campaign-root>/gate-release/backend-real-visual/review.md',
      kind: 'file',
    },
    {
      id: 'backend_real_ux_trace_index',
      path: '<campaign-root>/gate-release/backend-real-visual/ux-traces/ux-trace-index.json',
      kind: 'file',
    },
    {
      id: 'backend_real_ux_trace_reviews',
      path: '<campaign-root>/gate-release/backend-real-visual/ux-traces',
      kind: 'recursive_file',
      fileName: 'review.md',
      minCount: CURRENT_RELEASE_BACKEND_REAL_UX_TRACE_MEMBERSHIP.length,
      expectedMembership: CURRENT_RELEASE_BACKEND_REAL_UX_TRACE_MEMBERSHIP,
    },
  ],
  laneDemoRehearsal: [
    {
      id: 'demo_rehearsal_native_result',
      path: '<campaign-root>/lane-demo-rehearsal/native/result.json',
      kind: 'file',
    },
    {
      id: 'demo_rehearsal_report',
      path: '<campaign-root>/lane-demo-rehearsal/scenario/reports',
      kind: 'recursive_file',
      fileName: '.md',
      minCount: 1,
    },
  ],
  laneClusterRehearsal: [
    {
      id: 'cluster_rehearsal_native_result',
      path: '<campaign-root>/lane-cluster-rehearsal/native/result.json',
      kind: 'file',
    },
    {
      id: 'cluster_rehearsal_report',
      path: '<campaign-root>/lane-cluster-rehearsal/scenario/reports',
      kind: 'recursive_file',
      fileName: '.md',
      minCount: 1,
    },
  ],
} as const satisfies Record<string, readonly CurrentGateEvidenceArtifact[]>;

type CurrentReleaseCampaignEvidenceTopologyKey = keyof typeof CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY;

function campaignEvidenceArtifactPaths(
  key: CurrentReleaseCampaignEvidenceTopologyKey,
): readonly string[] {
  return CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY[key].map((artifact) => artifact.path);
}

const VISUAL_CAMPAIGN_EVIDENCE_ARTIFACTS = [
  '<campaign-root>/lane-visual/visual-baseline-reviews/<campaign-run-id>/run-manifest.json',
] as const;

export const CURRENT_RELEASE_FULL_CAMPAIGN_EVIDENCE_ARTIFACTS = [
  '<campaign-root>/lane-visual/native/result.json',
  ...VISUAL_CAMPAIGN_EVIDENCE_ARTIFACTS,
  ...campaignEvidenceArtifactPaths('gateRelease'),
  ...campaignEvidenceArtifactPaths('laneDemoRehearsal'),
  ...campaignEvidenceArtifactPaths('laneClusterRehearsal'),
  '<campaign-root>/gate-release-full/evidence.json',
  '<campaign-root>/gate-release-full/result.json',
] as const;

const VISUAL_STANDALONE_EVIDENCE_ARTIFACTS = [
  'artifacts/visual-baseline-reviews/<run-id>/run-manifest.json',
] as const;

const BACKEND_REAL_RELEASE_STANDALONE_EVIDENCE_ARTIFACTS = [
  'artifacts/backend-real-visual/<run-id>/review.md',
  'artifacts/backend-real-visual/<run-id>/ux-traces',
] as const;

export const CURRENT_GATE_MANIFEST: readonly CurrentGateDefinition[] = [
  defineCurrentGate({
    id: 'lane-mock',
    npmScript: 'lane:mock',
    adapterAliases: ['test:e2e'],
    command: 'npm run test:e2e',
    executionTargets: [npmScriptTarget('test:e2e')],
    description: 'run the mock diagnostic verification channel',
    kind: 'lane',
    visualPolicy: 'none',
    backendRealPolicy: 'none',
    checklistDocs: ['docs/testing/diagnostic-catalog-v1.md'],
    requiredFor: [],
  }),
  defineCurrentGate({
    id: 'workspace-project-default',
    npmScript: 'test:default-e2e',
    command: 'bash scripts/workspace-project-default-gate.sh',
    executionTargets: [shellScriptTarget('scripts/workspace-project-default-gate.sh')],
    description: 'run the workspace/project default engineering gate bundle with targeted visual coverage only',
    kind: 'test',
    visualPolicy: 'targeted',
    backendRealPolicy: 'optional',
    checklistDocs: ['docs/user-guides/workspace-project-default-engineering-gate-checklist.md'],
    requiredFor: ['default', 'release'],
  }),
  defineCurrentGate({
    id: 'governance-default',
    npmScript: 'test:governance',
    command: 'bash scripts/governance-default-gate.sh',
    executionTargets: [shellScriptTarget('scripts/governance-default-gate.sh')],
    description: 'run the governance default engineering gate bundle with targeted visual coverage only',
    kind: 'test',
    visualPolicy: 'targeted',
    backendRealPolicy: 'none',
    checklistDocs: ['docs/user-guides/governance-default-engineering-gate-checklist.md'],
    requiredFor: ['default', 'release'],
  }),
  defineCurrentGate({
    id: 'visual-lane-command',
    npmScript: 'test:visual',
    command: 'bash scripts/run-mock-lane-playwright.sh e2e/visual.spec.ts --project=visual --workers=1',
    executionTargets: [
      shellScriptTarget('scripts/run-mock-lane-playwright.sh', [
        'e2e/visual.spec.ts',
        '--project=visual',
        '--workers=1',
      ]),
    ],
    description: 'run the full visual verification lane',
    kind: 'test',
    visualPolicy: 'full',
    backendRealPolicy: 'none',
    storyEvidencePolicy: 'required',
    storyEvidenceKinds: ['visual_scene_catalog'],
    storyEvidenceArtifacts: VISUAL_STANDALONE_EVIDENCE_ARTIFACTS,
    standaloneEvidenceArtifacts: VISUAL_STANDALONE_EVIDENCE_ARTIFACTS,
    campaignEvidenceArtifacts: VISUAL_CAMPAIGN_EVIDENCE_ARTIFACTS,
    storyEvidenceRequiredFor: ['visual', 'release'],
    storyEvidenceSceneSource: 'e2e/visual-baseline-support.ts',
    checklistDocs: ['docs/user-guides/release-readiness-checklist.md'],
    requiredFor: ['visual', 'release'],
  }),
  defineCurrentGate({
    id: 'test-backend-real-core',
    npmScript: 'test:backend-real:core',
    command: 'bash scripts/workspace-project-default-gate.sh --with-backend-real',
    executionTargets: [
      shellScriptTarget('scripts/workspace-project-default-gate.sh', ['--with-backend-real']),
    ],
    description: 'run the default-tier backend-real daily and self-service verification suite',
    kind: 'test',
    visualPolicy: 'targeted',
    backendRealPolicy: 'required',
    storyEvidencePolicy: 'required',
    storyEvidenceKinds: ['ux_trace_bundle'],
    storyEvidenceArtifacts: ['artifacts/backend-real/runs/<run-id>/ux-traces'],
    storyEvidenceRequiredFor: ['default'],
    checklistDocs: [
      'docs/user-guides/workspace-project-default-engineering-gate-checklist.md',
      'docs/user-guides/release-readiness-checklist.md',
    ],
    requiredFor: [],
  }),
  defineCurrentGate({
    id: 'gate-fast',
    npmScript: 'gate:fast',
    command: 'DEFAULT_GATE_PROFILE=fast bash scripts/default-gate.sh',
    executionTargets: [shellScriptTarget('scripts/default-gate.sh')],
    description: 'run the fast engineering gate',
    kind: 'gate',
    visualPolicy: 'none',
    backendRealPolicy: 'none',
    ciJob: 'gate-fast',
    checklistDocs: ['docs/user-guides/release-readiness-checklist.md'],
    requiredFor: ['default', 'release'],
  }),
  defineCurrentGate({
    id: 'gate-default',
    npmScript: 'gate:default',
    command: 'bash scripts/default-gate.sh',
    executionTargets: [shellScriptTarget('scripts/default-gate.sh')],
    description: 'run the default engineering gate without the full visual lane',
    kind: 'gate',
    visualPolicy: 'targeted',
    backendRealPolicy: 'none',
    ciJob: 'gate-default',
    checklistDocs: [
      'docs/user-guides/workspace-project-default-engineering-gate-checklist.md',
      'docs/user-guides/governance-default-engineering-gate-checklist.md',
      'docs/user-guides/release-readiness-checklist.md',
    ],
    requiredFor: ['default', 'release'],
  }),
  defineCurrentGate({
    id: 'lane-visual',
    npmScript: 'lane:visual',
    command: 'npm run test:visual',
    executionTargets: [npmScriptTarget('test:visual')],
    description: 'run the full visual verification channel',
    kind: 'lane',
    visualPolicy: 'full',
    backendRealPolicy: 'none',
    storyEvidencePolicy: 'required',
    storyEvidenceKinds: ['visual_scene_catalog'],
    storyEvidenceArtifacts: VISUAL_STANDALONE_EVIDENCE_ARTIFACTS,
    standaloneEvidenceArtifacts: VISUAL_STANDALONE_EVIDENCE_ARTIFACTS,
    campaignEvidenceArtifacts: VISUAL_CAMPAIGN_EVIDENCE_ARTIFACTS,
    storyEvidenceRequiredFor: ['visual', 'release'],
    storyEvidenceSceneSource: 'e2e/visual-baseline-support.ts',
    ciJob: 'lane-visual',
    checklistDocs: ['docs/user-guides/release-readiness-checklist.md'],
    requiredFor: ['visual', 'release'],
  }),
  defineCurrentGate({
    id: 'lane-backend-real-core',
    npmScript: 'lane:backend-real:core',
    command: 'npm run backend-real:run',
    executionTargets: [npmScriptTarget('backend-real:run')],
    description: 'run the core backend-real verification channel',
    kind: 'lane',
    visualPolicy: 'none',
    backendRealPolicy: 'required',
    storyEvidencePolicy: 'required',
    storyEvidenceKinds: ['ux_trace_bundle'],
    storyEvidenceArtifacts: ['artifacts/backend-real/runs/<run-id>/ux-traces'],
    storyEvidenceRequiredFor: ['default'],
    ciJob: 'lane-backend-real-core',
    checklistDocs: [
      'docs/user-guides/workspace-project-default-engineering-gate-checklist.md',
      'docs/user-guides/release-readiness-checklist.md',
    ],
    requiredFor: [],
  }),
  defineCurrentGate({
    id: 'gate-release',
    npmScript: 'gate:release',
    command: 'npm run lane:backend-real:release',
    executionTargets: [npmScriptTarget('lane:backend-real:release')],
    description: 'run the release-grade engineering gate after full visual and backend-real preparation',
    kind: 'gate',
    visualPolicy: 'none',
    backendRealPolicy: 'required',
    storyEvidencePolicy: 'required',
    storyEvidenceKinds: ['ux_trace_bundle'],
    storyEvidenceArtifacts: BACKEND_REAL_RELEASE_STANDALONE_EVIDENCE_ARTIFACTS,
    standaloneEvidenceArtifacts: BACKEND_REAL_RELEASE_STANDALONE_EVIDENCE_ARTIFACTS,
    campaignEvidenceArtifacts: campaignEvidenceArtifactPaths('gateRelease'),
    storyEvidenceRequiredFor: ['release'],
    checklistDocs: ['docs/user-guides/release-readiness-checklist.md'],
    requiredFor: ['release'],
  }),
  defineCurrentGate({
    id: 'lane-demo-rehearsal',
    npmScript: 'lane:demo-rehearsal',
    command: 'bash scripts/scenarios/demo-rehearsal/reset.sh && bash scripts/scenarios/demo-rehearsal/up.sh && bash scripts/scenarios/demo-rehearsal/bootstrap.sh && bash scripts/scenarios/demo-rehearsal/verify.sh && bash scripts/scenarios/demo-rehearsal/report.sh',
    executionTargets: [
      shellScriptTarget('scripts/scenarios/demo-rehearsal/reset.sh'),
      shellScriptTarget('scripts/scenarios/demo-rehearsal/up.sh'),
      shellScriptTarget('scripts/scenarios/demo-rehearsal/bootstrap.sh'),
      shellScriptTarget('scripts/scenarios/demo-rehearsal/verify.sh'),
      shellScriptTarget('scripts/scenarios/demo-rehearsal/report.sh'),
    ],
    description: 'run the demo deploy rehearsal lane from a clean state through evidence generation',
    kind: 'lane',
    visualPolicy: 'none',
    backendRealPolicy: 'none',
    campaignEvidenceArtifacts: campaignEvidenceArtifactPaths('laneDemoRehearsal'),
    checklistDocs: ['docs/user-guides/release-readiness-checklist.md'],
    requiredFor: ['release'],
  }),
  defineCurrentGate({
    id: 'lane-cluster-rehearsal',
    npmScript: 'lane:cluster-rehearsal',
    command: 'bash scripts/scenarios/cluster-rehearsal/reset.sh && bash scripts/scenarios/cluster-rehearsal/up.sh && bash scripts/scenarios/cluster-rehearsal/bootstrap.sh && bash scripts/scenarios/cluster-rehearsal/verify.sh && bash scripts/scenarios/cluster-rehearsal/report.sh',
    executionTargets: [
      shellScriptTarget('scripts/scenarios/cluster-rehearsal/reset.sh'),
      shellScriptTarget('scripts/scenarios/cluster-rehearsal/up.sh'),
      shellScriptTarget('scripts/scenarios/cluster-rehearsal/bootstrap.sh'),
      shellScriptTarget('scripts/scenarios/cluster-rehearsal/verify.sh'),
      shellScriptTarget('scripts/scenarios/cluster-rehearsal/report.sh'),
    ],
    description: 'run the cluster deploy rehearsal lane from a clean state through evidence generation',
    kind: 'lane',
    visualPolicy: 'none',
    backendRealPolicy: 'none',
    campaignEvidenceArtifacts: campaignEvidenceArtifactPaths('laneClusterRehearsal'),
    checklistDocs: ['docs/user-guides/release-readiness-checklist.md'],
    requiredFor: ['release'],
  }),
  defineCurrentGate({
    id: 'lane-backend-real-release',
    npmScript: 'lane:backend-real:release',
    command: 'bash scripts/backend-real-full-gate.sh',
    executionTargets: [shellScriptTarget('scripts/backend-real-full-gate.sh')],
    description: 'run the full backend-real release verification channel',
    kind: 'lane',
    visualPolicy: 'none',
    backendRealPolicy: 'required',
    storyEvidencePolicy: 'required',
    storyEvidenceKinds: ['ux_trace_bundle'],
    storyEvidenceArtifacts: BACKEND_REAL_RELEASE_STANDALONE_EVIDENCE_ARTIFACTS,
    standaloneEvidenceArtifacts: BACKEND_REAL_RELEASE_STANDALONE_EVIDENCE_ARTIFACTS,
    campaignEvidenceArtifacts: campaignEvidenceArtifactPaths('gateRelease'),
    storyEvidenceRequiredFor: ['release'],
    checklistDocs: ['docs/user-guides/release-readiness-checklist.md'],
    requiredFor: ['release'],
  }),
  defineCurrentGate({
    id: 'gate-release-full',
    npmScript: 'gate:release:full',
    command: 'bash scripts/release-full-aggregate-gate.sh',
    executionTargets: [shellScriptTarget('scripts/release-full-aggregate-gate.sh')],
    description: 'evaluate the aggregate automated release-grade verdict from release campaign results',
    kind: 'gate',
    visualPolicy: 'full',
    backendRealPolicy: 'required',
    storyEvidencePolicy: 'required',
    storyEvidenceKinds: ['visual_scene_catalog', 'ux_trace_bundle'],
    storyEvidenceArtifacts: CURRENT_RELEASE_FULL_CAMPAIGN_EVIDENCE_ARTIFACTS,
    standaloneEvidenceArtifacts: [],
    campaignEvidenceArtifacts: CURRENT_RELEASE_FULL_CAMPAIGN_EVIDENCE_ARTIFACTS,
    storyEvidenceRequiredFor: ['release'],
    storyEvidenceSceneSource: 'e2e/visual-baseline-support.ts',
    checklistDocs: ['docs/user-guides/release-readiness-checklist.md'],
    requiredFor: ['release'],
  }),
] as const;

export function listCurrentGateDefinitions(): readonly CurrentGateDefinition[] {
  return CURRENT_GATE_MANIFEST;
}

export function listCurrentGateDefinitionsByKind(kind: CurrentGateKind): readonly CurrentGateDefinition[] {
  return CURRENT_GATE_MANIFEST.filter((definition) => definition.kind === kind);
}

export function findCurrentGateDefinition(npmScript: string): CurrentGateDefinition | undefined {
  return findCurrentGateDefinitionById(npmScript)
    ?? CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === npmScript)
    ?? CURRENT_GATE_MANIFEST.find((definition) => definition.adapterAliases.includes(npmScript));
}

export function findCurrentGateDefinitionById(id: string): CurrentGateDefinition | undefined {
  return CURRENT_GATE_MANIFEST.find((definition) => definition.id === id);
}

export function findCurrentReleaseCampaignEvidenceArtifact(
  key: CurrentReleaseCampaignEvidenceTopologyKey,
  artifactId: string,
): CurrentGateEvidenceArtifact | undefined {
  return CURRENT_RELEASE_CAMPAIGN_EVIDENCE_TOPOLOGY[key]
    .find((artifact) => artifact.id === artifactId);
}
