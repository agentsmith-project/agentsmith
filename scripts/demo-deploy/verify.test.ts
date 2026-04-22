import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function stageDemoVerifyFixture(tempRoot: string): void {
  const verifyScriptPath = path.join(repoRoot, 'scripts', 'demo-deploy', 'verify.sh');
  const stagedVerifyScriptPath = path.join(tempRoot, 'scripts', 'demo-deploy', 'verify.sh');
  mkdirSync(path.dirname(stagedVerifyScriptPath), { recursive: true });
  copyFileSync(verifyScriptPath, stagedVerifyScriptPath);

  writeExecutable(
    path.join(tempRoot, 'scripts', 'lib', 'common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
RELEASE_ROOT="\${RELEASE_ROOT:-\${HOME}/release}"
RELEASE_SCRIPT_DIR="\${RELEASE_ROOT}/scripts"
REPORT_DIR="\${REPORT_DIR:-\${HOME}/report}"
RELEASE_ID="\${RELEASE_ID:-test-release}"
API_PORT="\${API_PORT:-20000}"
WEB_PORT="\${WEB_PORT:-3001}"
KEYCLOAK_PORT="\${KEYCLOAK_PORT:-18080}"
MINIO_API_PORT="\${MINIO_API_PORT:-19000}"
SANDBOX_HOST_PORT="\${SANDBOX_HOST_PORT:-29180}"
EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL="\${EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL:-http://127.0.0.1:20000}"
INTERNAL_AGENT_K8S_NAMESPACE="\${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-internal}"
load_release_env() {
  mkdir -p "\${RELEASE_ROOT}" "\${RELEASE_SCRIPT_DIR}" "\${REPORT_DIR}" "\${RELEASE_ROOT}/env"
}
docker_run_runtime_proxy_env_args() {
  printf '%s\\n' \
    -e HTTP_PROXY= \
    -e HTTPS_PROXY= \
    -e ALL_PROXY= \
    -e http_proxy= \
    -e https_proxy= \
    -e all_proxy=
}
demo_deploy_mode() {
  printf '%s\\n' "\${DEMO_DEPLOY_MODE:-simple}"
}
demo_mode_is_full() {
  [[ "\$(demo_deploy_mode)" == "full" ]]
}
die() {
  printf '%s\\n' "$*" >&2
  exit 1
}
log() { :; }
state_set() { :; }
json_find_named_id() {
  local target_name="$1"
  cat >/dev/null
  case "\${target_name}" in
    "Demo Project") printf 'proj_demo\\n' ;;
    "preset-anthropic-endpoint") printf 'endpoint_anthropic\\n' ;;
    "preset-openai-endpoint") printf 'endpoint_openai\\n' ;;
    *) printf 'fixture-id\\n' ;;
  esac
}
json_count_items_by_field() {
  cat >/dev/null
  printf '2\\n'
}
`,
  );

  writeExecutable(
    path.join(tempRoot, 'scripts', 'lib', 'preset-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
load_agentsmith_presets() { :; }
apply_non_environment_preset_defaults() { :; }
apply_preset_endpoint_defaults() { :; }
`,
  );

  writeExecutable(
    path.join(tempRoot, 'scripts', 'lib', 'release-story-verify-source-set.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
release_story_verify_source_set() {
  local _release_root="$1"
  printf '%s\\n' 'e2e/integration-release-user-story.spec.ts'
}
`,
  );

  writeExecutable(
    path.join(tempRoot, 'scripts', 'lib', 'runtime-verification.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
resolve_public_runtime_stack() { :; }
gate_evidence_init() {
  mkdir -p "$1" "$1/logs" "$1/runner" "$1/playwright"
}
gate_write_runtime_descriptor() { :; }
gate_write_resolved_env() { :; }
gate_record_service_status() { :; }
gate_record_task_summary() { :; }
gate_resolve_verify_source_file() {
  local _evidence_dir="$1"
  local _line_kind="$2"
  local release_root="$3"
  local root_dir="$4"
  local relative_path="$5"
  if [[ -f "\${release_root}/\${relative_path}" ]]; then
    printf '%s\\n' "\${release_root}/\${relative_path}"
  else
    printf '%s\\n' "\${root_dir}/\${relative_path}"
  fi
}
gate_wait_for_http() { :; }
gate_wait_for_tcp() { :; }
gate_record_preflight_check() { :; }
gate_require_command() { :; }
gate_wait_for_external_runner_connection() { return 0; }
gate_wait_for_universal_proxy_admin_state() { return 0; }
gate_run_auth_preflight() {
  printf 'fixture-access-token\\n'
}
gate_record_failure() { :; }
gate_record_workspace_access() { :; }
gate_write_mount_tree() { :; }
gate_record_success() { :; }
`,
  );

  writeExecutable(
    path.join(tempRoot, 'scripts', 'file-library-real-smoke.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n',
  );

  writeExecutable(
    path.join(tempRoot, 'release', 'scripts', 'check-preset-external-file-library.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${WORKSPACE_ACCESS_EVIDENCE_FILE:-}" ]]; then
  mkdir -p "$(dirname "\${WORKSPACE_ACCESS_EVIDENCE_FILE}")"
  printf '{"mode":"external"}\\n' > "\${WORKSPACE_ACCESS_EVIDENCE_FILE}"
fi
exit 0
`,
  );

  writeFile(
    path.join(tempRoot, 'release', 'VERSION'),
    [
      'release_id=test-release',
      'agentsmith_runner_image=agentsmith-runner:test',
      'agentsmith_chat_runner_image=agentsmith-chat-runner:test',
      'agentsmith_verify_runner_image=agentsmith-verify-runner:test',
      '',
    ].join('\n'),
  );

  for (const relativePath of [
    'e2e/integration-real-helpers.ts',
    'e2e/integration-files.spec.ts',
    'e2e/notebook-execution-outcome.ts',
    'e2e/integration-workspace-access.ts',
    'e2e/integration-workspace-entry.spec.ts',
    'e2e/integration-workspace-publish-usable.spec.ts',
    'e2e/integration-preset-external-file-library.spec.ts',
    'e2e/integration-internal-chat-runner.spec.ts',
    'e2e/integration-release-user-story.spec.ts',
  ]) {
    writeFile(path.join(tempRoot, relativePath), 'placeholder\n');
  }

  writeExecutable(
    path.join(tempRoot, 'bin', 'curl'),
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'{"items":[]}\\n\'\n',
  );
  writeExecutable(
    path.join(tempRoot, 'bin', 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${path.join(tempRoot, 'docker.log')}"
exit 0
`,
  );
}

function stageBundledKubectl(tempRoot: string): string {
  const kubectlPath = path.join(tempRoot, 'release', 'tools', 'kubectl');
  writeExecutable(kubectlPath, '#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n');
  return kubectlPath;
}

function stageKubeconfig(tempRoot: string): string {
  const kubeconfigPath = path.join(tempRoot, 'fixture.kubeconfig');
  writeFile(kubeconfigPath, 'apiVersion: v1\n');
  return kubeconfigPath;
}

function runDemoVerify(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync('bash', ['scripts/demo-deploy/verify.sh'], {
    cwd: tempRoot,
    env: {
      ...process.env,
      HOME: tempRoot,
      PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
      RELEASE_ROOT: path.join(tempRoot, 'release'),
      REPORT_DIR: path.join(tempRoot, 'report'),
      DEMO_DEPLOY_MODE: 'simple',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

describe('demo verify mode contract', () => {
  it('does not require bundled kubectl or kubeconfig in simple mode', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-verify-simple-'));
    try {
      stageDemoVerifyFixture(tempRoot);

      const result = runDemoVerify(tempRoot, {
        DEMO_DEPLOY_MODE: 'simple',
      });

      expect(result.status).toBe(0);
      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      expect(dockerLog).not.toContain('/usr/local/bin/kubectl');
      expect(dockerLog).not.toContain('/tmp/verify-kubeconfig');
      expect(dockerLog).not.toContain('integration-internal-chat-runner.spec.ts:/app/e2e/integration-internal-chat-runner.spec.ts:ro');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('still requires bundled kubectl in full mode', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-verify-full-missing-kubectl-'));
    try {
      stageDemoVerifyFixture(tempRoot);

      const result = runDemoVerify(tempRoot, {
        DEMO_DEPLOY_MODE: 'full',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('bundled kubectl missing from release tools');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('mounts the internal chat spec and kube inputs in full mode', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-verify-full-'));
    try {
      stageDemoVerifyFixture(tempRoot);
      stageBundledKubectl(tempRoot);
      const kubeconfigPath = stageKubeconfig(tempRoot);

      const result = runDemoVerify(tempRoot, {
        DEMO_DEPLOY_MODE: 'full',
        KUBECONFIG: kubeconfigPath,
      });

      expect(result.status).toBe(0);
      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      expect(dockerLog).toContain('/usr/local/bin/kubectl');
      expect(dockerLog).toContain('/tmp/verify-kubeconfig');
      expect(dockerLog).toContain('integration-internal-chat-runner.spec.ts:/app/e2e/integration-internal-chat-runner.spec.ts:ro');
      expect(dockerLog).toContain('KUBECONFIG=/tmp/verify-kubeconfig');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('clears runtime proxy env from verify-time docker runs', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-verify-proxy-sanitize-'));
    try {
      stageDemoVerifyFixture(tempRoot);

      const result = runDemoVerify(tempRoot, {
        DEMO_DEPLOY_MODE: 'simple',
        HTTP_PROXY: 'http://proxy.example:8080',
        HTTPS_PROXY: 'http://proxy.example:8443',
        ALL_PROXY: 'socks5://proxy.example:1080',
        http_proxy: 'http://proxy.example:8080',
        https_proxy: 'http://proxy.example:8443',
        all_proxy: 'socks5://proxy.example:1080',
      });

      expect(result.status).toBe(0);
      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');

      for (const clearedProxy of [
        'HTTP_PROXY=',
        'HTTPS_PROXY=',
        'ALL_PROXY=',
        'http_proxy=',
        'https_proxy=',
        'all_proxy=',
      ]) {
        const matches = dockerLog.match(new RegExp(clearedProxy, 'g')) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
      }

      expect(dockerLog).not.toContain('HTTP_PROXY=http://proxy.example:8080');
      expect(dockerLog).not.toContain('HTTPS_PROXY=http://proxy.example:8443');
      expect(dockerLog).not.toContain('ALL_PROXY=socks5://proxy.example:1080');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
