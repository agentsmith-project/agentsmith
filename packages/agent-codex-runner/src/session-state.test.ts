import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureCodexSessionStateCompatible } from './session-state.js';

const tempDirs: string[] = [];

async function createCodexDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'runner-session-state-'));
  tempDirs.push(dir);
  const codexDir = join(dir, '.codex');
  await mkdir(codexDir, { recursive: true });
  return codexDir;
}

describe('ensureCodexSessionStateCompatible', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))));
  });

  it('writes initial fingerprint without resetting state', async () => {
    const codexDir = await createCodexDir();
    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      model: 'glm-5-turbo',
      wireApi: 'responses',
      resourceProxyBase: 'http://proxy-a',
      notebookMode: true,
    });
    expect(result).toEqual({ resetPerformed: false, reason: 'missing' });
  });

  it('keeps existing session state when fingerprint is unchanged', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      model: 'glm-5-turbo',
      wireApi: 'responses',
      resourceProxyBase: 'http://proxy-a',
      notebookMode: true,
    });
    await writeFile(join(codexDir, 'state_5.sqlite'), 'keep');
    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      model: 'glm-5-turbo',
      wireApi: 'responses',
      resourceProxyBase: 'http://proxy-a',
      notebookMode: true,
    });
    expect(result).toEqual({ resetPerformed: false, reason: 'unchanged' });
    await expect(import('node:fs/promises').then(({ readFile }) => readFile(join(codexDir, 'state_5.sqlite'), 'utf8'))).resolves.toBe('keep');
  });

  it('resets persisted codex session files when fingerprint changes', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      model: 'glm-5-turbo',
      wireApi: 'responses',
      resourceProxyBase: 'http://proxy-a',
      notebookMode: true,
    });
    await writeFile(join(codexDir, 'state_5.sqlite'), 'stale');
    await writeFile(join(codexDir, 'state_5.sqlite-wal'), 'stale');
    await mkdir(join(codexDir, 'sessions'), { recursive: true });
    await writeFile(join(codexDir, 'sessions', 'old.jsonl'), 'stale');
    await mkdir(join(codexDir, 'tmp'), { recursive: true });
    await writeFile(join(codexDir, 'tmp', 'old.tmp'), 'stale');

    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      model: 'glm-5-turbo',
      wireApi: 'responses',
      resourceProxyBase: 'http://proxy-b',
      notebookMode: true,
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed' });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'state_5.sqlite')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'sessions')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'tmp')))).rejects.toBeTruthy();
  });
});
