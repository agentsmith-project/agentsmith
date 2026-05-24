import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(packageDir, '..', 'package.json');
const repoRoot = join(packageDir, '..', '..', '..');
const runnerDockerfilePath = join(repoRoot, 'infra', 'runner', 'Dockerfile.agent-task-runner');
const runnerBaseDockerfilePath = join(repoRoot, 'infra', 'runner', 'Dockerfile.agent-task-runner-base');

describe('agent-task-runner package metadata', () => {
  it('declares the canonical agent task runner package name and framework dependency', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: string;
      dependencies?: Record<string, string>;
    };

    expect(packageJson.name).toBe('@mbos/agent-task-runner');
    expect(packageJson.dependencies?.['@mbos/agent-runner']).toBe('0.1.0');
    expect(packageJson.dependencies?.['@mbos/agent-runner-contract']).toBe('0.1.0');
  });

  it('keeps the managed runner image on the built single-process Node entrypoint', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      main?: string;
      scripts?: Record<string, string>;
    };
    const runnerDockerfile = readFileSync(runnerDockerfilePath, 'utf8');
    const runnerBaseDockerfile = readFileSync(runnerBaseDockerfilePath, 'utf8');
    const combinedDockerfiles = `${runnerBaseDockerfile}\n${runnerDockerfile}`;

    expect(packageJson.main).toBe('dist/index.js');
    expect(packageJson.scripts?.build).toContain('esbuild src/index.ts');
    expect(packageJson.scripts?.build).toContain('--outfile=dist/index.js');
    expect(packageJson.scripts?.start).toBe('node dist/index.js');
    expect(packageJson.scripts?.start).not.toMatch(/\btsx\b|src\/index\.ts|\bnpm\b|\bdev\b/u);

    expect(runnerDockerfile).toContain('npm run build -w @mbos/agent-task-runner');
    expect(runnerBaseDockerfile).toContain('exec node packages/agent-task-runner/dist/index.js "$@"');
    expect(combinedDockerfiles).not.toMatch(/npm run dev -w @mbos\/agent-task-runner|tsx src\/index\.ts/u);
  });
});
