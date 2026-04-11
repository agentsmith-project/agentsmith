export interface CurrentRuntimeSharedRule {
  id: string;
  summary: string;
}

export interface CurrentRuntimeLineDefinition {
  id: string;
  label: string;
  formalName: string;
  surface: 'local-flow' | 'rehearsal' | 'deploy';
  primaryUse: string;
  externalPath: string;
  internalPath: string;
  substrate: string;
  note: string;
  guidePath: string;
  localKindClusterName?: string;
  localRegistryName?: string;
  localRegistryHostPort?: number;
  k8sRegistryHost?: string;
}

export const CURRENT_RUNTIME_LINE_DOCUMENT_FILES = [
  'docs/current-engineering-governance-model.md',
  'docs/user-guides/README.md',
  'docs/user-guides/local-runtime-flows.md',
  'docs/user-guides/runtime-lines-matrix.md',
  'scripts/governance/current-runtime-line-manifest.ts',
  'scripts/governance/sync-current-runtime-line-docs.ts',
  'scripts/contracts/check-current-runtime-lines.ts',
  'scripts/contracts/check-engineering-governance.ts',
] as const;

export const CURRENT_RUNTIME_SHARED_RULES: readonly CurrentRuntimeSharedRule[] = [
  {
    id: 'shared-local-substrate',
    summary: 'One shared local substrate backs local-manual, demo-rehearsal, and cluster-rehearsal on a development host.',
  },
  {
    id: 'single-active-local-flow',
    summary: 'Only one local flow should be active at a time; switch flows by stopping or resetting the current one first.',
  },
  {
    id: 'scenario-owned-kind-worlds',
    summary: 'Demo and cluster rehearsal each own their local kind world and registry identity instead of sharing one generic local cluster.',
  },
  {
    id: 'deploy-vs-rehearsal-boundary',
    summary: 'Rehearsal lines validate release paths on a development host; deploy lines operate on target-host release roots.',
  },
] as const;

export const CURRENT_RUNTIME_LINE_MANIFEST: readonly CurrentRuntimeLineDefinition[] = [
  {
    id: 'local-manual',
    label: '本地真实手测线',
    formalName: 'local-manual',
    surface: 'local-flow',
    primaryUse: 'Daily development, real-backend manual validation, and notebook / runner checks.',
    externalPath: 'Enabled by default.',
    internalPath: 'Enabled only through local-manual-internal-up.',
    substrate: 'Shared local substrate.',
    note: 'Recommended local real-backend entrypoint.',
    guidePath: 'docs/user-guides/local-runtime-flows.md',
  },
  {
    id: 'demo-rehearsal',
    label: 'demo 本机排演线',
    formalName: 'demo-rehearsal',
    surface: 'rehearsal',
    primaryUse: 'Local rehearsal of the demo deploy flow on a development host.',
    externalPath: 'External-only in DEMO_DEPLOY_MODE=simple.',
    internalPath: 'Enabled in DEMO_DEPLOY_MODE=full via local kind sandbox simulation.',
    substrate: 'Shared local substrate.',
    note: 'Scenario-owned local kind world for demo release rehearsal.',
    guidePath: 'docs/user-guides/local-runtime-flows.md',
    localKindClusterName: 'agentsmith-demo',
    localRegistryName: 'agentsmith-demo-registry',
    localRegistryHostPort: 5001,
  },
  {
    id: 'demo-deploy',
    label: 'demo 正式发布线',
    formalName: 'demo-deploy',
    surface: 'deploy',
    primaryUse: 'Single-host demo deployment on the target host.',
    externalPath: 'External-only in simple mode.',
    internalPath: 'Enabled in full mode via local kind sandbox simulation on the target host.',
    substrate: 'Compose substrate on the target host.',
    note: 'Target-host release line, not a local rehearsal flow.',
    guidePath: 'docs/user-guides/demo-deploy-operations.md',
  },
  {
    id: 'cluster-rehearsal',
    label: 'cluster 本机排演线',
    formalName: 'cluster-rehearsal',
    surface: 'rehearsal',
    primaryUse: 'Local rehearsal of the real-cluster deployment flow on a development host.',
    externalPath: 'Always includes the external runner path.',
    internalPath: 'Always includes the internal Kubernetes execution path.',
    substrate: 'Shared local substrate.',
    note: 'Scenario-owned local kind world for real-cluster release rehearsal.',
    guidePath: 'docs/user-guides/local-runtime-flows.md',
    localKindClusterName: 'agentsmith-cluster',
    localRegistryName: 'agentsmith-cluster-registry',
    localRegistryHostPort: 5002,
    k8sRegistryHost: 'agentsmith-cluster-registry:5000',
  },
  {
    id: 'cluster-deploy',
    label: 'cluster 正式发布线',
    formalName: 'cluster-deploy',
    surface: 'deploy',
    primaryUse: 'Real-cluster release flow on the target host.',
    externalPath: 'Always includes the external runner path.',
    internalPath: 'Always includes the internal Kubernetes execution path.',
    substrate: 'Compose substrate on the target host.',
    note: 'Mode describes automation boundary, not external-only versus internal-enabled capability.',
    guidePath: 'docs/user-guides/cluster-deploy-operations.md',
  },
] as const;

export function listCurrentRuntimeLines(): readonly CurrentRuntimeLineDefinition[] {
  return CURRENT_RUNTIME_LINE_MANIFEST;
}

export function listCurrentLocalRuntimeLines(): readonly CurrentRuntimeLineDefinition[] {
  return CURRENT_RUNTIME_LINE_MANIFEST.filter((line) => line.id === 'local-manual' || line.id === 'demo-rehearsal' || line.id === 'cluster-rehearsal');
}

export function findCurrentRuntimeLine(id: string): CurrentRuntimeLineDefinition | undefined {
  return CURRENT_RUNTIME_LINE_MANIFEST.find((line) => line.id === id);
}
