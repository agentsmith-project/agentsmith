export interface GovernanceCheckDefinition {
  id: string;
  name: string;
  category: string;
  command: string;
  timeout: number;
  evidenceType: 'static' | 'e2e' | 'backend-real';
}

export const GOVERNANCE_CHECK_DEFINITIONS: GovernanceCheckDefinition[] = [
  {
    id: 'typecheck',
    name: 'TypeScript typecheck',
    category: 'typecheck',
    command: 'npm run ws:typecheck',
    timeout: 60_000,
    evidenceType: 'static',
  },
  {
    id: 'openapi-check',
    name: 'OpenAPI generated check',
    category: 'contract',
    command: 'npm run openapi:check-generated',
    timeout: 30_000,
    evidenceType: 'static',
  },
  {
    id: 'contracts-check',
    name: 'OpenAPI contract checks',
    category: 'contract',
    command: 'npm run contracts:check-openapi',
    timeout: 30_000,
    evidenceType: 'static',
  },
  {
    id: 'lane-real-core',
    name: 'Core backend-real',
    category: 'lane-real-core',
    command: 'make notebook-agent-engineering-smoke-full',
    timeout: 600_000,
    evidenceType: 'backend-real',
  },
  {
    id: 'workspace-overview-evidence',
    name: 'Workspace overview workflow',
    category: 'e2e',
    command: 'make workspace-overview-smoke',
    timeout: 300_000,
    evidenceType: 'e2e',
  },
];
