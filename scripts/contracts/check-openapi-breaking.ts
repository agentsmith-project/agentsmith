import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type OpenApiDoc = {
  paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
};

export type BreakingAllowlist = {
  operations?: string[];
  responses?: string[];
  operation_hashes?: string[];
  response_hashes?: string[];
};

export type ForbiddenBreakingAllowlistEntry = {
  section: keyof BreakingAllowlist;
  value: string;
  reason: string;
};

function loadCurrent(): OpenApiDoc {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '../..');
  const currentPath = path.join(repoRoot, 'docs', 'contracts', 'specs', 'openapi.json');
  return JSON.parse(readFileSync(currentPath, 'utf-8')) as OpenApiDoc;
}

function hashEntry(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const forbiddenAllowlistPathRules = [
  {
    reason: 'retired managed credential refresh path',
    pattern: /\/api\/v1\/context\/managed-credentials\/\{provider\}\/refresh(?:\s|$)/u,
  },
  {
    reason: 'retired provider-bound Feishu path',
    pattern:
      /\/api\/v1\/workspaces\/\{workspaceId\}\/(?:integrations\/feishu|feishu|me\/feishu)(?:\/|\s|$)/u,
  },
] as const;

const managedCredentialRefreshOperation =
  'post /api/v1/context/managed-credentials/{provider}/refresh';
const integrationsFeishuReadOperation =
  'get /api/v1/workspaces/{workspaceId}/integrations/feishu';
const integrationsFeishuWriteOperation =
  'put /api/v1/workspaces/{workspaceId}/integrations/feishu';
const integrationsFeishuVerifyOperation =
  'post /api/v1/workspaces/{workspaceId}/integrations/feishu/verify/start';
const integrationsFeishuEnableOperation =
  'post /api/v1/workspaces/{workspaceId}/integrations/feishu/enable';
const feishuOauthCompleteOperation =
  'post /api/v1/workspaces/{workspaceId}/feishu/oauth/complete';
const meFeishuAuthStartOperation =
  'post /api/v1/workspaces/{workspaceId}/me/feishu/auth/start';

const forbiddenAllowlistOperations = [
  managedCredentialRefreshOperation,
  integrationsFeishuReadOperation,
  integrationsFeishuWriteOperation,
  integrationsFeishuVerifyOperation,
  integrationsFeishuEnableOperation,
  feishuOauthCompleteOperation,
  meFeishuAuthStartOperation,
] as const;

const forbiddenAllowlistResponseStatusRules = [
  [managedCredentialRefreshOperation, ['200', '401', '403', '404', '422']],
  [integrationsFeishuReadOperation, ['200', '401', '403']],
  [integrationsFeishuWriteOperation, ['200', '401', '403', '422']],
  [integrationsFeishuVerifyOperation, ['200', '401', '403', '422']],
  [integrationsFeishuEnableOperation, ['200', '401', '403', '409']],
  [feishuOauthCompleteOperation, ['200', '401', '403', '422']],
  [meFeishuAuthStartOperation, ['200', '401', '403', '409']],
] as const;

function collectForbiddenAllowlistEntries(): string[] {
  return [
    ...forbiddenAllowlistOperations,
    ...forbiddenAllowlistResponseStatusRules.flatMap(([operation, statuses]) =>
      statuses.map((status) => `${operation} -> ${status}`),
    ),
  ];
}

function forbiddenAllowlistHashes(): Set<string> {
  return new Set(collectForbiddenAllowlistEntries().map(hashEntry));
}

export function findForbiddenBreakingAllowlistEntries(
  allowlist: BreakingAllowlist,
): ForbiddenBreakingAllowlistEntry[] {
  const findings: ForbiddenBreakingAllowlistEntry[] = [];
  const plainSections = [
    ['operations', allowlist.operations ?? []],
    ['responses', allowlist.responses ?? []],
  ] as const;

  for (const [section, values] of plainSections) {
    for (const value of values) {
      const rule = forbiddenAllowlistPathRules.find((candidate) =>
        candidate.pattern.test(value),
      );
      if (rule) {
        findings.push({ section, value, reason: rule.reason });
      }
    }
  }

  const forbiddenHashes = forbiddenAllowlistHashes();
  const hashSections = [
    ['operation_hashes', allowlist.operation_hashes ?? []],
    ['response_hashes', allowlist.response_hashes ?? []],
  ] as const;

  for (const [section, values] of hashSections) {
    for (const value of values) {
      if (forbiddenHashes.has(value)) {
        findings.push({
          section,
          value,
          reason: 'hash for retired provider-bound Feishu or managed credential refresh path',
        });
      }
    }
  }

  return findings;
}

function loadAllowlist(): {
  operations: Set<string>;
  responses: Set<string>;
  operationHashes: Set<string>;
  responseHashes: Set<string>;
  forbiddenEntries: ForbiddenBreakingAllowlistEntry[];
} {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '../..');
  const allowlistPath = path.join(
    repoRoot,
    'docs',
    'contracts',
    'specs',
    'openapi-breaking-allowlist.json',
  );
  if (!existsSync(allowlistPath)) {
    return {
      operations: new Set(),
      responses: new Set(),
      operationHashes: new Set(),
      responseHashes: new Set(),
      forbiddenEntries: [],
    };
  }
  const parsed = JSON.parse(readFileSync(allowlistPath, 'utf-8')) as BreakingAllowlist;
  return {
    operations: new Set(parsed.operations ?? []),
    responses: new Set(parsed.responses ?? []),
    operationHashes: new Set(parsed.operation_hashes ?? []),
    responseHashes: new Set(parsed.response_hashes ?? []),
    forbiddenEntries: findForbiddenBreakingAllowlistEntries(parsed),
  };
}

function loadBaseFromGit(): OpenApiDoc | null {
  try {
    execSync('git rev-parse --verify origin/main', {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    return null;
  }

  try {
    const raw = execSync('git show origin/main:docs/contracts/specs/openapi.json', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    });
    return JSON.parse(raw) as OpenApiDoc;
  } catch {
    // Baseline branch exists but has no OpenAPI spec yet.
    return {};
  }
}

function operationKeys(doc: OpenApiDoc): Set<string> {
  const keys = new Set<string>();
  for (const [apiPath, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(pathItem ?? {})) {
      keys.add(`${method.toLowerCase()} ${apiPath}`);
    }
  }
  return keys;
}

function responseKeys(
  doc: OpenApiDoc,
): Set<string> {
  const keys = new Set<string>();
  for (const [apiPath, pathItem] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      for (const status of Object.keys(operation.responses ?? {})) {
        keys.add(`${method.toLowerCase()} ${apiPath} -> ${status}`);
      }
    }
  }
  return keys;
}

function main(): void {
  const allowlist = loadAllowlist();
  if (allowlist.forbiddenEntries.length > 0) {
    process.stderr.write(
      '[contracts] OpenAPI breaking check failed: retired provider-bound allowlist entries must not be active.\n',
    );
    for (const finding of allowlist.forbiddenEntries) {
      process.stderr.write(`- ${finding.section}: ${finding.value} (${finding.reason})\n`);
    }
    process.exit(1);
  }

  const base = loadBaseFromGit();
  if (!base) {
    const strictMode = process.env.CI === 'true' || process.env.OPENAPI_BREAKING_STRICT === 'true';
    if (strictMode) {
      process.stderr.write(
        '[contracts] OpenAPI breaking check failed: origin/main baseline not available in strict mode.\n',
      );
      process.exit(1);
    }
    process.stdout.write('[contracts] Skipped OpenAPI breaking check (origin/main spec not available).\n');
    return;
  }

  const current = loadCurrent();
  const currentOps = operationKeys(current);
  const currentResponses = responseKeys(current);

  const removedOps = Array.from(operationKeys(base))
    .filter((op) => !currentOps.has(op))
    .filter((op) => !allowlist.operations.has(op))
    .filter((op) => !allowlist.operationHashes.has(hashEntry(op)));
  const removedResponses = Array.from(responseKeys(base))
    .filter((key) => !currentResponses.has(key))
    .filter((key) => !allowlist.responses.has(key))
    .filter((key) => !allowlist.responseHashes.has(hashEntry(key)));

  if (removedOps.length === 0 && removedResponses.length === 0) {
    process.stdout.write('[contracts] OpenAPI breaking check passed.\n');
    return;
  }

  process.stderr.write('[contracts] OpenAPI breaking check failed. Removed contract surface detected.\n');
  if (removedOps.length > 0) {
    process.stderr.write('Removed operations:\n');
    for (const op of removedOps) process.stderr.write(`- ${op}\n`);
  }
  if (removedResponses.length > 0) {
    process.stderr.write('Removed responses:\n');
    for (const response of removedResponses) process.stderr.write(`- ${response}\n`);
  }
  process.exit(1);
}

function isMainModule(): boolean {
  const invokedPath = process.argv[1];

  return (
    typeof invokedPath === 'string' &&
    path.resolve(invokedPath) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  main();
}
