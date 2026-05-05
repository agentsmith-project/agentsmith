import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureCodexSessionStateCompatible,
  markCodexSessionStateReusable,
} from './session-state.js';

const tempDirs: string[] = [];
const baseInput = {
  taskId: 'task_alpha',
  model: 'placeholder-model',
  wireApi: 'openai_responses' as const,
  resourceProxyBase: 'http://proxy-a',
  modelContextWindow: 128000,
  modelMaxOutputTokens: 6400,
  modelAutoCompactTokenLimit: 121600,
  modelCatalogSignature: '{"input_modalities":["text"]}',
};

async function createCodexDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'runner-session-state-'));
  tempDirs.push(dir);
  const codexDir = join(dir, '.codex');
  await mkdir(codexDir, { recursive: true });
  return codexDir;
}

async function seedReusableCodexState(codexDir: string): Promise<void> {
  await mkdir(join(codexDir, 'sessions'), { recursive: true });
  await writeFile(join(codexDir, 'sessions', 'last.jsonl'), '{"type":"assistant"}\n');
  await writeFile(join(codexDir, 'state_5.sqlite'), 'state');
  await writeFile(join(codexDir, 'logs_5.sqlite'), 'logs');
}

describe('ensureCodexSessionStateCompatible', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))));
  });

  it('writes initial fingerprint and requires a fresh exec for a task without reusable local codex state', async () => {
    const codexDir = await createCodexDir();
    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });
    const legacyInteractionKindKey = ['interaction', 'kind'].join('_');
    const fingerprint = JSON.parse(await readFile(join(codexDir, '.codex-session-fingerprint.json'), 'utf8')) as {
      model_max_output_tokens?: unknown;
    } & Record<string, unknown>;
    expect(fingerprint.model_max_output_tokens).toBe(6400);
    expect(fingerprint.wire_api).toBe('openai_responses');
    expect(fingerprint[legacyInteractionKindKey]).toBeUndefined();
    expect(result).toEqual({ resetPerformed: false, reason: 'missing', resumeAllowed: false });
  });

  it('keeps same-task codex state and allows resume only after reusable local state is explicitly marked', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });
    await seedReusableCodexState(codexDir);
    await markCodexSessionStateReusable({ codexDir, taskId: baseInput.taskId });
    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });
    expect(result).toEqual({ resetPerformed: false, reason: 'unchanged', resumeAllowed: true });
    await expect(import('node:fs/promises').then(({ readFile }) => readFile(join(codexDir, 'state_5.sqlite'), 'utf8'))).resolves.toBe('state');
  });

  it('uses a fresh exec when fingerprint is unchanged but no reusable local codex state exists yet', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });

    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });

    expect(result).toEqual({ resetPerformed: false, reason: 'unchanged', resumeAllowed: false });
  });

  it('resets stale local codex state when fingerprint matches but ownership was never marked for this task', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });
    await seedReusableCodexState(codexDir);

    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed', resumeAllowed: false });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'state_5.sqlite')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'logs_5.sqlite')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'sessions')))).rejects.toBeTruthy();
  });

  it('resets stale local codex state when it was marked for a different task', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });
    await seedReusableCodexState(codexDir);
    await markCodexSessionStateReusable({ codexDir, taskId: 'task_other' });

    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed', resumeAllowed: false });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'state_5.sqlite')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'sessions')))).rejects.toBeTruthy();
  });

  it('resets persisted codex session files when fingerprint changes', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });
    await seedReusableCodexState(codexDir);
    await writeFile(join(codexDir, 'state_5.sqlite-wal'), 'stale');
    await mkdir(join(codexDir, 'tmp'), { recursive: true });
    await writeFile(join(codexDir, 'tmp', 'old.tmp'), 'stale');
    await markCodexSessionStateReusable({ codexDir, taskId: baseInput.taskId });

    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
      resourceProxyBase: 'http://proxy-b',
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed', resumeAllowed: false });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'state_5.sqlite')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'logs_5.sqlite')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'sessions')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'tmp')))).rejects.toBeTruthy();
  });

  it('resets persisted session files when model window changes', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });
    await seedReusableCodexState(codexDir);
    await markCodexSessionStateReusable({ codexDir, taskId: baseInput.taskId });

    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
      modelContextWindow: 256000,
      modelAutoCompactTokenLimit: 243200,
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed', resumeAllowed: false });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'state_5.sqlite')))).rejects.toBeTruthy();
  });

  it('resets persisted session files when model max output limit changes', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
    });
    await seedReusableCodexState(codexDir);
    await markCodexSessionStateReusable({ codexDir, taskId: baseInput.taskId });

    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
      modelMaxOutputTokens: 32000,
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed', resumeAllowed: false });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'state_5.sqlite')))).rejects.toBeTruthy();
  });

  it('resets only the changed task-scoped codex directory', async () => {
    const codexDirA = await createCodexDir();
    const codexDirB = await createCodexDir();

    await ensureCodexSessionStateCompatible({ codexDir: codexDirA, ...baseInput });
    await ensureCodexSessionStateCompatible({ codexDir: codexDirB, ...baseInput });
    await seedReusableCodexState(codexDirA);
    await seedReusableCodexState(codexDirB);
    await markCodexSessionStateReusable({ codexDir: codexDirA, taskId: baseInput.taskId });
    await markCodexSessionStateReusable({ codexDir: codexDirB, taskId: baseInput.taskId });

    const result = await ensureCodexSessionStateCompatible({
      codexDir: codexDirA,
      ...baseInput,
      modelCatalogSignature: '{"input_modalities":["text","image"]}',
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed', resumeAllowed: false });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDirA, 'state_5.sqlite')))).rejects.toBeTruthy();
    await expect(import('node:fs/promises').then(({ readFile }) => readFile(join(codexDirB, 'state_5.sqlite'), 'utf8'))).resolves.toBe('state');
  });

  it('resets persisted session files when model catalog signature changes', async () => {
    const codexDir = await createCodexDir();
    await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
      modelCatalogSignature: '{"input_modalities":["text"],"supports_search_tool":false}',
    });
    await seedReusableCodexState(codexDir);
    await markCodexSessionStateReusable({ codexDir, taskId: baseInput.taskId });

    const result = await ensureCodexSessionStateCompatible({
      codexDir,
      ...baseInput,
      modelCatalogSignature: '{"input_modalities":["text","image"],"supports_search_tool":false}',
    });

    expect(result).toEqual({ resetPerformed: true, reason: 'changed', resumeAllowed: false });
    await expect(import('node:fs/promises').then(({ access }) => access(join(codexDir, 'state_5.sqlite')))).rejects.toBeTruthy();
  });
});
