import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function stageDemoRehearsalFixture(tempRoot: string): void {
  for (const relativePath of [
    'scripts/scenarios/demo-rehearsal/common.sh',
    'scripts/scenarios/demo-rehearsal/status.sh',
    'scripts/scenarios/common.sh',
    'scripts/lib/preset-common.sh',
    'scripts/lib/local-kind-world.sh',
    'scripts/governance/current-rehearsal-world-health-schema.ts',
    'scripts/governance/rehearsal-world-health.ts',
    'scripts/governance/redaction.ts',
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

function expectDemoRehearsalCommandFailure(
  tempRoot: string,
  script: string,
  extraEnv: NodeJS.ProcessEnv = {},
): string {
  let failure: (Error & { stderr?: Buffer | string }) | undefined;
  try {
    runDemoRehearsalCommand(tempRoot, script, extraEnv);
  } catch (error) {
    failure = error as Error & { stderr?: Buffer | string };
  }

  expect(failure).toBeDefined();
  return String(failure?.stderr ?? failure?.message ?? '');
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
  it('renders status.sh as a read-only world health snapshot without skip or verdict semantics', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-status-health-'));
    try {
      stageDemoRehearsalFixture(tempRoot);

      const output = runDemoRehearsalCommand(
        tempRoot,
        `
          mkdir -p "${tempRoot}/scenario/state" "${tempRoot}/artifacts/runtime"
          printf '{"release":{"phase":"deploy_completed","id":"demo-status-release"}}\\n' > "${tempRoot}/scenario/state/deploy-state.json"
          printf 'demo-rehearsal\\n' > "${tempRoot}/artifacts/runtime/active-scenario.lock"
          bash "${tempRoot}/scripts/scenarios/demo-rehearsal/status.sh"
        `,
      );

      expect(output).toContain('AgentSmith Rehearsal World Health');
      expect(output).toContain('Runtime line: demo-rehearsal');
      expect(output).toContain('Health: degraded');
      expect(output).toContain('World:');
      expect(output).toContain('Public bases: web=http://localhost:33001');
      expect(output).toContain('Ports: web=33001; api=40000; keycloak=38080; sandbox=29280; registry=5003');
      expect(output).toContain('Safe reset level: world');
      expect(output).toContain('Safe next command: make demo-rehearsal-reset && npm run rehearse:demo');
      expect(output).toContain('Authority:');
      expect(output).toContain('Scenario detail:');
      expect(output).not.toContain('failure_class');
      expect(output).not.toContain('claim_id');
      expect(output).not.toContain('release_decision');
      expect(output).not.toContain('SKIP_RELEASE_ARCHIVE=1');
      expect(output).not.toContain('reuse');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

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

  it('seeds a scenario-owned host port range so release campaigns do not collide with backend-real dependencies', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-owned-ports-'));
    try {
      stageDemoRehearsalFixture(tempRoot);

      runDemoRehearsalCommon(tempRoot);

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      expect(readEnvValue(seededSiteEnv, 'POSTGRES_PORT')).toBe('35432');
      expect(readEnvValue(seededSiteEnv, 'MONGO_PORT')).toBe('37017');
      expect(readEnvValue(seededSiteEnv, 'REDIS_PORT')).toBe('36379');
      expect(readEnvValue(seededSiteEnv, 'MINIO_API_PORT')).toBe('39000');
      expect(readEnvValue(seededSiteEnv, 'MINIO_CONSOLE_PORT')).toBe('39001');
      expect(readEnvValue(seededSiteEnv, 'KEYCLOAK_PORT')).toBe('38080');
      expect(readEnvValue(seededSiteEnv, 'API_PORT')).toBe('40000');
      expect(readEnvValue(seededSiteEnv, 'WEB_PORT')).toBe('33001');
      expect(readEnvValue(seededSiteEnv, 'PUBLIC_WEB_BASE_URL')).toBe('http://localhost:33001');
      expect(readEnvValue(seededSiteEnv, 'PUBLIC_API_BASE_URL')).toBe('http://localhost:40000');
      expect(readEnvValue(seededSiteEnv, 'PUBLIC_KEYCLOAK_BASE_URL')).toBe('http://localhost:38080');
      expect(readEnvValue(seededSiteEnv, 'HOST_LOCAL_POSTGRES_PORT')).toBe('35432');
      expect(readEnvValue(seededSiteEnv, 'HOST_LOCAL_MINIO_ENDPOINT')).toBe('http://localhost:39000');
      expect(readEnvValue(seededSiteEnv, 'CLIENT_PUBLIC_POSTGRES_PORT')).toBe('35432');
      expect(readEnvValue(seededSiteEnv, 'CLIENT_PUBLIC_MINIO_ENDPOINT')).toBe('http://localhost:39000');
      expect(readEnvValue(seededSiteEnv, 'INTEGRATION_PUBLIC_WEB_BASES')).toBe(
        'http://localhost:33001,http://127.0.0.1:33001',
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('backfills missing current site env schema keys into a legacy rehearsal config without overwriting existing values', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-legacy-site-env-'));
    try {
      stageDemoRehearsalFixture(tempRoot);
      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      mkdirSync(path.dirname(seededSiteEnv), { recursive: true });
      writeFileSync(seededSiteEnv, 'PRESET_ENDPOINT_API_KEY=legacy-secret\n', 'utf8');

      runDemoRehearsalCommon(tempRoot);

      const siteEnvText = readFileSync(seededSiteEnv, 'utf8');
      expect(readEnvValue(seededSiteEnv, 'PRESET_ENDPOINT_API_KEY')).toBe('legacy-secret');
      expect(readEnvValue(seededSiteEnv, 'RUNTIME_PROXY_MODE')).toBe('sanitized');
      expect(siteEnvText).toContain('RUNTIME_HTTP_PROXY=');
      expect(siteEnvText).toContain('RUNTIME_HTTPS_PROXY=');
      expect(siteEnvText).toContain('RUNTIME_ALL_PROXY=');
      expect(readEnvValue(seededSiteEnv, 'SANDBOX_HOST_PORT')).toBe('29280');
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

  it('does not hydrate legacy MBOS_UNIVERSAL_PROXY_DATA_TOKEN into fresh rehearsal site env', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-proxy-data-token-'));
    try {
      stageDemoRehearsalFixture(tempRoot);

      runDemoRehearsalCommon(tempRoot);
      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      const exampleSiteEnv = path.join(tempRoot, 'infra', 'deploy', 'demo', 'env', 'site.env.example');

      runDemoRehearsalCommon(tempRoot);

      expect(readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_DATA_TOKEN')).toBe('');
      expect(readEnvValue(exampleSiteEnv, 'MBOS_UNIVERSAL_PROXY_DATA_TOKEN')).toBe('');
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

  it('preserves an explicit legacy MBOS_UNIVERSAL_PROXY_DATA_TOKEN without generating a replacement', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-proxy-data-token-explicit-'));
    try {
      stageDemoRehearsalFixture(tempRoot);

      runDemoRehearsalCommon(
        tempRoot,
        'printf \'MBOS_UNIVERSAL_PROXY_DATA_TOKEN=site-proxy-data-token\\n\' > "${DEMO_REHEARSAL_CONFIG_DIR}/site.env"',
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      expect(readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_DATA_TOKEN')).toBe('site-proxy-data-token');
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
        {
          REHEARSAL_MODE: 'fast',
          DEMO_REHEARSAL_SKIP_RELEASE_ARCHIVE: '1',
          DEMO_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD: '1',
        },
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
        { REHEARSAL_MODE: 'fast', SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1' },
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

  it('fails closed when release-fidelity demo rehearsal sees manual skip env', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-skip-policy-'));
    const forbiddenCases: Array<[string, NodeJS.ProcessEnv, string]> = [
      ['default mode', {}, 'SKIP_BUNDLED_IMAGE_LOAD'],
      ['release-fidelity mode', { REHEARSAL_MODE: 'release-fidelity' }, 'SKIP_RELEASE_ARCHIVE'],
      [
        'release-fidelity archive generation',
        { REHEARSAL_MODE: 'release-fidelity' },
        'SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION',
      ],
      ['offline-package line load', { REHEARSAL_MODE: 'offline-package' }, 'DEMO_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD'],
      [
        'offline-package line release archive',
        { REHEARSAL_MODE: 'offline-package' },
        'DEMO_REHEARSAL_SKIP_RELEASE_ARCHIVE',
      ],
    ];

    try {
      stageDemoRehearsalFixture(tempRoot);

      for (const [caseName, env, skipKey] of forbiddenCases) {
        const stderr = expectDemoRehearsalCommandFailure(
          tempRoot,
          `
            source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
            init_demo_rehearsal_env
          `,
          { ...env, [skipKey]: '1' },
        );

        expect(stderr, caseName).toContain('REHEARSAL_MODE');
        expect(stderr, caseName).toContain(skipKey);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects unsupported demo rehearsal modes before applying skip env', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-rehearsal-invalid-mode-'));
    try {
      stageDemoRehearsalFixture(tempRoot);

      const stderr = expectDemoRehearsalCommandFailure(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
          init_demo_rehearsal_env
        `,
        { REHEARSAL_MODE: 'unsafe-skip' },
      );

      expect(stderr).toContain('invalid REHEARSAL_MODE');
      expect(stderr).toContain('fast');
      expect(stderr).toContain('release-fidelity');
      expect(stderr).toContain('offline-package');
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
        { REHEARSAL_MODE: 'fast', DEMO_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD: '1' },
      );

      const withoutFastPath = runDemoRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/demo-rehearsal/common.sh"
          init_demo_rehearsal_env
          printf 'mode=%s\\n' "\${REHEARSAL_MODE:-}"
          printf 'skip=%s\\n' "\${SKIP_BUNDLED_IMAGE_LOAD:-}"
        `,
      );

      expect(withFastPath).toContain('skip=1');
      expect(withoutFastPath).toContain('mode=release-fidelity');
      expect(withoutFastPath).toContain('skip=');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
