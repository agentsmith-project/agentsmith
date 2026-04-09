import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatSessionWorkspaceManager, isChatConversationContinuation } from './session-workdir.js';

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function makeRootDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-runner-workdir-test-'));
  createdRoots.push(root);
  return root;
}

describe('chat session workdir manager', () => {
  it('treats multiple user turns as a continuation conversation', () => {
    expect(isChatConversationContinuation(undefined)).toBe(false);
    expect(isChatConversationContinuation([{ role: 'user', content: 'hello' }])).toBe(false);
    expect(isChatConversationContinuation([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'follow up' },
    ])).toBe(true);
  });

  it('marks a missing continuation workspace as recreated', async () => {
    const rootDir = await makeRootDir();
    const manager = new ChatSessionWorkspaceManager({ rootDir, janitorIntervalMs: 0 });
    try {
      const first = await manager.ensureSessionWorkspace('sess alpha', false);
      expect(first.recreated).toBe(false);
      await expect(fs.stat(first.sessionDir)).resolves.toBeTruthy();

      await fs.rm(first.sessionDir, { recursive: true, force: true });

      const second = await manager.ensureSessionWorkspace('sess alpha', true);
      expect(second.recreated).toBe(true);
      await expect(fs.stat(second.sessionDir)).resolves.toBeTruthy();
    } finally {
      manager.close();
    }
  });

  it('reaps idle session workspaces after the configured ttl', async () => {
    let now = 1_000;
    const rootDir = await makeRootDir();
    const manager = new ChatSessionWorkspaceManager({
      rootDir,
      janitorIntervalMs: 0,
      idleTtlMs: 100,
      now: () => now,
    });
    try {
      const ensured = await manager.ensureSessionWorkspace('sess-beta', false);
      await expect(fs.stat(ensured.sessionDir)).resolves.toBeTruthy();

      now = 1_150;
      const removed = await manager.reapIdleSessionWorkspaces();
      expect(removed).toEqual(['sess-beta']);
      await expect(fs.stat(ensured.sessionDir)).rejects.toThrow();
    } finally {
      manager.close();
    }
  });
});
