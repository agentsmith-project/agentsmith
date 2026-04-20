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
    'infra/deploy/demo/kind/config.yaml',
    'infra/flows/demo-rehearsal.env',
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

function runDemoRehearsalCommand(tempRoot: string, script: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        export ROOT_DIR="${tempRoot}"
        export HOME="${tempRoot}"
        export DEMO_REHEARSAL_ROOT="${tempRoot}/scenario"
        ${script}
      `,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      encoding: 'utf8',
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
  it('keeps demo rehearsal local registry host-port truth isolated at 5003', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-registry-port-'));
    try {
      stageDemoRehearsalFixture(tempRoot);

      const output = runDemoRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
          init_demo_rehearsal_env
          printf 'registry_host_port=%s\\n' "$(scenario_kind_registry_host_port)"
        `,
      );

      expect(output).toContain('registry_host_port=5003');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('seeds sandbox host-port truth to 29280 and renders a scenario-owned kind config', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-sandbox-port-'));
    try {
      stageDemoRehearsalFixture(tempRoot);

      runDemoRehearsalCommon(tempRoot);

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      const renderedKindConfig = path.join(tempRoot, 'scenario', 'config', 'kind-config.yaml');
      const kindConfig = readFileSync(renderedKindConfig, 'utf8');

      expect(readEnvValue(seededSiteEnv, 'SANDBOX_HOST_PORT')).toBe('29280');
      expect(kindConfig).toContain('name: agentsmith-demo');
      expect(kindConfig).toContain('hostPort: 29280');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

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

  it('hydrates a fresh rehearsal site env with MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN without mutating the tracked example', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-proxy-token-'));
    try {
      stageDemoRehearsalFixture(tempRoot);

      runDemoRehearsalCommon(tempRoot);
      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      const exampleSiteEnv = path.join(tempRoot, 'infra', 'deploy', 'demo', 'env', 'site.env.example');
      const firstToken = readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');

      runDemoRehearsalCommon(tempRoot);
      const secondToken = readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');

      expect(firstToken).not.toBe('');
      expect(secondToken).toBe(firstToken);
      expect(readEnvValue(exampleSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN')).toBe('');
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

  it('preserves an explicit rehearsal MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN instead of replacing it', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-proxy-token-explicit-'));
    try {
      stageDemoRehearsalFixture(tempRoot);

      runDemoRehearsalCommon(
        tempRoot,
        'printf \'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=site-proxy-token\\n\' > "${DEMO_REHEARSAL_CONFIG_DIR}/site.env"',
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      expect(readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN')).toBe('site-proxy-token');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('passes release bundle fast-path env to the demo bundle builder only when the rehearsal fast-path flag is enabled', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-archive-flag-'));
    try {
      stageDemoRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, 'scripts', 'demo-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, 'scripts', 'demo-deploy', 'build-offline-bundle.sh'),
        `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "\${OUT_DIR}"
printf 'SKIP_RELEASE_ARCHIVE=%s\\n' "\${SKIP_RELEASE_ARCHIVE:-}" > "\${OUT_DIR}/builder.env"
printf 'SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=%s\\n' "\${SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION:-}" >> "\${OUT_DIR}/builder.env"
mkdir -p "\${OUT_DIR}/agentsmith-\${RELEASE_ID}"
`,
        'utf8',
      );

      const withFastPath = runDemoRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
          init_demo_rehearsal_env
          ensure_demo_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
          printf 'release_root=%s\\n' "\${RELEASE_ROOT}"
        `,
        { DEMO_REHEARSAL_SKIP_RELEASE_ARCHIVE: '1', DEMO_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD: '1' },
      );

      const withExplicitArchiveOverride = runDemoRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
          init_demo_rehearsal_env
          rm -f "${tempRoot}/scenario/releases/builder.env"
          ensure_demo_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
        `,
        { SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1' },
      );

      const withoutFastPath = runDemoRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
          init_demo_rehearsal_env
          rm -f "${tempRoot}/scenario/releases/builder.env"
          ensure_demo_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
        `,
      );

      expect(withFastPath).toContain('SKIP_RELEASE_ARCHIVE=1');
      expect(withFastPath).toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1');
      expect(withFastPath).toContain(`release_root=${path.join(tempRoot, 'scenario', 'releases', 'agentsmith-')}`);
      expect(withExplicitArchiveOverride).toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1');
      expect(withoutFastPath).toContain('SKIP_RELEASE_ARCHIVE=');
      expect(withoutFastPath).not.toContain('SKIP_RELEASE_ARCHIVE=1');
      expect(withoutFastPath).toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=');
      expect(withoutFastPath).not.toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('copies scenario-owned site.env truth into the generated release root after bundle creation', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-release-site-env-'));
    try {
      stageDemoRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, 'scripts', 'demo-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, 'scripts', 'demo-deploy', 'build-offline-bundle.sh'),
        `#!/usr/bin/env bash
set -euo pipefail
release_root="\${OUT_DIR}/agentsmith-\${RELEASE_ID}"
mkdir -p "\${release_root}/env"
printf 'SANDBOX_HOST_PORT=29180\\n' > "\${release_root}/env/site.env.example"
`,
        'utf8',
      );

      const output = runDemoRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
          init_demo_rehearsal_env
          ensure_demo_rehearsal_site_env
          ensure_demo_rehearsal_release_bundle
          printf 'release_site_env=%s\\n' "\${RELEASE_ROOT}/env/site.env"
          cat "\${RELEASE_ROOT}/env/site.env"
        `,
      );

      expect(output).toContain(`release_site_env=${path.join(tempRoot, 'scenario', 'releases', 'agentsmith-')}`);
      expect(output).toContain('SANDBOX_HOST_PORT=29280');
      expect(output).not.toContain('SANDBOX_HOST_PORT=29180');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('exports SKIP_BUNDLED_IMAGE_LOAD=1 only when the demo rehearsal fast-path flag is enabled', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-image-load-flag-'));
    try {
      stageDemoRehearsalFixture(tempRoot);

      const withFastPath = runDemoRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
          init_demo_rehearsal_env
          printf 'skip=%s\\n' "\${SKIP_BUNDLED_IMAGE_LOAD:-}"
        `,
        { DEMO_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD: '1' },
      );

      const withoutFastPath = runDemoRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
          init_demo_rehearsal_env
          printf 'skip=%s\\n' "\${SKIP_BUNDLED_IMAGE_LOAD:-}"
        `,
      );

      expect(withFastPath).toContain('skip=1');
      expect(withoutFastPath).toContain('skip=');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
