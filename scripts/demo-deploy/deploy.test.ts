import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function stageDemoDeployFixture(tempRoot: string): void {
  const deployScriptPath = path.join(repoRoot, 'scripts', 'demo-deploy', 'deploy.sh');
  const stagedDeployScriptPath = path.join(tempRoot, 'scripts', 'demo-deploy', 'deploy.sh');
  mkdirSync(path.dirname(stagedDeployScriptPath), { recursive: true });
  copyFileSync(deployScriptPath, stagedDeployScriptPath);

  mkdirSync(path.join(tempRoot, 'scripts', 'lib'), { recursive: true });
  writeFileSync(
    path.join(tempRoot, 'scripts', 'lib', 'common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
DEMO_DEPLOY_ROOT="\${DEMO_DEPLOY_ROOT:-\${HOME}/demo-deploy}"
DEPLOY_ROOT="\${DEMO_DEPLOY_ROOT}"
CURRENT_LINK="\${DEPLOY_ROOT}/current"
RELEASE_ROOT="\${RELEASE_ROOT:-\${DEPLOY_ROOT}/release}"
RELEASE_SCRIPT_DIR="\${RELEASE_ROOT}/scripts"
API_PORT="\${API_PORT:-20000}"
WEB_PORT="\${WEB_PORT:-3001}"
KEYCLOAK_REALM="\${KEYCLOAK_REALM:-mbos}"
INTERNAL_AGENT_K8S_NAMESPACE="\${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-internal}"
ensure_dirs() { mkdir -p "\${DEPLOY_ROOT}" "\${RELEASE_ROOT}" "\${RELEASE_SCRIPT_DIR}" "\${RELEASE_ROOT}/env"; }
ensure_operator_site_env() {
  mkdir -p "\${RELEASE_ROOT}/env"
  if [[ ! -f "\${RELEASE_ROOT}/env/site.env" ]]; then
    printf 'KEYCLOAK_REALM=mbos\\nAPI_PORT=20000\\nWEB_PORT=3001\\n' > "\${RELEASE_ROOT}/env/site.env"
  fi
}
demo_deploy_mode() { printf '%s\\n' "\${DEMO_DEPLOY_MODE:-simple}"; }
demo_mode_is_full() { [[ "\$(demo_deploy_mode)" == "full" ]]; }
load_release_env() { :; }
wait_http() { :; }
wait_tcp() { :; }
log() { printf '[demo-test] %s\\n' "$*"; }
die() { printf '[demo-test] ERROR: %s\\n' "$*" >&2; exit 1; }
`,
    'utf8',
  );
  writeFileSync(path.join(tempRoot, 'scripts', 'lib', 'k8s-external-services.sh'), '#!/usr/bin/env bash\nset -euo pipefail\n', 'utf8');

  mkdirSync(path.join(tempRoot, 'scripts', 'substrate'), { recursive: true });
  writeFileSync(
    path.join(tempRoot, 'scripts', 'substrate', 'deploy-common.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nrelease_substrate_up() { :; }\n',
    'utf8',
  );

  mkdirSync(path.join(tempRoot, 'scripts', 'app'), { recursive: true });
  writeFileSync(
    path.join(tempRoot, 'scripts', 'app', 'deploy-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
write_compose_env() { :; }
release_app_up() { :; }
ensure_kind_nodes_on_network() { :; }
render_k8s_external_dependency_services() { :; }
`,
    'utf8',
  );

  const releaseRoot = path.join(tempRoot, 'release');
  mkdirSync(path.join(releaseRoot, 'images'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'env'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'scripts'), { recursive: true });
  writeFileSync(path.join(releaseRoot, 'images', 'example.tar'), 'tarball', 'utf8');
  writeFileSync(
    path.join(releaseRoot, 'VERSION'),
    [
      'agentsmith_app_image=agentsmith-app:test',
      'agentsmith_runner_image=agentsmith-runner:test',
      'sandbox_manager_image=sandbox-manager:test',
      'llm_universal_proxy_image=llm-universal-proxy:test',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(path.join(releaseRoot, 'env', 'site.env'), 'KEYCLOAK_REALM=mbos\nAPI_PORT=20000\nWEB_PORT=3001\n', 'utf8');
  writeFileSync(path.join(releaseRoot, 'scripts', 'resolve-runtime-addresses.sh'), '#!/usr/bin/env bash\nset -euo pipefail\n: > "${RELEASE_ROOT}/env/runtime-addresses.env"\n', 'utf8');
  writeFileSync(path.join(releaseRoot, 'scripts', 'render-env.sh'), '#!/usr/bin/env bash\nset -euo pipefail\n', 'utf8');

  const binDir = path.join(tempRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${tempRoot}/docker.log"
case "$1" in
  ps)
    exit 0
    ;;
  rm|load|compose)
    exit 0
    ;;
esac
exit 0
`,
    'utf8',
  );
  chmodSync(path.join(binDir, 'docker'), 0o755);
}

function runDemoLoadBundledImages(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        export HOME="${tempRoot}"
        export RELEASE_ROOT="${path.join(tempRoot, 'release')}"
        export DEMO_DEPLOY_ROOT="${path.join(tempRoot, 'deploy-root')}"
        export PATH="${path.join(tempRoot, 'bin')}:$PATH"
        source "${path.join(tempRoot, 'scripts', 'demo-deploy', 'deploy.sh')}"
        load_demo_bundled_images
      `,
    ],
    {
      cwd: tempRoot,
      env: { ...process.env, ...extraEnv },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

describe('demo deploy bundled image loading', () => {
  it('loads bundled images by default', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-load-'));
    try {
      stageDemoDeployFixture(tempRoot);
      runDemoLoadBundledImages(tempRoot);
      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      expect(dockerLog).toContain('load -i');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips bundled image reload when SKIP_BUNDLED_IMAGE_LOAD=1', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-skip-load-'));
    try {
      stageDemoDeployFixture(tempRoot);
      runDemoLoadBundledImages(tempRoot, { SKIP_BUNDLED_IMAGE_LOAD: '1' });
      expect(existsSync(path.join(tempRoot, 'docker.log'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
