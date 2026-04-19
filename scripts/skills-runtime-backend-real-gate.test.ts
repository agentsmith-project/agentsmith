import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type GateGrepEntry = {
  specFile: string;
  label: string;
  lineNumber: number;
};

const GATE_SCRIPT_PATH = 'scripts/skills-runtime-backend-real-gate.sh';
const RUN_GREP_PATTERN = /^\s*run_grep\s+(\S+)\s+"([^"]*)"\s+\d+\s+\d+\s*$/;
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

describe('skills runtime backend-real gate', () => {
  it('keeps every grep label aligned with a real Playwright title in the target spec', async () => {
    const entries = await readGateEntries();

    expect(entries.length).toBeGreaterThan(0);

    const titleCache = new Map<string, string[]>();

    for (const entry of entries) {
      if (!titleCache.has(entry.specFile)) {
        titleCache.set(entry.specFile, await readPlaywrightTitles(entry.specFile));
      }

      const titles = titleCache.get(entry.specFile) ?? [];
      expect(
        titles,
        `${GATE_SCRIPT_PATH}:${entry.lineNumber} grep label drifted from ${entry.specFile}\nAvailable titles:\n${titles.join('\n')}`,
      ).toContain(entry.label);
    }
  });
});
