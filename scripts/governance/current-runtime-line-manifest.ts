export type CurrentRuntimeSharedRuleBinding = 'contract' | 'operational_baseline';

export const CURRENT_RUNTIME_LINES_ROOT_RELATIVE = 'artifacts/runtime/lines' as const;

export interface CurrentRuntimeSharedRule {
  id: string;
  summary: string;
  binding: CurrentRuntimeSharedRuleBinding;
}

export interface CurrentRuntimeLinePathTruth {
  linesRootRelative: string;
  lineRootRelative: string;
  currentRootRelative: string;
}

export interface CurrentRuntimeLineDefinition {
  id: string;
  label: string;
  formalName: string;
  surface: 'local-flow' | 'deploy-profile';
  primaryUse: string;
  externalPath: string;
  internalPath: string;
  substrate: string;
  note: string;
  guidePath: string;
  runtimePath: CurrentRuntimeLinePathTruth;
  appRuntime: string;
  evidenceRoot?: string;
}

function defineRuntimeLinePathTruth(lineId: string): CurrentRuntimeLinePathTruth {
  const lineRootRelative = `${CURRENT_RUNTIME_LINES_ROOT_RELATIVE}/${lineId}`;
  return {
    linesRootRelative: CURRENT_RUNTIME_LINES_ROOT_RELATIVE,
    lineRootRelative,
    currentRootRelative: `${lineRootRelative}/current`,
  };
}

export const CURRENT_RUNTIME_LINE_DOCUMENT_FILES = [
  'README.md',
  'docs/current-engineering-governance-model.md',
  'docs/user-guides/README.md',
  'docs/user-guides/local-runtime-flows.md',
  'docs/user-guides/runtime-lines-matrix.md',
  'docs/user-guides/unified-deploy-operations.md',
  'scripts/governance/current-runtime-line-manifest.ts',
  'scripts/governance/sync-current-runtime-line-docs.ts',
  'scripts/contracts/check-current-runtime-lines.ts',
  'scripts/contracts/check-engineering-governance.ts',
] as const;

export const CURRENT_RUNTIME_SHARED_RULES: readonly CurrentRuntimeSharedRule[] = [
  {
    id: 'local-real-human-entry',
    summary: 'local-real is the supported developer-machine entrypoint; local-manual remains the maintainer adapter behind it.',
    binding: 'operational_baseline',
  },
  {
    id: 'serial-local-runtime-switching',
    summary: 'local-real and unified deploy substrate share default local substrate ports, so run them serially on one development host.',
    binding: 'operational_baseline',
  },
  {
    id: 'one-agentsmith-deploy',
    summary: 'There is one AgentSmith deploy model; current GA operator-facing release paths are `online` / `airgap` × `use_existing` / `install_substrates`. `local-kind` and `existing-cluster` are transition-only focused diagnostic entry names, not release targets, not separate products, and outside `product:ready` product readiness / handoff scope. `install_substrates` requires release-kit namespace-scoped installer evidence plus explicit confirmation. The `kit_provided` compatibility alias remains internal to transition-only diagnostics and is not a GA operator deployment_path.',
    binding: 'contract',
  },
  {
    id: 'docker-substrate-k8s-app-boundary',
    summary: 'Substrates stay outside the app namespace as Docker or operator-provided services; AgentSmith app workloads run in Kubernetes.',
    binding: 'contract',
  },
  {
    id: 'api-single-replica-current',
    summary: 'api replicas stay at 1 until a dedicated multi-replica execution routing design is introduced.',
    binding: 'contract',
  },
] as const;

export const CURRENT_RUNTIME_P0_HANDOFF_BOUNDARY = {
  currentMainline: 'The Docker-only local-kind unified deploy diagnostic path is the current transition-only focused diagnostic baseline, not a long-term deployment truth.',
  externalDeclared: '`external_declared` in P0 is schema, fixture, validator, and evidence boundary only; it does not mean P2/P3 completed real Kubernetes, cloud, or airgap handoff support.',
} as const;

export const CURRENT_RUNTIME_LINE_MANIFEST: readonly CurrentRuntimeLineDefinition[] = [
  {
    id: 'local-manual',
    label: '本地真实开发线',
    formalName: 'local-manual',
    surface: 'local-flow',
    primaryUse: 'Daily development, real-backend manual validation, and focused Agent task / Files checks through the local-real entrypoint.',
    externalPath: 'Human entrypoint: make local-real-up/status/down/reset.',
    internalPath: 'Maintainer diagnostics: local-manual-* and local-manual-internal-*.',
    substrate: 'Local Docker development substrate.',
    note: 'local-real is the product-facing developer path; local-manual is the adapter identity and runtime evidence root.',
    guidePath: 'docs/user-guides/local-runtime-flows.md',
    runtimePath: defineRuntimeLinePathTruth('local-manual'),
    appRuntime: 'Host API/Web/runner processes.',
  },
  {
    id: 'unified-deploy-local-kind',
    label: '统一部署本机 diagnostic entry',
    formalName: 'unified-deploy local-kind',
    surface: 'deploy-profile',
    primaryUse: 'Local Kubernetes diagnostic rehearsal on a developer machine.',
    externalPath: 'npm run test:unified-deploy:local-kind:images then npm run test:unified-deploy:local-kind.',
    internalPath: 'Same app topology as the deploy model; no separate local install path.',
    substrate: 'Docker substrate registered into Kubernetes Services and EndpointSlices.',
    note: 'Transition-only focused diagnostic; not a release target or operator verdict. Use focused product flows after rollout for the canonical deployed product smoke matrix.',
    guidePath: 'docs/user-guides/unified-deploy-operations.md',
    runtimePath: defineRuntimeLinePathTruth('unified-deploy-local-kind'),
    appRuntime: 'Kubernetes workloads in local kind.',
    evidenceRoot: 'artifacts/unified-deploy/',
  },
  {
    id: 'unified-deploy-existing-cluster',
    label: '统一部署既有集群 diagnostic entry',
    formalName: 'unified-deploy existing-cluster',
    surface: 'deploy-profile',
    primaryUse: 'Transition-only app/route wiring smoke against an operator-owned Kubernetes cluster and declared external substrate truth.',
    externalPath: 'npm run test:unified-deploy:existing-cluster-smoke with site env, substrate truth, and public base URL.',
    internalPath: 'Same app topology as local-kind, with api replicas fixed at 1 in the current milestone.',
    substrate: 'Operator-provided external substrate truth.',
    note: 'Not formal online/airgap evidence, not an AgentSmith product gate, and not an operator verdict. Route smoke proves deploy wiring; focused product flows still prove the canonical deployed product smoke matrix.',
    guidePath: 'docs/user-guides/unified-deploy-operations.md',
    runtimePath: defineRuntimeLinePathTruth('unified-deploy-existing-cluster'),
    appRuntime: 'Kubernetes workloads in an operator-owned cluster.',
    evidenceRoot: 'artifacts/unified-deploy/',
  },
] as const;

export function listCurrentRuntimeLines(): readonly CurrentRuntimeLineDefinition[] {
  return CURRENT_RUNTIME_LINE_MANIFEST;
}

export function listCurrentLocalRuntimeLines(): readonly CurrentRuntimeLineDefinition[] {
  return CURRENT_RUNTIME_LINE_MANIFEST.filter((line) => line.surface === 'local-flow');
}

export function findCurrentRuntimeLine(id: string): CurrentRuntimeLineDefinition | undefined {
  return CURRENT_RUNTIME_LINE_MANIFEST.find((line) => line.id === id);
}
