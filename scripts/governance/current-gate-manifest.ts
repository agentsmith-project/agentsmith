export const CURRENT_GATE_DOCUMENT_FILES = [
  'docs/current-engineering-governance-model.md',
  'docs/contracts/current-gate-manifest-contract.md',
  'docs/contracts/current-gate-result-schema-contract.md',
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

export interface CurrentGateDefinition {
  id: string;
  npmScript: string;
  command: string;
  executionTargets: readonly CurrentGateExecutionTarget[];
  description: string;
  kind: CurrentGateKind;
  visualPolicy: CurrentGateVisualPolicy;
  backendRealPolicy: CurrentGateBackendRealPolicy;
  storyEvidencePolicy: CurrentGateStoryEvidencePolicy;
  storyEvidenceKinds: readonly CurrentGateStoryEvidenceKind[];
  storyEvidenceArtifacts: readonly string[];
  storyEvidenceRequiredFor: readonly CurrentGateRequirement[];
  storyEvidenceSceneSource?: string;
  ciJob?: string;
  checklistDocs: readonly string[];
  requiredFor: readonly CurrentGateRequirement[];
}

function defineCurrentGate(
  definition: Omit<
    CurrentGateDefinition,
    'storyEvidencePolicy' | 'storyEvidenceKinds' | 'storyEvidenceArtifacts' | 'storyEvidenceRequiredFor'
  > &
    Partial<
      Pick<
        CurrentGateDefinition,
        'storyEvidencePolicy' | 'storyEvidenceKinds' | 'storyEvidenceArtifacts' | 'storyEvidenceRequiredFor'
      >
    >,
): CurrentGateDefinition {
  return {
    storyEvidencePolicy: 'none',
    storyEvidenceKinds: [],
    storyEvidenceArtifacts: [],
    storyEvidenceRequiredFor: [],
    ...definition,
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

export const CURRENT_GATE_MANIFEST: readonly CurrentGateDefinition[] = [
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
    storyEvidenceArtifacts: [
      'e2e/__screenshots__/visual.spec.ts',
      'artifacts/visual-baseline-reviews/<run-id>/<scenario-id>/review.md',
    ],
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
    command: 'npm run contracts:check && npx tsc --noEmit && npm run test:e2e:lane:mock:smoke',
    executionTargets: [
      npmScriptTarget('contracts:check'),
      npxCommandTarget('tsc', ['--noEmit']),
      npmScriptTarget('test:e2e:lane:mock:smoke'),
    ],
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
    command: 'npm run test:default-e2e && npm run test:governance',
    executionTargets: [
      npmScriptTarget('test:default-e2e'),
      npmScriptTarget('test:governance'),
    ],
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
    storyEvidenceArtifacts: [
      'e2e/__screenshots__/visual.spec.ts',
      'artifacts/visual-baseline-reviews/<run-id>/<scenario-id>/review.md',
    ],
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
    storyEvidenceArtifacts: [
      'artifacts/backend-real-visual/<run-id>/review.md',
      'artifacts/backend-real-visual/<run-id>/ux-traces',
    ],
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
    storyEvidenceArtifacts: [
      'artifacts/backend-real-visual/<run-id>/review.md',
      'artifacts/backend-real-visual/<run-id>/ux-traces',
    ],
    storyEvidenceRequiredFor: ['release'],
    checklistDocs: ['docs/user-guides/release-readiness-checklist.md'],
    requiredFor: ['release'],
  }),
  defineCurrentGate({
    id: 'gate-release-full',
    npmScript: 'gate:release:full',
    command: 'npm run gate:release && npm run lane:visual && npm run lane:demo-rehearsal && npm run lane:cluster-rehearsal',
    executionTargets: [
      npmScriptTarget('gate:release'),
      npmScriptTarget('lane:visual'),
      npmScriptTarget('lane:demo-rehearsal'),
      npmScriptTarget('lane:cluster-rehearsal'),
    ],
    description: 'run the full release gate including visual and both deployment rehearsals',
    kind: 'gate',
    visualPolicy: 'full',
    backendRealPolicy: 'required',
    storyEvidencePolicy: 'required',
    storyEvidenceKinds: ['visual_scene_catalog', 'ux_trace_bundle'],
    storyEvidenceArtifacts: [
      'e2e/__screenshots__/visual.spec.ts',
      'artifacts/visual-baseline-reviews/<run-id>/<scenario-id>/review.md',
      'artifacts/backend-real-visual/<run-id>/review.md',
      'artifacts/backend-real-visual/<run-id>/ux-traces',
    ],
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
    ?? CURRENT_GATE_MANIFEST.find((definition) => definition.npmScript === npmScript);
}

export function findCurrentGateDefinitionById(id: string): CurrentGateDefinition | undefined {
  return CURRENT_GATE_MANIFEST.find((definition) => definition.id === id);
}
