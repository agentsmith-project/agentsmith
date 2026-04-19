import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function readPlaywrightConfig(): string {
  return readFileSync('playwright.config.ts', 'utf8');
}

function extractDefaultE2ESpecMatchBlock(source: string): string {
  const match = source.match(/const defaultE2ESpecMatch = \[([\s\S]*?)\];/);
  if (!match) {
    throw new Error('defaultE2ESpecMatch block was not found in playwright.config.ts');
  }
  return match[1];
}

function parseRegexLiterals(block: string): RegExp[] {
  return Array.from(block.matchAll(/\/((?:\\\/|[^/])+)\/([dgimsuvy]*)/g), ([, pattern, flags]) => new RegExp(pattern, flags));
}

function matchesAllowlist(specPath: string, allowlist: RegExp[]): boolean {
  return allowlist.some((pattern) => pattern.test(specPath));
}

describe('playwright default mock chromium allowlist', () => {
  it('keeps project overview coverage in the default chromium mock lane', () => {
    const allowlist = parseRegexLiterals(extractDefaultE2ESpecMatchBlock(readPlaywrightConfig()));

    expect(matchesAllowlist('e2e/overview.spec.ts', allowlist)).toBe(true);
    expect(matchesAllowlist('e2e/workspace-overview.spec.ts', allowlist)).toBe(true);
  });
});
