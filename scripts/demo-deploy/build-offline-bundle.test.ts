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

function stageDemoBuildBundleFixture(tempRoot: string): void {
  const siblingRoot = path.dirname(tempRoot);
  mkdirSync(path.join(siblingRoot, 'mbos-sandbox-v1', 'manager-service'), { recursive: true });
  mkdirSync(path.join(siblingRoot, 'llm-universal-proxy'), { recursive: true });

  mkdirSync(path.join(tempRoot, 'scripts', 'demo-deploy'), { recursive: true });
  copyFileSync(
    path.join(repoRoot, 'scripts', 'demo-deploy', 'build-offline-bundle.sh'),
    path.join(tempRoot, 'scripts', 'demo-deploy', 'build-offline-bundle.sh'),
  );

  writeFile(
    path.join(tempRoot, 'scripts', 'lib', 'ensure-juicefs-vendor.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
ensure_juicefs_vendor_dir() {
  mkdir -p "$1/infra/vendor/juicefs"
}
`,
  );
  writeFile(
    path.join(tempRoot, 'scripts', 'lib', 'docker-buildx-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
docker_build_local() { :; }
`,
  );
  writeFile(
    path.join(tempRoot, 'scripts', 'lib', 'runner-image-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
build_runner_image() { :; }
`,
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
    'scripts/demo-deploy-modes-gate.sh',
    'scripts/lib/common.sh',
    'scripts/lib/deploy-common.sh',
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

  writeFile(path.join(tempRoot, 'scripts', 'notebook-agent-refresh-token.js'), 'console.log("ok");\n');
  writeFile(path.join(tempRoot, 'README-demo-deploy.md'), 'demo bundle\n');
  writeFile(path.join(tempRoot, 'infra', 'runtime', 'presets.env'), 'PRESET_ENDPOINT_MODEL=placeholder-model\n');

  writeFile(path.join(tempRoot, 'infra', 'deploy', 'demo', 'docker-compose.yml'), 'services: {}\n');
  writeFile(
    path.join(tempRoot, 'infra', 'deploy', 'demo', 'deployment.manifest.json'),
    JSON.stringify({
      bundle_files: [],
      bundled_tools: ['kind', 'kubectl', 'juicefs', 'mc'],
      required_env: {},
      bundle_source_sets: [
        {
          name: 'backend_real_story_verify_source_set',
          helper: 'scripts/lib/release-story-verify-source-set.sh',
        },
      ],
    }, null, 2),
  );

  for (const relativePath of [
    'infra/deploy/demo/env/site.env.example',
    'infra/deploy/demo/kind/config.yaml',
    'infra/deploy/demo/k8s/juicefs-csi.yaml',
    'infra/deploy/shared/universal-proxy/config.yaml',
    'infra/integration/postgres-init/001-create-databases.sql',
    'packages/adapters-private/sql/projects.sql',
    'infra/integration/minio/init-minio.sh',
    'infra/integration/keycloak/realm-mbos-dev.json',
    'docs/contracts/deployment-spec-v1.md',
    'docs/user-guides/demo-deploy-operations.md',
    'docs/user-guides/demo-deploy-simple-quickstart-zh.md',
    'e2e/integration-real-helpers.ts',
    'e2e/integration-files.spec.ts',
    'e2e/notebook-execution-outcome.ts',
    'e2e/integration-workspace-access.ts',
    'e2e/integration-workspace-entry.spec.ts',
    'e2e/integration-workspace-publish-usable.spec.ts',
    'e2e/integration-preset-external-file-library.spec.ts',
    'e2e/integration-internal-chat-runner.spec.ts',
    'e2e/stories/backend-real/example.story.md',
    'infra/deploy/Dockerfile.agentsmith-app-base',
    'infra/deploy/Dockerfile.agentsmith-app',
    'infra/deploy/Dockerfile.agentsmith-verify-runner-base',
    'infra/deploy/Dockerfile.agentsmith-verify-runner',
    'infra/runner/Dockerfile.notebook-codex-runner-base',
    'infra/runner/Dockerfile.chat-llm-runner-base',
    'package.json',
    'package-lock.json',
    'packages/adapters-cf/package.json',
    'packages/adapters-private/package.json',
    'packages/notebook-codex-runner/package.json',
    'packages/api-entry-cf/package.json',
    'packages/api-entry-node/package.json',
    'packages/application/package.json',
    'packages/contracts/package.json',
    'packages/domain/package.json',
    'packages/ports/package.json',
    'packages/agent-runner/package.json',
    'packages/chat-llm-runner/package.json',
  ]) {
    writeFile(path.join(tempRoot, relativePath), 'placeholder\n');
  }

  const binDir = path.join(tempRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeExecutable(path.join(binDir, 'kind'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  writeExecutable(path.join(binDir, 'kubectl'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  writeExecutable(path.join(binDir, 'juicefs'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  writeExecutable(path.join(binDir, 'mc'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  writeExecutable(
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  network)
    if [[ "$2" == "inspect" ]]; then
      printf '172.17.0.1\\n'
      exit 0
    fi
    ;;
  image)
    if [[ "$2" == "inspect" ]]; then
      exit 0
    fi
    ;;
  pull)
    exit 0
    ;;
  save)
    output=''
    image=''
    shift
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --platform)
          shift 2
          ;;
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

function runDemoBuildBundle(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [path.join(tempRoot, 'scripts', 'demo-deploy', 'build-offline-bundle.sh')],
    {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
        HOME: tempRoot,
        OUT_DIR: path.join(tempRoot, 'out'),
        RELEASE_ID: 'test-release',
        SKIP_BUNDLE_INPUTS_CHECK: '1',
        SKIP_RELEASE_PRECHECK: '1',
        ...extraEnv,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

describe('demo build bundle image archives', () => {
  it('omits bundled image archives when SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1 while preserving bundle metadata', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-build-bundle-no-images-'));

    try {
      stageDemoBuildBundleFixture(tempRoot);

      runDemoBuildBundle(tempRoot, { SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1' });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');

      expect(existsSync(path.join(bundleDir, 'images'))).toBe(false);
      expect(readFileSync(path.join(bundleDir, 'VERSION'), 'utf8')).toContain('bundled_image_archives_included=0');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
