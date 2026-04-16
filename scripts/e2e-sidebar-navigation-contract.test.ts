import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function collectE2ESpecs(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectE2ESpecs(entryPath);
      }
      if (entry.name.endsWith('.spec.ts')) {
        return [entryPath];
      }
      return [];
    }),
  );
  return files.flat();
}

function lineHasDirectSidebarClick(line: string) {
  return /getByTestId\(\s*['"`]sidebar__nav-item--[^'"`]+['"`]\s*\)\.click\(/.test(line);
}

function lineHasDefaultUrlAssertion(line: string) {
  return /\.toHaveURL\(/.test(line) && !line.includes('timeout:');
}

describe('e2e sidebar navigation contract', () => {
  it('routes sidebar user-story navigation through the shared helper before URL assertions', async () => {
    const e2eRoot = path.resolve(process.cwd(), 'e2e');
    const specs = await collectE2ESpecs(e2eRoot);
    const violations: string[] = [];

    for (const spec of specs) {
      const source = await readFile(spec, 'utf-8');
      const lines = source.split(/\r?\n/);

      lines.forEach((line, index) => {
        if (!lineHasDirectSidebarClick(line)) {
          return;
        }

        const followingLines = lines.slice(index + 1, index + 5);
        const hasFragileUrlAssertion = followingLines.some(lineHasDefaultUrlAssertion);
        if (!hasFragileUrlAssertion) {
          return;
        }

        violations.push(`${path.relative(process.cwd(), spec)}:${index + 1}`);
      });
    }

    expect(violations).toEqual([]);
  });
});
