import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function writeFixtureFile(tempRoot: string, relativePath: string, content: string): void {
  const targetPath = path.join(tempRoot, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, 'utf8');
}

function copyFixtureFile(tempRoot: string, relativePath: string): void {
  const sourcePath = path.join(repoRoot, relativePath);
  const targetPath = path.join(tempRoot, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}

function runtimeRoot(tempRoot: string): string {
  return path.join(tempRoot, 'runtime');
}

function activeLockPath(tempRoot: string): string {
  return path.join(runtimeRoot(tempRoot), 'active-scenario.lock');
}

function activeStatePath(tempRoot: string): string {
  return path.join(runtimeRoot(tempRoot), 'active-scenario.env');
}

function stageResetPreservationFixture(tempRoot: string): void {
  for (const relativePath of [
    'scripts/scenarios/common.sh',
    'scripts/scenarios/demo-rehearsal/reset.sh',
    'scripts/scenarios/cluster-rehearsal/reset.sh',
    'scripts/demo-deploy/reset.sh',
    'scripts/cluster-deploy/reset.sh',
  ]) {
    copyFixtureFile(tempRoot, relativePath);
  }

  writeFixtureFile(
    tempRoot,
    'scripts/lib/local-kind-world.sh',
    `#!/usr/bin/env bash
set -euo pipefail

local_kind_world_destroy() {
  printf 'local-kind-destroy %s %s %s %s\\n' "$1" "$2" "$3" "\${4:-}" >> "\${ROOT_DIR}/reset.log"
}
`,
  );

  writeFixtureFile(
    tempRoot,
    'scripts/substrate/deploy-common.sh',
    `#!/usr/bin/env bash
set -euo pipefail

cleanup_report_dir_artifacts() {
  printf 'cleanup-report %s\\n' "$1" >> "\${ROOT_DIR}/reset.log"
}
`,
  );

  writeFixtureFile(
    tempRoot,
    'scripts/lib/common.sh',
    `#!/usr/bin/env bash
set -euo pipefail

DEMO_DEPLOY_ROOT="\${DEMO_DEPLOY_ROOT:-\${HOME}/demo-deploy}"
DEPLOY_ROOT="\${DEMO_DEPLOY_ROOT}"
CURRENT_LINK="\${DEPLOY_ROOT}/current"
RELEASE_ROOT="\${RELEASE_ROOT:-\${DEPLOY_ROOT}/release}"
STATE_DIR="\${DEPLOY_ROOT}/state"
LOG_DIR="\${DEPLOY_ROOT}/logs"
REPORT_DIR="\${DEPLOY_ROOT}/reports"

ensure_dirs() {
  mkdir -p "\${DEPLOY_ROOT}" "\${STATE_DIR}" "\${LOG_DIR}" "\${REPORT_DIR}"
}

write_compose_env() { :; }

docker_compose() {
  printf 'demo-compose %s\\n' "$*" >> "\${ROOT_DIR}/reset.log"
}

demo_deploy_mode() {
  printf '%s\\n' "\${DEMO_DEPLOY_MODE:-full}"
}

demo_mode_is_full() {
  [[ "$(demo_deploy_mode)" == "full" ]]
}

state_set() {
  mkdir -p "\${STATE_DIR}"
  printf '%s=%s\\n' "$1" "$2" >> "\${STATE_DIR}/reset-state.log"
}

log() {
  printf '[demo-deploy] %s\\n' "$*"
}
`,
  );

  writeFixtureFile(
    tempRoot,
    'scripts/cluster-deploy/lib.sh',
    `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="\${ROOT_DIR:-$(cd "$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)}"
CLUSTER_DEPLOY_ROOT="\${CLUSTER_DEPLOY_ROOT:-\${HOME}/cluster-deploy}"
DEPLOY_ROOT="\${CLUSTER_DEPLOY_ROOT}"
CURRENT_LINK="\${DEPLOY_ROOT}/current"
RELEASE_ROOT="\${RELEASE_ROOT:-\${DEPLOY_ROOT}/release}"
STATE_DIR="\${DEPLOY_ROOT}/state"
LOG_DIR="\${DEPLOY_ROOT}/logs"
REPORT_DIR="\${DEPLOY_ROOT}/reports"

ensure_dirs() {
  mkdir -p "\${DEPLOY_ROOT}" "\${STATE_DIR}" "\${LOG_DIR}" "\${REPORT_DIR}"
}

load_kubeconfig() { :; }
write_compose_env() { :; }

docker_compose() {
  printf 'cluster-compose %s\\n' "$*" >> "\${ROOT_DIR}/reset.log"
}

state_set() {
  mkdir -p "\${STATE_DIR}"
  printf '%s=%s\\n' "$1" "$2" >> "\${STATE_DIR}/reset-state.log"
}

log() {
  printf '[cluster-deploy] %s\\n' "$*"
}
`,
  );

  writeFixtureFile(
    tempRoot,
    'scripts/scenarios/demo-rehearsal/common.sh',
    `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="\${ROOT_DIR:-$(cd "$(dirname "\${BASH_SOURCE[0]}")/../../.." && pwd)}"
source "\${ROOT_DIR}/scripts/scenarios/common.sh"

DEMO_REHEARSAL_NAME="demo-rehearsal"
DEMO_REHEARSAL_ROOT_DEFAULT="\${ROOT_DIR}/artifacts/runtime/scenario/\${DEMO_REHEARSAL_NAME}"
DEMO_REHEARSAL_ROOT="\${DEMO_REHEARSAL_ROOT:-\${DEMO_REHEARSAL_ROOT_DEFAULT}}"

init_demo_rehearsal_env() {
  export ROOT_DIR
  export DEMO_REHEARSAL_ROOT
  export DEMO_DEPLOY_ROOT="\${DEMO_REHEARSAL_ROOT}"
  export DEMO_DEPLOY_MODE="\${DEMO_DEPLOY_MODE:-full}"
  export RELEASE_ROOT="\${DEMO_REHEARSAL_ROOT}/release"
}
`,
  );

  writeFixtureFile(
    tempRoot,
    'scripts/scenarios/cluster-rehearsal/common.sh',
    `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="\${ROOT_DIR:-$(cd "$(dirname "\${BASH_SOURCE[0]}")/../../.." && pwd)}"
source "\${ROOT_DIR}/scripts/scenarios/common.sh"

CLUSTER_REHEARSAL_NAME="cluster-rehearsal"
CLUSTER_REHEARSAL_ROOT_DEFAULT="\${ROOT_DIR}/artifacts/runtime/scenario/\${CLUSTER_REHEARSAL_NAME}"
CLUSTER_REHEARSAL_ROOT="\${CLUSTER_REHEARSAL_ROOT:-\${CLUSTER_REHEARSAL_ROOT_DEFAULT}}"

init_cluster_rehearsal_env() {
  export ROOT_DIR
  export CLUSTER_REHEARSAL_ROOT
  export CLUSTER_DEPLOY_ROOT="\${CLUSTER_REHEARSAL_ROOT}"
  export LOCAL_KIND_CLUSTER_NAME="agentsmith-cluster"
  export LOCAL_KIND_REGISTRY_NAME="agentsmith-cluster-registry"
  export RELEASE_ROOT="\${CLUSTER_REHEARSAL_ROOT}/release"
}

cleanup_cluster_rehearsal_legacy_generated_state() {
  printf 'cluster-legacy-cleanup\\n' >> "\${ROOT_DIR}/reset.log"
}
`,
  );

  writeFixtureFile(
    tempRoot,
    'bin/docker',
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${tempRoot}/docker.log"
exit 0
`,
  );
  chmodSync(path.join(tempRoot, 'bin', 'docker'), 0o755);
}

function runScenarioScript(tempRoot: string, relativePath: string): string {
  mkdirSync(runtimeRoot(tempRoot), { recursive: true });

  return execFileSync('bash', [path.join(tempRoot, relativePath)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ROOT_DIR: tempRoot,
      HOME: tempRoot,
      PATH: `${path.join(tempRoot, 'bin')}:/usr/bin:/bin`,
      SCENARIO_RUNTIME_ROOT: runtimeRoot(tempRoot),
      ACTIVE_SCENARIO_LOCK_FILE: activeLockPath(tempRoot),
      ACTIVE_SCENARIO_STATE_FILE: activeStatePath(tempRoot),
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function primeActiveScenario(tempRoot: string, scenario: string, scenarioRoot: string): void {
  execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        source "${tempRoot}/scripts/scenarios/common.sh"
        acquire_scenario_lock "${scenario}" "${scenarioRoot}"
      `,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ROOT_DIR: tempRoot,
        HOME: tempRoot,
        PATH: `${path.join(tempRoot, 'bin')}:/usr/bin:/bin`,
        SCENARIO_RUNTIME_ROOT: runtimeRoot(tempRoot),
        ACTIVE_SCENARIO_LOCK_FILE: activeLockPath(tempRoot),
        ACTIVE_SCENARIO_STATE_FILE: activeStatePath(tempRoot),
      },
      stdio: 'pipe',
    },
  );
}

function seedScenarioRuntime(root: string, reportId: string): void {
  mkdirSync(path.join(root, 'state'), { recursive: true });
  mkdirSync(path.join(root, 'logs'), { recursive: true });
  mkdirSync(path.join(root, 'reports', 'verify-artifacts', 'evidence'), { recursive: true });

  writeFileSync(path.join(root, 'state', 'runtime.pid'), '1234\n', 'utf8');
  writeFileSync(path.join(root, 'logs', 'runtime.log'), 'still-running\n', 'utf8');
  writeFileSync(path.join(root, 'reports', `${reportId}.md`), `# ${reportId}\n`, 'utf8');
  writeFileSync(path.join(root, 'reports', `${reportId}.json`), JSON.stringify({ reportId }) + '\n', 'utf8');
  writeFileSync(
    path.join(root, 'reports', 'verify-artifacts', 'evidence', 'result.json'),
    JSON.stringify({ reportId, status: 'passed' }) + '\n',
    'utf8',
  );
}

function expectRuntimeCleanedAndReportsPreserved(root: string, reportId: string): void {
  expect(existsSync(path.join(root, 'state', 'runtime.pid'))).toBe(false);
  expect(existsSync(path.join(root, 'logs', 'runtime.log'))).toBe(false);
  expect(readFileSync(path.join(root, 'reports', `${reportId}.md`), 'utf8')).toContain(reportId);
  expect(JSON.parse(readFileSync(path.join(root, 'reports', `${reportId}.json`), 'utf8'))).toEqual({ reportId });
  expect(JSON.parse(readFileSync(path.join(root, 'reports', 'verify-artifacts', 'evidence', 'result.json'), 'utf8'))).toEqual({
    reportId,
    status: 'passed',
  });
}

describe('rehearsal reset evidence preservation', () => {
  it('preserves demo rehearsal reports and evidence when cluster reset reclaims the active demo lane', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'rehearsal-reset-evidence-'));

    try {
      stageResetPreservationFixture(tempRoot);
      const demoScenarioRoot = path.join(tempRoot, 'campaign', 'lane-demo-rehearsal', 'scenario');
      const clusterScenarioRoot = path.join(tempRoot, 'artifacts', 'runtime', 'scenario', 'cluster-rehearsal');
      seedScenarioRuntime(demoScenarioRoot, 'demo-report');
      seedScenarioRuntime(clusterScenarioRoot, 'cluster-history');
      primeActiveScenario(tempRoot, 'demo-rehearsal', demoScenarioRoot);

      const output = runScenarioScript(tempRoot, 'scripts/scenarios/cluster-rehearsal/reset.sh');

      expect(output).toContain('[demo-rehearsal] reset complete');
      expect(output).toContain('[cluster-rehearsal] reset complete');
      expectRuntimeCleanedAndReportsPreserved(demoScenarioRoot, 'demo-report');
      expectRuntimeCleanedAndReportsPreserved(clusterScenarioRoot, 'cluster-history');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preserves cluster rehearsal reports and evidence when demo reset reclaims the active cluster lane', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'rehearsal-reset-evidence-'));

    try {
      stageResetPreservationFixture(tempRoot);
      const clusterScenarioRoot = path.join(tempRoot, 'campaign', 'lane-cluster-rehearsal', 'scenario');
      const demoScenarioRoot = path.join(tempRoot, 'artifacts', 'runtime', 'scenario', 'demo-rehearsal');
      seedScenarioRuntime(clusterScenarioRoot, 'cluster-report');
      seedScenarioRuntime(demoScenarioRoot, 'demo-history');
      primeActiveScenario(tempRoot, 'cluster-rehearsal', clusterScenarioRoot);

      const output = runScenarioScript(tempRoot, 'scripts/scenarios/demo-rehearsal/reset.sh');

      expect(output).toContain('[cluster-rehearsal] reset complete');
      expect(output).toContain('[demo-rehearsal] reset complete');
      expectRuntimeCleanedAndReportsPreserved(clusterScenarioRoot, 'cluster-report');
      expectRuntimeCleanedAndReportsPreserved(demoScenarioRoot, 'demo-history');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
