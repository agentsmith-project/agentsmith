import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function writeExecutable(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function writeFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function stageClusterBuildBundleFixture(tempRoot: string): void {
  const siblingRoot = path.dirname(tempRoot);
  mkdirSync(path.join(siblingRoot, 'mbos-sandbox-v1', 'manager-service'), { recursive: true });
  mkdirSync(path.join(siblingRoot, 'llm-universal-proxy'), { recursive: true });

  mkdirSync(path.join(tempRoot, 'scripts', 'cluster-deploy'), { recursive: true });
  copyFileSync(
    path.join(repoRoot, 'scripts', 'cluster-deploy', 'build-bundle.sh'),
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-bundle.sh'),
  );

  writeFile(
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'lib.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "\${SCRIPT_DIR}/../.." && pwd)"
export DEPLOY_ROOT_DEFAULT="\${CLUSTER_DEPLOY_ROOT:-\${HOME}/agentsmith/cluster-deploy}"
export DEPLOY_LOG_PREFIX="\${DEPLOY_LOG_PREFIX:-cluster-build-test}"
source "\${ROOT_DIR}/scripts/lib/deploy-common.sh"
ensure_operator_registry_env() { :; }
load_registry_env() {
  export REGISTRY_HOST="\${REGISTRY_HOST:-localhost:5001}"
  export REGISTRY_PROJECT="\${REGISTRY_PROJECT:-mbos}"
  export K8S_REGISTRY_HOST="\${K8S_REGISTRY_HOST:-kind-registry:5000}"
}
`,
  );
  writeExecutable(
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-images.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
cat > "\${RELEASE_ROOT}/VERSION" <<EOF
release_id=\${RELEASE_ID}
agentsmith_app_image=localhost:5001/mbos/agentsmith-app:\${RELEASE_ID}
agentsmith_runner_image=localhost:5001/mbos/agentsmith-notebook-codex-runner:\${RELEASE_ID}
agentsmith_chat_runner_image=localhost:5001/mbos/agentsmith-chat-llm-runner:\${RELEASE_ID}
agentsmith_chat_runner_k8s_image=kind-registry:5000/mbos/agentsmith-chat-llm-runner:\${RELEASE_ID}
agentsmith_verify_runner_image=localhost:5001/mbos/agentsmith-verify-runner:\${RELEASE_ID}
sandbox_manager_image=localhost:5001/mbos/sandbox-manager:\${RELEASE_ID}
llm_universal_proxy_image=localhost:5001/mbos/llm-universal-proxy:\${RELEASE_ID}
registry_host=localhost:5001
registry_project=mbos
EOF
`,
  );
  writeExecutable(
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'verify.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\n',
  );

  writeExecutable(
    path.join(tempRoot, 'scripts', 'lib', 'ensure-juicefs-vendor.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\n',
  );
  writeFile(
    path.join(tempRoot, 'scripts', 'lib', 'release-story-verify-source-set.sh'),
    `#!/usr/bin/env bash

release_story_verify_source_set_name() {
  printf '%s\\n' 'backend_real_story_verify_source_set'
}

release_story_verify_source_set_helper_path() {
  printf '%s\\n' 'scripts/lib/release-story-verify-source-set.sh'
}

release_story_verify_source_set() {
  printf '%s\\n' 'e2e/stories/backend-real/example.story.md'
}
`,
  );

  for (const relativePath of [
    'scripts/check-preset-external-file-library.sh',
    'scripts/file-library-real-smoke.sh',
    'scripts/cluster-upgrade-smoke.sh',
    'scripts/lib/release-stage-common.sh',
    'scripts/lib/bootstrap-common.sh',
    'scripts/lib/k8s-external-services.sh',
    'scripts/lib/preset-common.sh',
    'scripts/lib/runtime-verification.sh',
    'scripts/substrate/deploy-common.sh',
    'scripts/app/deploy-common.sh',
  ]) {
    writeExecutable(path.join(tempRoot, relativePath), '#!/usr/bin/env bash\nset -euo pipefail\n');
  }
  copyFileSync(
    path.join(repoRoot, 'scripts', 'lib', 'deploy-common.sh'),
    path.join(tempRoot, 'scripts', 'lib', 'deploy-common.sh'),
  );

  writeFile(path.join(tempRoot, 'scripts', 'notebook-agent-refresh-token.js'), 'console.log("ok");\n');
  writeFile(path.join(tempRoot, 'infra', 'runtime', 'presets.env'), 'PRESET_ENDPOINT_MODEL=placeholder-model\n');

  writeFile(path.join(tempRoot, 'infra', 'deploy', 'cluster', 'docker-compose.yml'), 'services: {}\n');
  writeFile(
    path.join(tempRoot, 'infra', 'deploy', 'cluster', 'deployment.manifest.json'),
    JSON.stringify({
      bundle_files: [],
      bundle_source_sets: [
        {
          name: 'backend_real_story_verify_source_set',
          helper: 'scripts/lib/release-story-verify-source-set.sh',
        },
      ],
    }, null, 2),
  );
  for (const relativePath of [
    'infra/deploy/cluster/env/site.env.example',
    'infra/deploy/cluster/env/registry.env.example',
    'infra/deploy/cluster/env/kubeconfig.example.yaml',
    'infra/deploy/cluster/env/admin-kubeconfig.example.yaml',
    'infra/deploy/cluster/env/manager-kubeconfig.example.yaml',
    'infra/integration/postgres-init/001-create-databases.sql',
    'packages/adapters-private/sql/projects.sql',
    'infra/integration/minio/init-minio.sh',
    'infra/integration/keycloak/realm-mbos-dev.json',
    'infra/deploy/shared/universal-proxy/config.yaml',
    'docs/user-guides/cluster-admin-runbook.md',
    'docs/contracts/cluster-deployment-spec-v1.md',
    'docs/user-guides/cluster-deploy-operations.md',
    'docs/user-guides/cluster-upgrade-operations.md',
    'e2e/integration-real-helpers.ts',
    'e2e/integration-files.spec.ts',
    'e2e/notebook-execution-outcome.ts',
    'e2e/integration-workspace-access.ts',
    'e2e/integration-workspace-entry.spec.ts',
    'e2e/integration-workspace-publish-usable.spec.ts',
    'e2e/integration-preset-external-file-library.spec.ts',
    'e2e/integration-internal-chat-runner.spec.ts',
    'e2e/integration-chat-local-upstream.ts',
    'e2e/internal-chat-isolation-probe.ts',
    'e2e/stories/backend-real/example.story.md',
  ]) {
    writeFile(path.join(tempRoot, relativePath), 'placeholder\n');
  }
  writeFile(path.join(tempRoot, 'infra', 'deploy', 'cluster', 'admin-examples', 'placeholder.yaml'), 'apiVersion: v1\n');
  writeFile(path.join(tempRoot, 'infra', 'deploy', 'cluster', 'addons', 'ingress-nginx', 'upstream-deploy.yaml'), 'apiVersion: v1\n');
  writeFile(path.join(tempRoot, 'infra', 'deploy', 'cluster', 'addons', 'juicefs-csi', 'upstream-manifest.yaml'), 'apiVersion: v1\n');

  const binDir = path.join(tempRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeExecutable(path.join(binDir, 'kubectl'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  writeExecutable(
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  image)
    if [[ "$2" == "inspect" ]]; then
      exit 0
    fi
    ;;
  pull|tag)
    exit 0
    ;;
  save)
    output=''
    image=''
    shift
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        -o)
          output="$2"
          shift 2
          ;;
        *)
          image="$1"
          shift
          ;;
      esac
    done
    mkdir -p "$(dirname "$output")"
    printf 'image=%s\\n' "$image" > "$output"
    exit 0
    ;;
esac
exit 0
`,
  );
}

function runClusterBuildBundle(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-bundle.sh')],
    {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
        HOME: tempRoot,
        OUT_DIR: path.join(tempRoot, 'out'),
        RELEASE_ID: 'test-release',
        SKIP_BUNDLE_INPUTS_CHECK: '1',
        ...extraEnv,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

describe('cluster build bundle archive packaging', () => {
  it('writes the release archive by default', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-default-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);

      const output = runClusterBuildBundle(tempRoot);
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const archivePath = path.join(tempRoot, 'out', 'agentsmith-test-release.tar.gz');

      expect(output).toContain(`bundle ready: ${archivePath}`);
      expect(existsSync(bundleDir)).toBe(true);
      expect(existsSync(path.join(bundleDir, 'VERSION'))).toBe(true);
      expect(existsSync(path.join(bundleDir, 'checksums.txt'))).toBe(true);
      expect(existsSync(archivePath)).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips release archive packaging when SKIP_RELEASE_ARCHIVE=1 while keeping the bundle directory intact', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-skip-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);

      const output = runClusterBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const archivePath = path.join(tempRoot, 'out', 'agentsmith-test-release.tar.gz');

      expect(output).toContain(`[cluster-build-test] skipped release archive packaging for ${bundleDir}`);
      expect(existsSync(bundleDir)).toBe(true);
      expect(existsSync(path.join(bundleDir, 'VERSION'))).toBe(true);
      expect(existsSync(path.join(bundleDir, 'checksums.txt'))).toBe(true);
      expect(existsSync(archivePath)).toBe(false);
      expect(readFileSync(path.join(bundleDir, 'VERSION'), 'utf8')).toContain('release_id=test-release');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('omits bundled image archives when SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1 while preserving bundle metadata', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-no-images-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);

      runClusterBuildBundle(tempRoot, { SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1' });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');

      expect(existsSync(path.join(bundleDir, 'images'))).toBe(false);
      expect(readFileSync(path.join(bundleDir, 'VERSION'), 'utf8')).toContain('bundled_image_archives_included=0');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses the explicit bundle RELEASE_ID even when current/VERSION has another release id', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-current-truth-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);
      const deployRoot = path.join(tempRoot, 'cluster-deploy-root');
      const currentRoot = path.join(deployRoot, 'current');
      mkdirSync(currentRoot, { recursive: true });
      writeFileSync(path.join(currentRoot, 'VERSION'), 'release_id=current-release\n', 'utf8');

      runClusterBuildBundle(tempRoot, { CLUSTER_DEPLOY_ROOT: deployRoot, RELEASE_ID: 'new-release' });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-new-release');
      const version = readFileSync(path.join(bundleDir, 'VERSION'), 'utf8');

      expect(version).toContain('release_id=new-release');
      expect(version).not.toContain('current-release');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
