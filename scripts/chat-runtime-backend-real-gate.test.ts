import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type GateGrepEntry = {
  sourcePath: string;
  specFile: string;
  label: string;
  lineNumber: number;
};

const GATE_SCRIPT_PATH = 'scripts/chat-runtime-backend-real-gate.sh';
const SESSION_RUNNER_SCRIPT_PATH = 'scripts/run-integration-e2e-full.sh';
const RUN_GREP_PATTERN = /^\s*run_grep\s+(\S+)\s+"([^"]*)"\s+\d+\s+\d+\s*$/;
const SESSION_GREP_PATTERN = /^\s*run_playwright_shard\s+"(chat-[^"]+)"\s+"([^"]+)"\s+--grep\s+"([^"]+)"(?:\s+\|\|.*)?$/;
const PLAYWRIGHT_TEST_TITLE_PATTERN = /\btest(?:\.(?:only|skip|fixme|fail))?\(\s*(['"`])([\s\S]*?)\1\s*,/g;

async function readGateEntries(): Promise<GateGrepEntry[]> {
  const source = await readFile(path.resolve(process.cwd(), GATE_SCRIPT_PATH), 'utf-8');
  const entries: GateGrepEntry[] = [];

  for (const [index, line] of source.split('\n').entries()) {
    const match = line.match(RUN_GREP_PATTERN);
    if (!match) {
      continue;
    }
    const [, specFile, label] = match;
    if (!label) {
      continue;
    }
    entries.push({
      sourcePath: GATE_SCRIPT_PATH,
      specFile,
      label,
      lineNumber: index + 1,
    });
  }

  return entries;
}

async function readChatSessionEntries(): Promise<GateGrepEntry[]> {
  const source = await readFile(path.resolve(process.cwd(), SESSION_RUNNER_SCRIPT_PATH), 'utf-8');
  const entries: GateGrepEntry[] = [];

  for (const [index, line] of source.split('\n').entries()) {
    const match = line.match(SESSION_GREP_PATTERN);
    if (!match) {
      continue;
    }
    const [, , specFile, label] = match;
    entries.push({
      sourcePath: SESSION_RUNNER_SCRIPT_PATH,
      specFile,
      label,
      lineNumber: index + 1,
    });
  }

  return entries;
}

async function readPlaywrightTitles(specFile: string): Promise<string[]> {
  const source = await readFile(path.resolve(process.cwd(), specFile), 'utf-8');
  return Array.from(source.matchAll(PLAYWRIGHT_TEST_TITLE_PATTERN), (match) => match[2]);
}

describe('chat runtime backend-real gate', () => {
  it('routes external chat greps through one dedicated session and keeps internal lanes independent', async () => {
    const source = await readFile(path.resolve(process.cwd(), GATE_SCRIPT_PATH), 'utf-8');

    expect(source.match(/--session\s+chat-backend-real-runner/g) ?? []).toHaveLength(1);
    expect(source).not.toContain(
      'run_grep e2e/integration-chat-llm-runner.spec.ts "streams multi-turn chat through the real local chat runner and persists replies"',
    );
    expect(source).not.toContain(
      'run_grep e2e/integration-chat-llm-runner.spec.ts "preserves conversation continuity across refresh with story-bound trace evidence"',
    );
    expect(source).not.toContain(
      'run_grep e2e/integration-chat-llm-runner.spec.ts "warns and recreates the session workspace when the local chat workspace has been reclaimed"',
    );
    expect(source).not.toContain(
      'run_grep e2e/integration-chat.spec.ts "stop escalation resyncs authoritative thread truth after refresh and keeps composer ready"',
    );
    expect(source).toContain('(cd "${ROOT_DIR}" && bash scripts/run-internal-chat-real-gate.sh)');
    expect(source).toContain('run_grep e2e/integration-membership-chat-isolation.spec.ts "" 20065 3066');
  });

  it('keeps every grep label aligned with a real Playwright title in the target spec', async () => {
    const sessionEntries = await readChatSessionEntries();
    const entries = [
      ...(await readGateEntries()),
      ...sessionEntries,
    ];

    expect(entries.length).toBeGreaterThan(0);
    expect(sessionEntries).toHaveLength(4);

    const titleCache = new Map<string, string[]>();

    for (const entry of entries) {
      if (!titleCache.has(entry.specFile)) {
        titleCache.set(entry.specFile, await readPlaywrightTitles(entry.specFile));
      }

      const titles = titleCache.get(entry.specFile) ?? [];
      expect(
        titles,
        `${entry.sourcePath}:${entry.lineNumber} grep label drifted from ${entry.specFile}\nAvailable titles:\n${titles.join('\n')}`,
      ).toContain(entry.label);
    }
  });
});
