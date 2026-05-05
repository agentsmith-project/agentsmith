import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Agent task active frontend surface boundary', () => {
  it('does not expose retired notebook modules as active mock/type/component files', () => {
    const retiredPaths = [
      'src/lib/api/types/notebook.ts',
      'src/mocks/fixtures/notebook.ts',
      'src/mocks/doc-fixtures/notebook.ts',
      'src/components/agent-tasks/NotebookSseDebugPanel.tsx',
    ];

    for (const path of retiredPaths) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false);
    }
  });

  it('keeps active Agent task implementation files on Agent task naming', () => {
    const activeFiles = [
      'src/lib/api/types/index.ts',
      'src/lib/build-failure-explainability.ts',
      'src/lib/public-runtime-config.ts',
      'src/lib/query-keys.ts',
      'src/mocks/fixtures/index.ts',
      'src/mocks/handlers/tasks.ts',
      'src/components/agent-tasks/task-page/TaskPageContent.tsx',
      'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/loading.tsx',
      'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/error.tsx',
    ];

    for (const path of activeFiles) {
      const content = readProjectFile(path);
      expect(content, path).not.toMatch(/\b[Nn]otebook\b/);
      expect(content, path).not.toMatch(/notebook/);
    }
  });
});
