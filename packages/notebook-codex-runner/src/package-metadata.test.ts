import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(packageDir, '..', 'package.json');

describe('notebook-codex-runner package metadata', () => {
  it('declares the canonical notebook runner package name and framework dependency', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: string;
      dependencies?: Record<string, string>;
    };

    expect(packageJson.name).toBe('@mbos/notebook-codex-runner');
    expect(packageJson.dependencies?.['@mbos/agent-runner']).toBe('0.1.0');
  });
});
