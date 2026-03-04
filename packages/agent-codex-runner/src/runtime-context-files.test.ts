import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyRuntimeContextFiles } from './runtime-context-files.js';

describe('runtime-context-files', () => {
  it('writes files to relative paths under cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'runner-runtime-files-'));
    const result = await applyRuntimeContextFiles(cwd, [
      {
        relative_path: '.codex/credential/jira/connections.json',
        content: '{"ok":true}',
      },
      {
        relative_path: '.codex/credential/index.json',
        content: '{"files":[]}',
      },
    ]);

    expect(result.written).toBe(2);
    expect(result.totalBytes).toBeGreaterThan(0);
    const payload = await readFile(join(cwd, '.codex/credential/jira/connections.json'), 'utf-8');
    expect(payload).toContain('"ok":true');
  });

  it('rejects path traversal', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'runner-runtime-files-'));
    await expect(
      applyRuntimeContextFiles(cwd, [
        {
          relative_path: '../outside.txt',
          content: 'x',
        },
      ]),
    ).rejects.toThrow(/runtime_file_path_outside_workspace|runtime_file_path_escape_detected/);
  });
});
