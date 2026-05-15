import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const forbiddenTokens = [
  `/restore-${'preview'}`,
  `/restore-${'run'}`,
  `/restore-${'cancel'}`,
  `restore_${'preview'}_id`,
  `FILE_LIBRARY_RESTORE_${'PREVIEW'}`,
  `file_library_restore_${'preview'}`,
  `activeRestore${'Preview'}`,
];

const guardedFiles = [
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

describe('file-library direct restore static guard', () => {
  it('keeps active frontend, e2e, MSW, and smoke paths off the removed preview-first restore flow', () => {
    const offenders = guardedFiles.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return forbiddenTokens
        .filter((token) => text.includes(token))
        .map((token) => `${file}: ${token}`);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps focused e2e evidence that restore confirm does not create save points or call legacy routes', () => {
    const e2eSource = readFileSync('e2e/integration-files-user-stories.spec.ts', 'utf8');

    expect(e2eSource).toContain("request.method() === 'POST'");
    expect(e2eSource).toContain('/save-points');
    expect(e2eSource).toContain('/restore-');
    expect(e2eSource).toContain("restore_' + 'preview_id");
  });

  it('keeps active direct restore GET and POST covered by OpenAPI, generated types, and route-kind map', () => {
    const routeKindMap = JSON.parse(
      readFileSync('docs/contracts/specs/openapi-route-kind-map.json', 'utf8'),
    ) as Record<string, { path?: string; method?: string; methods?: string[] }>;
    const restorePath = '/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/restore';
    const routeKindRestore = routeKindMap.fileLibraryRestore;

    expect(routeKindRestore?.path).toBe(restorePath);
    expect(routeKindRestore?.method).toBeUndefined();
    expect(new Set(routeKindRestore?.methods ?? [])).toEqual(new Set(['get', 'post']));

    const openApi = JSON.parse(readFileSync('docs/contracts/specs/openapi.json', 'utf8')) as {
      paths?: Record<string, Record<string, unknown>>;
    };
    expect(openApi.paths?.[restorePath]).toHaveProperty('get');
    expect(openApi.paths?.[restorePath]).toHaveProperty('post');

    const generatedTypes = readFileSync('src/lib/api/types.generated.ts', 'utf8');
    const generatedRestoreSlice = generatedTypes.slice(
      generatedTypes.indexOf(`"${restorePath}"`),
      generatedTypes.indexOf('"/api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/runtime-access/release"'),
    );
    expect(generatedRestoreSlice).toContain('get: operations["getActiveFileLibraryRestore"]');
    expect(generatedRestoreSlice).toContain('post: operations["createFileLibraryRestore"]');
  });
});
