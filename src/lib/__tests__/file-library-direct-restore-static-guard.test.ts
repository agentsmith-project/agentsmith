import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const forbiddenTokens = [
  `/restore-${'preview'}`,
  `/restore-${'run'}`,
  `/restore-${'cancel'}`,
  `restore_${'preview'}_id`,
  `FILE_LIBRARY_RESTORE_${'PREVIEW'}`,
  `file_library_restore_${'preview'}`,
  `activeRestore${'Preview'}`,
  `discard_${'unsaved'}_changes_confirmed`,
  `discard${'Unsaved'}ChangesConfirmed`,
  `RESTORE_${'PREVIEW'}_STALE`,
  `afscp_restore_${'preview'}_stale`,
  `restore_${'plan'}`,
  `restore${'Plan'}Id`,
  `afscp_repo_${'jvs'}_mutation_in_progress`,
  `System ${'folders'}`,
  `Runtime/${'system'}`,
];

const fileRestoreContentHashForbiddenTokens = [
  `create${'Hash'}`,
  `hash${'lib'}`,
  `sha${'256'}`,
  `SHA-${'256'}`,
  `${'digest'}`,
  `content ${'hash'}`,
  `content-${'hash'}`,
  `${'hash'}es`,
];

const explicitGuardedFiles = [
  'packages/api-entry-node/src/project-file-library-routes.ts',
  'packages/api-entry-node/src/projects-route-match.ts',
  'packages/contracts/src/index.ts',
  'docs/contracts/specs/openapi-route-kind-map.json',
  'docs/contracts/specs/openapi.yaml',
  'docs/contracts/specs/openapi.json',
  'src/components/files/file-library-recovery/FileLibraryRecoveryDialog.tsx',
  'src/components/files/file-library-recovery/__tests__/FileLibraryRecoveryDialog.test.tsx',
  'src/lib/api/endpoints/files.ts',
  'src/lib/api/errors.ts',
  'src/lib/api/types/files.ts',
  'src/lib/api/types.generated.ts',
  'src/lib/hooks/use-file-library-recovery.ts',
  'src/components/agent-tasks/TaskCreateDialog.tsx',
  'src/lib/hooks/__tests__/use-file-library-recovery.test.tsx',
  'src/lib/query-keys.ts',
  'src/mocks/handlers/files.ts',
  'src/lib/__tests__/file-library-recovery-msw.test.ts',
  'e2e/integration-files-user-stories.spec.ts',
  'scripts/file-library-real-smoke.sh',
  'scripts/file-library-real-smoke.test.ts',
  'src/messages/en-US.json',
  'src/messages/zh-CN.json',
];

const fileRestoreContentHashGuardedFiles = [
  'packages/api-entry-node/src/file-library-afscp-storage.ts',
  'packages/api-entry-node/src/file-library-afscp-storage.test.ts',
  'packages/api-entry-node/src/project-file-library-routes.ts',
  'packages/api-entry-node/src/project-file-library-routes.test.ts',
  'src/components/files/file-library-recovery/FileLibraryRecoveryDialog.tsx',
  'src/components/files/file-library-recovery/__tests__/FileLibraryRecoveryDialog.test.tsx',
  'src/lib/api/endpoints/files.ts',
  'src/lib/api/types/files.ts',
  'src/lib/hooks/use-file-library-recovery.ts',
  'src/lib/hooks/__tests__/use-file-library-recovery.test.tsx',
  'src/mocks/handlers/files.ts',
  'e2e/integration-files-user-stories.spec.ts',
  'e2e/stories/backend-real/agent-task-image-asset-savepoint-delete-restore.story.md',
  'scripts/files-restore-continuation-real-gate.sh',
];

const activeSourceRoots = [
  'docs/contracts/specs',
  'e2e',
  'packages/api-entry-node/src',
  'packages/contracts/src',
  'scripts',
  'src',
];

const activeSourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.mjs',
  '.mts',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const contractDocDeprecatedSemantics = [
  {
    label: 'workspace-default-entry',
    pattern: /(?:normal\s+)?Files\s+entry\s+opens\s+`?workspace\/?`?|workspace\s+default\s+(?:entry|root|browser|view)|workspace\s+默认入口/iu,
  },
  {
    label: 'system-folders',
    pattern: /\bsystem\s*(?:\/|-|\s)+folders?\b/iu,
  },
  {
    label: 'runtime-system-folders',
    pattern: /\bruntime\s*\/\s*system\s+(?:dot\s+)?folders?\b/iu,
  },
  {
    label: 'system-runtime-folders',
    pattern: /\bsystem\s*\/\s*runtime\s+(?:dot\s+)?folders?\b/iu,
  },
];

const excludedFiles = new Set([
  'src/lib/__tests__/file-library-direct-restore-static-guard.test.ts',
]);

function extensionOf(file: string): string {
  const slash = file.lastIndexOf('/');
  const basename = slash >= 0 ? file.slice(slash + 1) : file;
  const dot = basename.lastIndexOf('.');
  return dot >= 0 ? basename.slice(dot) : '';
}

function collectActiveSourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  return entries.flatMap((entry) => {
    const file = `${root}/${entry}`;
    if (excludedFiles.has(file)) {
      return [];
    }
    const stat = statSync(file);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'test-results') {
        return [];
      }
      return collectActiveSourceFiles(file);
    }
    if (!stat.isFile() || !activeSourceExtensions.has(extensionOf(file))) {
      return [];
    }
    return [file];
  });
}

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files)).sort();
}

function collectContractMarkdownFiles(): string[] {
  return readdirSync('docs/contracts')
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => `docs/contracts/${entry}`)
    .sort();
}

const guardedFiles = uniqueFiles([
  ...explicitGuardedFiles,
  ...activeSourceRoots.flatMap(collectActiveSourceFiles),
]);

const contractMarkdownFiles = collectContractMarkdownFiles();

const userVisibleCopyFiles = [
  'src/messages/en-US.json',
  'src/messages/zh-CN.json',
  'src/lib/api/errors.ts',
  'src/lib/api/__tests__/errors.test.ts',
  'src/components/files/__tests__/FilesPage.test.tsx',
  'src/components/files/file-library-recovery/__tests__/FileLibraryRecoveryDialog.test.tsx',
];

const forbiddenUserVisibleCopyTokens = [
  `task ${'runtime'}`,
  `task ${'workspace'} usage`,
  `Task ${'workspace'} usage`,
];

describe('file-library direct restore static guard', () => {
  it('keeps active frontend, api-entry, e2e, MSW, and smoke paths off removed restore contracts and copy', () => {
    const offenders = guardedFiles.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return forbiddenTokens
        .filter((token) => text.includes(token))
        .map((token) => `${file}: ${token}`);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps Files restore scoped roots off file-content hash evidence', () => {
    const offenders = fileRestoreContentHashGuardedFiles.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return fileRestoreContentHashForbiddenTokens
        .filter((token) => text.includes(token))
        .map((token) => `${file}: ${token}`);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps Files active-writer copy on task-file product language', () => {
    const offenders = userVisibleCopyFiles.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return forbiddenUserVisibleCopyTokens
        .filter((token) => text.includes(token))
        .map((token) => `${file}: ${token}`);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps active contract docs on whole-HOME and hidden-runtime-directory language', () => {
    const offenders = contractMarkdownFiles.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return contractDocDeprecatedSemantics
        .filter(({ pattern }) => pattern.test(text))
        .map(({ label }) => `${file}: ${label}`);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps restore-continue e2e coverage on whole-HOME hidden runtime directories', () => {
    const e2eSource = readFileSync('e2e/integration-files-user-stories.spec.ts', 'utf8');

    for (const folder of ['.codex', '.cache', '.local']) {
      expect(e2eSource).toContain(`${folder}/restore-marker`);
      expect(e2eSource).toContain(`${folder}/post-savepoint-only`);
    }
    expect(e2eSource).toContain('hidden_runtime_restore_status=ok');
  });

  it('keeps focused e2e evidence that restore confirm does not create save points or call legacy routes', () => {
    const e2eSource = readFileSync('e2e/integration-files-user-stories.spec.ts', 'utf8');

    expect(e2eSource).toContain("request.method() === 'POST'");
    expect(e2eSource).toContain('/save-points');
    expect(e2eSource).toContain('/restore-');
    expect(e2eSource).toContain("restore_' + 'preview_id");
    expect(e2eSource).not.toContain('Restore state refreshed');
    expect(e2eSource).not.toContain('No active restore is running now');
  });

  it('keeps direct restore POST and active version operation covered by OpenAPI, generated types, and route-kind map', () => {
    const routeKindMap = JSON.parse(
      readFileSync('docs/contracts/specs/openapi-route-kind-map.json', 'utf8'),
    ) as Record<string, { path?: string; method?: string; methods?: string[] }>;
    const restorePath = '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/restore';
    const activeOperationPath = '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/operations/active';
    const removedRestoreGetOperation = 'get: operations["getActiveFileLibrary' + 'Restore"]';
    const removedRestoreResponseSchema = 'GetFileLibrary' + 'RestoreResponse';
    const routeKindRestore = routeKindMap.fileLibraryRestore;
    const routeKindActiveOperation = routeKindMap.fileLibraryActiveOperation;

    expect(routeKindRestore?.path).toBe(restorePath);
    expect(routeKindRestore?.method).toBe('post');
    expect(routeKindRestore?.methods).toBeUndefined();
    expect(routeKindActiveOperation?.path).toBe(activeOperationPath);
    expect(routeKindActiveOperation?.method).toBe('get');

    const openApi = JSON.parse(readFileSync('docs/contracts/specs/openapi.json', 'utf8')) as {
      paths?: Record<string, Record<string, unknown>>;
    };
    expect(openApi.paths?.[restorePath]).not.toHaveProperty('get');
    expect(openApi.paths?.[restorePath]).toHaveProperty('post');
    expect(openApi.paths?.[activeOperationPath]).toHaveProperty('get');

    const generatedTypes = readFileSync('src/lib/api/types.generated.ts', 'utf8');
    const generatedRestoreSlice = generatedTypes.slice(
      generatedTypes.indexOf(`"${restorePath}"`),
      generatedTypes.indexOf('"/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/runtime-access/release"'),
    );
    expect(generatedRestoreSlice).not.toContain(removedRestoreGetOperation);
    expect(generatedRestoreSlice).toContain('post: operations["createFileLibraryRestore"]');
    expect(generatedTypes).toContain(`"${activeOperationPath}"`);
    expect(generatedTypes).toContain('get: operations["getActiveFileLibraryVersionOperation"]');
    expect(generatedTypes).not.toContain(removedRestoreResponseSchema);
  });
});
