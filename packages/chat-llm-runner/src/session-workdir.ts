import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_IDLE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_JANITOR_INTERVAL_MS = 60 * 1000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function isChatConversationContinuation(
  messages: Array<{ role?: string; content?: unknown }> | undefined,
): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  let userTurnCount = 0;
  for (const message of messages) {
    if (message?.role === 'user') {
      userTurnCount += 1;
      if (userTurnCount > 1) return true;
    }
  }
  return false;
}

export interface ChatSessionWorkspaceManagerOptions {
  rootDir?: string;
  idleTtlMs?: number;
  janitorIntervalMs?: number;
  now?: () => number;
}

export class ChatSessionWorkspaceManager {
  readonly rootDir: string;

  private readonly idleTtlMs: number;
  private readonly now: () => number;
  private readonly lastTouchedAtBySession = new Map<string, number>();
  private readonly janitorTimer?: NodeJS.Timeout;

  constructor(options: ChatSessionWorkspaceManagerOptions = {}) {
    const configuredRootDir = options.rootDir?.trim() || process.env.MBOS_CHAT_SESSION_ROOT?.trim();
    this.rootDir = configuredRootDir && configuredRootDir.length > 0
      ? configuredRootDir
      : path.join(os.tmpdir(), 'mbos-chat-sessions');
    this.idleTtlMs = options.idleTtlMs ?? parsePositiveInt(process.env.MBOS_CHAT_SESSION_IDLE_TTL_MS, DEFAULT_IDLE_TTL_MS);
    const janitorIntervalMs = options.janitorIntervalMs ?? parsePositiveInt(
      process.env.MBOS_CHAT_SESSION_JANITOR_INTERVAL_MS,
      DEFAULT_JANITOR_INTERVAL_MS,
    );
    this.now = options.now ?? (() => Date.now());
    if (janitorIntervalMs > 0) {
      this.janitorTimer = setInterval(() => {
        void this.reapIdleSessionWorkspaces();
      }, janitorIntervalMs);
      this.janitorTimer.unref?.();
    }
  }

  private getSessionDir(sessionId: string): string {
    return path.join(this.rootDir, encodeURIComponent(sessionId));
  }

  async ensureSessionWorkspace(sessionId: string, isContinuation: boolean): Promise<{ sessionDir: string; recreated: boolean }> {
    await fs.mkdir(this.rootDir, { recursive: true });
    const sessionDir = this.getSessionDir(sessionId);
    const existed = await pathExists(sessionDir);
    if (!existed) {
      await fs.mkdir(sessionDir, { recursive: true });
    }
    this.lastTouchedAtBySession.set(sessionId, this.now());
    return {
      sessionDir,
      recreated: isContinuation && !existed,
    };
  }

  async reapIdleSessionWorkspaces(referenceTime: number = this.now()): Promise<string[]> {
    const removedSessionIds: string[] = [];
    for (const [sessionId, lastTouchedAt] of this.lastTouchedAtBySession.entries()) {
      if (referenceTime - lastTouchedAt < this.idleTtlMs) continue;
      await fs.rm(this.getSessionDir(sessionId), { recursive: true, force: true });
      this.lastTouchedAtBySession.delete(sessionId);
      removedSessionIds.push(sessionId);
    }
    return removedSessionIds;
  }

  close(): void {
    if (this.janitorTimer) {
      clearInterval(this.janitorTimer);
    }
  }
}
