import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function writeExecutable(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function stageClusterPrepareFixture(tempRoot: string): void {
  mkdirSync(path.join(tempRoot, 'scripts', 'cluster-deploy'), { recursive: true });
  mkdirSync(path.join(tempRoot, 'scripts', 'lib'), { recursive: true });
  copyFileSync(
    path.join(repoRoot, 'scripts', 'cluster-deploy', 'prepare.sh'),
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'prepare.sh'),
  );
  copyFileSync(
    path.join(repoRoot, 'scripts', 'cluster-deploy', 'lib.sh'),
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'lib.sh'),
  );

  writeFileSync(
    path.join(tempRoot, 'scripts', 'lib', 'deploy-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
DEPLOY_ROOT="\${DEPLOY_ROOT:-${tempRoot}/cluster-deploy}"
CONFIG_DIR="\${CONFIG_DIR:-\${DEPLOY_ROOT}/config}"
CURRENT_LINK="\${DEPLOY_ROOT}/current"
RELEASE_ROOT="\${RELEASE_ROOT:-${tempRoot}/release}"
SHARED_SITE_ENV="\${CONFIG_DIR}/site.env"
TOOLS_DIR="\${RELEASE_ROOT}/tools"
INTERNAL_AGENT_K8S_NAMESPACE="\${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-internal}"
ensure_dirs() { mkdir -p "\${DEPLOY_ROOT}" "\${CONFIG_DIR}" "\${RELEASE_ROOT}/env"; }
state_set() { :; }
log() { printf '[cluster-prepare-test] %s\\n' "$*"; }
die() { printf '[cluster-prepare-test] ERROR: %s\\n' "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }
`,
    'utf8',
  );
  writeFileSync(
    path.join(tempRoot, 'scripts', 'lib', 'release-stage-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
require_release_path() {
  local path="$1"
  local description="$2"
  local kind="\${3:-file}"
  case "\${kind}" in
    file) [[ -f "\${path}" ]] || die "missing \${description} in \${RELEASE_ROOT}" ;;
    dir) [[ -d "\${path}" ]] || die "missing \${description} in \${RELEASE_ROOT}" ;;
    exe) [[ -x "\${path}" ]] || die "missing \${description} at \${path}" ;;
  esac
}
`,
    'utf8',
  );

  const releaseRoot = path.join(tempRoot, 'release');
  mkdirSync(path.join(releaseRoot, 'docs', 'contracts'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'docs', 'user-guides'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'compose'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'env'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'tools'), { recursive: true });
  writeFileSync(path.join(releaseRoot, 'deployment.manifest.json'), JSON.stringify({ bundle_files: [] }), 'utf8');
  writeFileSync(path.join(releaseRoot, 'docs', 'contracts', 'cluster-deployment-spec-v1.md'), 'spec\n', 'utf8');
  writeFileSync(path.join(releaseRoot, 'docs', 'user-guides', 'cluster-admin-runbook.md'), 'runbook\n', 'utf8');
  writeFileSync(path.join(releaseRoot, 'compose', 'docker-compose.yml'), 'services: {}\n', 'utf8');
  writeFileSync(path.join(releaseRoot, 'env', 'site.env'), 'CLUSTER_DEPLOY_MODE=semi-auto\n', 'utf8');
  writeFileSync(path.join(releaseRoot, 'env', 'registry.env'), 'REGISTRY_HOST=localhost:5001\nREGISTRY_PROJECT=mbos\n', 'utf8');
  writeFileSync(path.join(releaseRoot, 'env', 'kubeconfig'), 'clusters:\n- cluster:\n    server: https://127.0.0.1:6443\n', 'utf8');
  writeFileSync(path.join(releaseRoot, 'VERSION'), 'release_id=test-release\nbundled_image_archives_included=0\n', 'utf8');
  writeExecutable(path.join(releaseRoot, 'tools', 'kubectl'), '#!/usr/bin/env bash\nset -euo pipefail\n');

  const binDir = path.join(tempRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeExecutable(
    path.join(binDir, 'kubectl'),
    `#!/usr/bin/env bash
set -euo pipefail
for arg in "$@"; do
  case "$arg" in
    auth)
      printf 'yes\\n'
      exit 0
      ;;
    version)
      exit 0
      ;;
    get)
      exit 0
      ;;
  esac
done
exit 0
`,
  );
  writeExecutable(path.join(binDir, 'docker'), '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n');
  writeExecutable(path.join(binDir, 'curl'), '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n');
}

function runClusterPrepare(tempRoot: string): string {
  return execFileSync(
    'bash',
    [path.join(tempRoot, 'scripts', 'cluster-deploy', 'prepare.sh')],
    {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
        HOME: tempRoot,
        RELEASE_ROOT: path.join(tempRoot, 'release'),
        CLUSTER_DEPLOY_ROOT: path.join(tempRoot, 'cluster-deploy'),
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

describe('cluster prepare bundled image archive contract', () => {
  it('does not require a bundled images directory when the release bundle records that archives were omitted', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-prepare-no-images-'));

    try {
      stageClusterPrepareFixture(tempRoot);
      const output = runClusterPrepare(tempRoot);
      expect(output).toContain('prepare ok');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
