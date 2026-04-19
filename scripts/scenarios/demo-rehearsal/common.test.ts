import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function stageDemoRehearsalFixture(tempRoot: string): void {
  for (const relativePath of [
    'scripts/scenarios/demo-rehearsal/common.sh',
    'scripts/scenarios/common.sh',
    'scripts/lib/preset-common.sh',
    'scripts/lib/local-kind-world.sh',
    'infra/deploy/demo/env/site.env.example',
  ]) {
    const sourcePath = path.join(repoRoot, relativePath);
    const targetPath = path.join(tempRoot, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}

function runDemoRehearsalCommon(tempRoot: string, extraScript = ''): void {
  execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        export ROOT_DIR="${tempRoot}"
        export HOME="${tempRoot}"
        export DEMO_REHEARSAL_ROOT="${tempRoot}/scenario"
        source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
        init_demo_rehearsal_env
        ${extraScript}
        ensure_demo_rehearsal_site_env
      `,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: 'pipe',
    },
  );
}

function readEnvValue(filePath: string, key: string): string {
  for (const rawLine of readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.startsWith(`${key}=`)) {
      continue;
    }
    return line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

describe('demo-rehearsal site env seeding', () => {
  it('hydrates a fresh rehearsal site env with PRESET_ENDPOINT_API_KEY from .env.backend-real without mutating the tracked example', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-common-'));
    try {
      stageDemoRehearsalFixture(tempRoot);
      writeFileSync(path.join(tempRoot, '.env.backend-real'), 'PRESET_ENDPOINT_API_KEY=runtime-demo-secret\n', 'utf8');

      runDemoRehearsalCommon(tempRoot);

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      const exampleSiteEnv = path.join(tempRoot, 'infra', 'deploy', 'demo', 'env', 'site.env.example');
      expect(readEnvValue(seededSiteEnv, 'PRESET_ENDPOINT_API_KEY')).toBe('runtime-demo-secret');
      expect(readEnvValue(exampleSiteEnv, 'PRESET_ENDPOINT_API_KEY')).toBe('');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preserves an explicit rehearsal PRESET_ENDPOINT_API_KEY instead of overwriting it from .env.backend-real', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-common-explicit-'));
    try {
      stageDemoRehearsalFixture(tempRoot);
      writeFileSync(path.join(tempRoot, '.env.backend-real'), 'PRESET_ENDPOINT_API_KEY=runtime-demo-secret\n', 'utf8');

      runDemoRehearsalCommon(
        tempRoot,
        'printf \'PRESET_ENDPOINT_API_KEY=site-env-secret\\n\' > "${DEMO_REHEARSAL_CONFIG_DIR}/site.env"',
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      expect(readEnvValue(seededSiteEnv, 'PRESET_ENDPOINT_API_KEY')).toBe('site-env-secret');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
