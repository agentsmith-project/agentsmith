import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const SCAN_TARGETS = ['src'];

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.css',
  '.yml',
  '.yaml',
]);

function collectFiles(targetPath: string): string[] {
  const absolutePath = path.resolve(ROOT, targetPath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [absolutePath];

  const files: string[] = [];
  const stack = [absolutePath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
        stack.push(full);
        continue;
      }
      if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
  }
  return files;
}

describe('limit terminology boundary guard', () => {
  it('keeps quota naming out of core source', () => {
    const files = SCAN_TARGETS.flatMap(collectFiles);
    const violations: string[] = [];

    for (const filePath of files) {
      if (filePath.endsWith('limit-terminology-boundary.test.ts')) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      if (/\bquota\b/i.test(content)) {
        violations.push(path.relative(ROOT, filePath));
      }
    }

    expect(violations).toEqual([]);
  });
});
