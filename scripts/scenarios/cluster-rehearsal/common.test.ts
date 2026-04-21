import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function stageClusterRehearsalFixture(tempRoot: string): void {
  for (const relativePath of [
    'scripts/scenarios/cluster-rehearsal/common.sh',
    'scripts/scenarios/common.sh',
    'scripts/lib/preset-common.sh',
    'scripts/lib/local-kind-world.sh',
    'infra/deploy/cluster/env/site.env.example',
    'infra/deploy/demo/kind/config.yaml',
    'infra/flows/cluster-rehearsal.env',
  ]) {
    const sourcePath = path.join(process.cwd(), relativePath);
    const targetPath = path.join(tempRoot, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}

function runClusterRehearsalCommand(tempRoot: string, script: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        export ROOT_DIR="${tempRoot}"
        export HOME="${tempRoot}"
        export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
        ${script}
      `,
    ],
    {
      cwd: process.cwd(),
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

describe('cluster-rehearsal generated state ownership', () => {
  it('canonicalizes legacy operator protocol aliases into scenario-owned site env truth without mutating the operator file', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-legacy-protocols-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, '.infra', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, '.infra', 'cluster-deploy', 'site.env'),
        [
          'PRESET_ANTHROPIC_ENDPOINT_PROTOCOL=anthropic_compatible',
          'PRESET_OPENAI_ENDPOINT_PROTOCOL=openai_compatible',
        ].join('\n') + '\n',
        'utf8',
      );

      runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_site_env
        `,
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      const operatorSiteEnv = path.join(tempRoot, '.infra', 'cluster-deploy', 'site.env');

      expect(readEnvValue(seededSiteEnv, 'PRESET_ANTHROPIC_ENDPOINT_PROTOCOL')).toBe('anthropic_messages');
      expect(readEnvValue(seededSiteEnv, 'PRESET_OPENAI_ENDPOINT_PROTOCOL')).toBe('openai_chat_completions');
      expect(readEnvValue(operatorSiteEnv, 'PRESET_ANTHROPIC_ENDPOINT_PROTOCOL')).toBe('anthropic_compatible');
      expect(readEnvValue(operatorSiteEnv, 'PRESET_OPENAI_ENDPOINT_PROTOCOL')).toBe('openai_compatible');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps rejecting unsupported unknown endpoint protocols after ingest', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-unknown-protocol-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, '.infra', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, '.infra', 'cluster-deploy', 'site.env'),
        'PRESET_ANTHROPIC_ENDPOINT_PROTOCOL=totally_unknown\n',
        'utf8',
      );

      let failure: Error | undefined;
      try {
        runClusterRehearsalCommand(
          tempRoot,
          `
            source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            ensure_cluster_rehearsal_site_env
          `,
        );
      } catch (error) {
        failure = error as Error & { stderr?: Buffer | string };
      }

      expect(failure).toBeDefined();
      expect(String((failure as Error & { stderr?: Buffer | string }).stderr ?? failure?.message)).toContain(
        'unsupported endpoint protocol: totally_unknown',
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rewrites fresh site.env seeds to the tracked rehearsal sandbox URL truth', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-site-env-'));

    try {
      const output = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            mkdir -p "${tempRoot}/.infra/cluster-deploy"
            ln -s "${repoRoot}/scripts" "${tempRoot}/scripts"
            ln -s "${repoRoot}/infra" "${tempRoot}/infra"
            cat > "${tempRoot}/.infra/cluster-deploy/site.env" <<'EOF'
SANDBOX_MANAGER_PUBLIC_BASE_URL=http://192.168.0.210:29080
COMPOSE_INTERNAL_SANDBOX_MANAGER_BASE_URL=http://192.168.0.210:29080
EOF
            export ROOT_DIR="${tempRoot}"
            export HOME="${tempRoot}"
            export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
            source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            ensure_cluster_rehearsal_site_env
            grep '^SANDBOX_HOST_PORT=' "${tempRoot}/scenario/config/site.env"
            grep '^SANDBOX_MANAGER_PUBLIC_BASE_URL=' "${tempRoot}/scenario/config/site.env"
            grep '^COMPOSE_INTERNAL_SANDBOX_MANAGER_BASE_URL=' "${tempRoot}/scenario/config/site.env"
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      expect(output).toContain('SANDBOX_HOST_PORT=29080');
      expect(output).toContain('SANDBOX_MANAGER_PUBLIC_BASE_URL=http://192.168.0.210:29080');
      expect(output).toContain('COMPOSE_INTERNAL_SANDBOX_MANAGER_BASE_URL=http://host.docker.internal:29080');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('exports SKIP_BUNDLED_IMAGE_LOAD=1 only when the cluster rehearsal fast-path flag is enabled', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-fast-path-'));

    try {
      const withFastPath = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            export ROOT_DIR="${repoRoot}"
            export HOME="${tempRoot}"
            export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
            export CLUSTER_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD=1
            source "${repoRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            printf 'skip=%s\\n' "\${SKIP_BUNDLED_IMAGE_LOAD:-}"
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );
      const withoutFastPath = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            export ROOT_DIR="${repoRoot}"
            export HOME="${tempRoot}"
            export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
            source "${repoRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            printf 'skip=%s\\n' "\${SKIP_BUNDLED_IMAGE_LOAD:-}"
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      expect(withFastPath).toContain('skip=1');
      expect(withoutFastPath).toContain('skip=');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('passes release bundle fast-path env to the cluster bundle builder only when the rehearsal fast-path flag is enabled, while preserving explicit caller overrides', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-archive-flag-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, 'scripts', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-bundle.sh'),
        `#!/usr/bin/env bash
set -euo pipefail
mkdir -p "\${OUT_DIR}"
printf 'SKIP_RELEASE_ARCHIVE=%s\\n' "\${SKIP_RELEASE_ARCHIVE:-}" > "\${OUT_DIR}/builder.env"
printf 'SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=%s\\n' "\${SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION:-}" >> "\${OUT_DIR}/builder.env"
mkdir -p "\${OUT_DIR}/agentsmith-\${RELEASE_ID}"
`,
        'utf8',
      );

      const withFastPath = runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
          printf 'release_root=%s\\n' "\${RELEASE_ROOT}"
        `,
        { CLUSTER_REHEARSAL_SKIP_RELEASE_ARCHIVE: '1', CLUSTER_REHEARSAL_SKIP_BUNDLED_IMAGE_LOAD: '1' },
      );

      const withExplicitOverride = runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          rm -f "${tempRoot}/scenario/releases/builder.env"
          ensure_cluster_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
        `,
        { SKIP_RELEASE_ARCHIVE: '1' },
      );

      const withExplicitArchiveOverride = runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          rm -f "${tempRoot}/scenario/releases/builder.env"
          ensure_cluster_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
        `,
        { SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1' },
      );

      const withoutFastPath = runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          rm -f "${tempRoot}/scenario/releases/builder.env"
          ensure_cluster_rehearsal_release_bundle
          cat "${tempRoot}/scenario/releases/builder.env"
        `,
      );

      expect(withFastPath).toContain('SKIP_RELEASE_ARCHIVE=1');
      expect(withFastPath).toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1');
      expect(withFastPath).toContain(`release_root=${path.join(tempRoot, 'scenario', 'releases', 'agentsmith-')}`);
      expect(withExplicitOverride).toContain('SKIP_RELEASE_ARCHIVE=1');
      expect(withExplicitArchiveOverride).toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1');
      expect(withoutFastPath).toContain('SKIP_RELEASE_ARCHIVE=');
      expect(withoutFastPath).not.toContain('SKIP_RELEASE_ARCHIVE=1');
      expect(withoutFastPath).toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=');
      expect(withoutFastPath).not.toContain('SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('hydrates a fresh rehearsal site env with MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN without mutating the tracked example', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-proxy-token-'));

    try {
      stageClusterRehearsalFixture(tempRoot);

      runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_site_env
        `,
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      const exampleSiteEnv = path.join(tempRoot, 'infra', 'deploy', 'cluster', 'env', 'site.env.example');
      const firstToken = readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');

      runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_site_env
        `,
      );

      const secondToken = readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN');
      expect(firstToken).not.toBe('');
      expect(secondToken).toBe(firstToken);
      expect(readEnvValue(exampleSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN')).toBe('');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preserves an explicit rehearsal MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN instead of replacing it', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-proxy-token-explicit-'));

    try {
      stageClusterRehearsalFixture(tempRoot);
      mkdirSync(path.join(tempRoot, '.infra', 'cluster-deploy'), { recursive: true });
      writeFileSync(
        path.join(tempRoot, '.infra', 'cluster-deploy', 'site.env'),
        'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=site-proxy-token\n',
        'utf8',
      );

      runClusterRehearsalCommand(
        tempRoot,
        `
          source "${tempRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
          init_cluster_rehearsal_env
          ensure_cluster_rehearsal_site_env
        `,
      );

      const seededSiteEnv = path.join(tempRoot, 'scenario', 'config', 'site.env');
      expect(readEnvValue(seededSiteEnv, 'MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN')).toBe('site-proxy-token');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('routes handoff and shared kubeconfig paths into scenario-generated state', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-common-'));

    try {
      const output = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            export ROOT_DIR="${repoRoot}"
            export HOME="${tempRoot}"
            export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
            source "${repoRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            mark_cluster_rehearsal_admin_ready
            printf 'generated=%s\\n' "\${CLUSTER_REHEARSAL_GENERATED_DIR}"
            printf 'kubeconfig=%s\\n' "\${CLUSTER_DEPLOY_SHARED_KUBECONFIG}"
            printf 'admin_kubeconfig=%s\\n' "\${CLUSTER_DEPLOY_SHARED_ADMIN_KUBECONFIG}"
            printf 'manager_kubeconfig=%s\\n' "\${CLUSTER_DEPLOY_SHARED_MANAGER_KUBECONFIG}"
            printf 'admin_ready=%s\\n' "\${CLUSTER_DEPLOY_SHARED_ADMIN_READY_ENV}"
            printf 'handoff=%s\\n' "\${CLUSTER_DEPLOY_ADMIN_HANDOFF_DIR}"
            cat "\${CLUSTER_DEPLOY_SHARED_ADMIN_READY_ENV}"
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      const generatedDir = path.join(tempRoot, 'scenario', 'state', 'generated');
      expect(output).toContain(`generated=${generatedDir}`);
      expect(output).toContain(`kubeconfig=${path.join(generatedDir, 'kubeconfig')}`);
      expect(output).toContain(`admin_kubeconfig=${path.join(generatedDir, 'admin-kubeconfig')}`);
      expect(output).toContain(`manager_kubeconfig=${path.join(generatedDir, 'manager-kubeconfig')}`);
      expect(output).toContain(`admin_ready=${path.join(generatedDir, 'admin-ready.env')}`);
      expect(output).toContain(`handoff=${path.join(generatedDir, 'admin-handoff')}`);
      expect(output).toContain('ADMIN_READY=1');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('cleans legacy generated handoff artifacts from the rehearsal root', () => {
    const repoRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-rehearsal-legacy-'));

    try {
      const output = execFileSync(
        'bash',
        [
          '-lc',
          `
            set -euo pipefail
            export ROOT_DIR="${repoRoot}"
            export HOME="${tempRoot}"
            export CLUSTER_REHEARSAL_ROOT="${tempRoot}/scenario"
            mkdir -p "${tempRoot}/scenario/config" "${tempRoot}/scenario/admin-handoff"
            printf 'old\\n' > "${tempRoot}/scenario/config/kubeconfig"
            printf 'old\\n' > "${tempRoot}/scenario/config/admin-kubeconfig"
            printf 'old\\n' > "${tempRoot}/scenario/config/manager-kubeconfig"
            printf 'ADMIN_READY=1\\n' > "${tempRoot}/scenario/config/admin-ready.env"
            printf 'stale\\n' > "${tempRoot}/scenario/admin-handoff/README.md"
            source "${repoRoot}/scripts/scenarios/cluster-rehearsal/common.sh"
            init_cluster_rehearsal_env
            cleanup_cluster_rehearsal_legacy_generated_state
            test ! -e "${tempRoot}/scenario/config/kubeconfig"
            test ! -e "${tempRoot}/scenario/config/admin-kubeconfig"
            test ! -e "${tempRoot}/scenario/config/manager-kubeconfig"
            test ! -e "${tempRoot}/scenario/config/admin-ready.env"
            test ! -e "${tempRoot}/scenario/admin-handoff"
            printf 'legacy_cleanup=ok\\n'
          `,
        ],
        {
          cwd: repoRoot,
          env: { ...process.env },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      expect(output).toContain('legacy_cleanup=ok');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preloads both notebook and chat runner images into the rehearsal kind node', () => {
    const commonScript = readFileSync(path.join(process.cwd(), 'scripts', 'scenarios', 'cluster-rehearsal', 'common.sh'), 'utf8');

    expect(commonScript).toContain('local host_images=(');
    expect(commonScript).toContain('local kind_images=(');
    expect(commonScript).toContain('"${RUNNER_IMAGE}"');
    expect(commonScript).toContain('"${CHAT_RUNNER_IMAGE}"');
    expect(commonScript).toContain('"${K8S_RUNNER_IMAGE}"');
    expect(commonScript).toContain('"${K8S_CHAT_RUNNER_IMAGE}"');
  });
});
