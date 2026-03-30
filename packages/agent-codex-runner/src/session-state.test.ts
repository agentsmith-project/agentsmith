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
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogSignature: '{"input_modalities":["text"]}',
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
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogSignature: '{"input_modalities":["text"]}',
    });
    await writeFile(join(codexDir, 'state_5.sqlite'), 'keep');
    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      model: 'glm-5-turbo',
      wireApi: 'responses',
      resourceProxyBase: 'http://proxy-a',
      notebookMode: true,
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogSignature: '{"input_modalities":["text"]}',
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
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogSignature: '{"input_modalities":["text"]}',
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
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogSignature: '{"input_modalities":["text"]}',
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed' });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'state_5.sqlite')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'sessions')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'tmp')))).rejects.toBeTruthy();
  });

  it('resets persisted session files when model window changes', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      model: 'glm-5-turbo',
      wireApi: 'responses',
      resourceProxyBase: 'http://proxy-a',
      notebookMode: true,
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
    });
    await writeFile(join(codexDir, 'state_5.sqlite'), 'stale');

    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      model: 'glm-5-turbo',
      wireApi: 'responses',
      resourceProxyBase: 'http://proxy-a',
      notebookMode: true,
      modelContextWindow: 256000,
      modelAutoCompactTokenLimit: 243200,
      modelCatalogSignature: '{"input_modalities":["text"]}',
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed' });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'state_5.sqlite')))).rejects.toBeTruthy();
  });


  it('resets only the changed task-scoped codex directory', async () => {
    const codexDirA = await createCodexDir();
    const codexDirB = await createCodexDir();
    const baseInput = {
      model: 'glm-5-codex',
      wireApi: 'responses' as const,
      resourceProxyBase: 'http://proxy-a',
      notebookMode: true,
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogSignature: '{"input_modalities":["text"]}',
    };

    await ensureCodexSessionStateCompatible({ codexDir: codexDirA, ...baseInput });
    await ensureCodexSessionStateCompatible({ codexDir: codexDirB, ...baseInput });
    await writeFile(join(codexDirA, 'state_5.sqlite'), 'stale-a');
    await writeFile(join(codexDirB, 'state_5.sqlite'), 'keep-b');

    const result = await ensureCodexSessionStateCompatible({
      codexDir: codexDirA,
      ...baseInput,
      modelCatalogSignature: '{"input_modalities":["text","image"]}',
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed' });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDirA, 'state_5.sqlite')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ readFile }) => readFile(join(codexDirB, 'state_5.sqlite'), 'utf8'))).resolves.toBe('keep-b');
  });

  it('resets persisted session files when model catalog signature changes', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      model: 'glm-5-turbo',
      wireApi: 'responses',
      resourceProxyBase: 'http://proxy-a',
      notebookMode: true,
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogSignature: '{"input_modalities":["text"],"supports_search_tool":false}',
    });
    await writeFile(join(codexDir, 'state_5.sqlite'), 'stale');

    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      model: 'glm-5-turbo',
      wireApi: 'responses',
      resourceProxyBase: 'http://proxy-a',
      notebookMode: true,
      modelContextWindow: 128000,
      modelAutoCompactTokenLimit: 121600,
      modelCatalogSignature: '{"input_modalities":["text","image"],"supports_search_tool":false}',
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed' });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'state_5.sqlite')))).rejects.toBeTruthy();
  });
});
