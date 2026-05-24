import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(packageDir, '..', 'package.json');

describe('agent-runner-contract package metadata', () => {
  it('stays a standalone contract package without runtime implementation dependencies', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];

    expect(packageJson.name).toBe('@mbos/agent-runner-contract');
    expect(dependencyNames).not.toEqual(expect.arrayContaining([
      '@mbos/api-entry-node',
      '@mbos/agent-task-runner',
      '@mbos/agent-runner',
    ]));
  });
});
