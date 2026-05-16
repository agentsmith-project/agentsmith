import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

type ScannedFile = {
  path: string;
  allowRedTeamStrings?: boolean;
};

const RUNTIME_JVS_TOKEN_PATTERN = /[A-Za-z0-9_]*(?:JVS|jvs)[A-Za-z0-9_]*/gu;

const ALLOWED_PRODUCT_RUNTIME_JVS_TOKENS = new Map<string, ReadonlySet<string>>([
  ['packages/api-entry-node/src/afscp-error-mapper.ts', new Set([
    'JVS_SAVE_POINT_NOT_FOUND',
    'REPO_JVS_MUTATION_IN_PROGRESS',
    'JVS_JOURNAL_RECOVERY_REQUIRED',
    'JVS_METADATA_INVALID',
  ])],
  ['packages/api-entry-node/src/file-library-afscp-storage.ts', new Set([
    'JVS_JOURNAL_RECOVERY_REQUIRED',
    'JVS_METADATA_INVALID',
  ])],
]);

const PRODUCT_RUNTIME_ROOTS = [
  {
    root: 'packages/api-entry-node/src',
    extensions: new Set(['.ts']),
    excludedPathPattern: /(?:^|\/)(?:__tests__|__integration__)\/|\.test\.ts$/u,
  },
  {
    root: 'scripts/unified-deploy',
    extensions: new Set(['.ts']),
    excludedPathPattern: /(?:^|\/)__fixtures__\/|\.test\.ts$|(?:^|\/)(?:render|check-render)\.ts$/u,
  },
  {
    root: 'infra/deploy/unified/templates/app',
    extensions: new Set(['.tpl']),
    excludedPathPattern: /(?:^|\/)afscp\.yaml\.tpl$/u,
  },
] as const;

const AFSCP_RUNTIME_DEPLOY_JVS_FILES = [
  'infra/deploy/unified/templates/app/afscp.yaml.tpl',
  'scripts/unified-deploy/render.ts',
  'scripts/unified-deploy/check-render.ts',
] as const;

const ALLOWED_NON_PRODUCT_JVS_FILES = [
  'scripts/local-manual/internal-common.sh',
] as const;

const PRODUCT_E2E_PLAN_DOCS_WITHOUT_JVS = [
  'docs/engineering/file-library-user-story-e2e-hardening-plan.md',
] as const;

const AFSCP_BOUNDARY_DOCS = [
  'docs/engineering/afscp-file-library-runtime-rearchitecture-plan.md',
] as const;

const FORBIDDEN_PRODUCT_E2E_DOC_JVS_PATTERN = /\b(?:JVS|jvs)\b/u;

const FORBIDDEN_AFSCP_JVS_ACCEPTANCE_PATTERNS = [
  {
    label: 'focused-jvs-checks',
    pattern: /\bFocused\s+JVS\s+checks\b/iu,
  },
  {
    label: 'jvs-upstream-evidence-row',
    pattern: /\|\s*JVS\s+upstream\s*\|/iu,
  },
  {
    label: 'afscp-jvs-upstream-evidence',
    pattern: /\bAFSCP\/JVS\s+upstream\s+evidence\b/iu,
  },
  {
    label: 'jvs-product-semantics',
    pattern: /\bJVS\s+external\s+control-root\s+and\s+clone\s+behavior\s+must\s+be\s+pinned\s+to\s+the\s+product\s+semantics\b/iu,
  },
  {
    label: 'afscp-jvs-redaction-gate',
    pattern: /\bAFSCP\/JVS\s+redaction\s+and\s+operation\s+summaries\b/iu,
  },
  {
    label: 'execute-jvs-operations',
    pattern: /\bexecute\s+JVS\s+operations\b/iu,
  },
  {
    label: 'raw-jvs-command-details',
    pattern: /\b(?:raw\s+JVS\s+command|JVS\s+command\s+strings)\b/iu,
  },
  {
    label: 'afscp-jvs-control-metadata',
    pattern: /\bAFSCP\/JVS\s+control\s+metadata\b/iu,
  },
  {
    label: 'afscp-jvs-discard-preview',
    pattern: /\bAFSCP\/JVS\s+discard-preview\b/iu,
  },
] as const;

const RED_TEAM_TEST_FILES = [
  { path: 'packages/api-entry-node/src/afscp-client.test.ts', allowRedTeamStrings: true },
  { path: 'packages/api-entry-node/src/afscp-error-mapper.test.ts', allowRedTeamStrings: true },
  { path: 'packages/api-entry-node/src/project-storage-bootstrap-service.test.ts', allowRedTeamStrings: true },
  { path: 'scripts/unified-deploy/render.test.ts', allowRedTeamStrings: true },
] as const satisfies readonly ScannedFile[];

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function collectRuntimeFiles(root: string, extensions: ReadonlySet<string>, excludedPathPattern: RegExp): ScannedFile[] {
  const found: ScannedFile[] = [];

  function visit(relativeDir: string): void {
    const absoluteDir = join(process.cwd(), root, relativeDir);
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const relativePath = join(root, relativeDir, entry.name);
      if (excludedPathPattern.test(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(join(relativeDir, entry.name));
        continue;
      }
      if (entry.isFile() && extensions.has(extname(entry.name))) {
        found.push({ path: relativePath });
      }
    }
  }

  visit('');
  return found;
}

function collectProductRuntimeFiles(): ScannedFile[] {
  return PRODUCT_RUNTIME_ROOTS.flatMap((entry) =>
    collectRuntimeFiles(entry.root, entry.extensions, entry.excludedPathPattern),
  );
}

function findForbiddenRuntimeJvsTokens(file: ScannedFile, content: string): string[] {
  const allowedTokens = ALLOWED_PRODUCT_RUNTIME_JVS_TOKENS.get(file.path) ?? new Set<string>();
  return Array.from(content.matchAll(RUNTIME_JVS_TOKEN_PATTERN))
    .map((match) => match[0])
    .filter((token) => !allowedTokens.has(token))
    .map((token) => `${file.path}: ${token}`);
}

describe('AFSCP/JVS product boundary guard', () => {
  it('keeps AgentSmith product API and non-AFSCP deploy surfaces free of JVS runtime details', () => {
    const offenders = collectProductRuntimeFiles().flatMap((file) => {
      const content = readRepoFile(file.path);
      return findForbiddenRuntimeJvsTokens(file, content);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps upstream JVS mutation codes normalized before public AgentSmith storage errors', () => {
    const mapper = readRepoFile('packages/api-entry-node/src/afscp-error-mapper.ts');
    const storage = readRepoFile('packages/api-entry-node/src/file-library-afscp-storage.ts');
    const publicJvsMutationCode = `afscp_repo_${'jvs'}_mutation_in_progress`;

    expect(mapper).toContain('REPO_JVS_MUTATION_IN_PROGRESS');
    expect(mapper).not.toContain(publicJvsMutationCode);
    expect(storage).not.toContain(publicJvsMutationCode);
  });

  it('keeps required AFSCP runtime JVS deployment config bounded to explicit deploy files', () => {
    for (const path of AFSCP_RUNTIME_DEPLOY_JVS_FILES) {
      expect(readRepoFile(path)).toMatch(/\bAFSCP_JVS/u);
    }
  });

  it('keeps product and E2E plans from making JVS a user-visible or QA acceptance surface', () => {
    const offenders = PRODUCT_E2E_PLAN_DOCS_WITHOUT_JVS.flatMap((path) => {
      const content = readRepoFile(path);
      return FORBIDDEN_PRODUCT_E2E_DOC_JVS_PATTERN.test(content) ? [path] : [];
    });

    expect(offenders).toEqual([]);
  });

  it('keeps the AFSCP boundary plan from assigning AgentSmith-owned JVS gates', () => {
    const offenders = AFSCP_BOUNDARY_DOCS.flatMap((path) => {
      const content = readRepoFile(path);
      return FORBIDDEN_AFSCP_JVS_ACCEPTANCE_PATTERNS.flatMap(({ label, pattern }) =>
        pattern.test(content) ? [`${path}:${label}`] : [],
      );
    });

    expect(offenders).toEqual([]);
  });

  it('keeps local bootstrap and red-team test allowances explicit', () => {
    for (const path of ALLOWED_NON_PRODUCT_JVS_FILES) {
      expect(readRepoFile(path)).toMatch(/\b(?:JVS|jvs)\b/u);
    }
    for (const file of RED_TEAM_TEST_FILES) {
      expect(file.allowRedTeamStrings).toBe(true);
      expect(readRepoFile(file.path)).toMatch(/\b(?:JVS|jvs)\b/u);
    }
  });
});
