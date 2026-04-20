import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function stageRehearsalResetFixture(tempRoot: string): void {
  for (const relativePath of [
    'scripts/scenarios/common.sh',
    'scripts/scenarios/demo-rehearsal/reset.sh',
    'scripts/scenarios/cluster-rehearsal/reset.sh',
  ]) {
    copyFixtureFile(tempRoot, relativePath);
  }

  writeFixtureFile(
    tempRoot,
    'scripts/lib/local-kind-world.sh',
    `#!/usr/bin/env bash
set -euo pipefail

local_kind_world_destroy() {
  printf 'local-kind-destroy %s %s %s\\n' "$1" "$2" "$3" >> "\${ROOT_DIR}/transition.log"
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
}

cleanup_cluster_rehearsal_legacy_generated_state() {
  printf 'cluster-legacy-cleanup\\n' >> "\${ROOT_DIR}/transition.log"
}
`,
  );

  writeFixtureFile(
    tempRoot,
    'scripts/demo-deploy/reset.sh',
    `#!/usr/bin/env bash
set -euo pipefail
printf 'demo-reset root=%s\\n' "\${DEMO_DEPLOY_ROOT}" >> "\${ROOT_DIR}/transition.log"
`,
  );

  writeFixtureFile(
    tempRoot,
    'scripts/cluster-deploy/reset.sh',
    `#!/usr/bin/env bash
set -euo pipefail
printf 'cluster-reset root=%s\\n' "\${CLUSTER_DEPLOY_ROOT}" >> "\${ROOT_DIR}/transition.log"
`,
  );
}

function runtimeRoot(tempRoot: string): string {
  return path.join(tempRoot, 'runtime');
}

function activeLockPath(tempRoot: string): string {
  return path.join(runtimeRoot(tempRoot), 'active-scenario.lock');
}

function transitionLogPath(tempRoot: string): string {
  return path.join(tempRoot, 'transition.log');
}

function runScenarioScript(tempRoot: string, relativePath: string): string {
  mkdirSync(runtimeRoot(tempRoot), { recursive: true });

  return execFileSync('bash', [path.join(tempRoot, relativePath)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ROOT_DIR: tempRoot,
      HOME: tempRoot,
      SCENARIO_RUNTIME_ROOT: runtimeRoot(tempRoot),
      ACTIVE_SCENARIO_LOCK_FILE: activeLockPath(tempRoot),
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function readTransitionLog(tempRoot: string): string[] {
  const logPath = transitionLogPath(tempRoot);
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
}

function assertScenarioCanAcquireLock(tempRoot: string, scenario: string): void {
  const output = execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        source "${tempRoot}/scripts/scenarios/common.sh"
        acquire_scenario_lock "${scenario}"
        printf 'active=%s\\n' "$(current_active_scenario)"
        release_scenario_lock "${scenario}"
      `,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ROOT_DIR: tempRoot,
        HOME: tempRoot,
        SCENARIO_RUNTIME_ROOT: runtimeRoot(tempRoot),
        ACTIVE_SCENARIO_LOCK_FILE: activeLockPath(tempRoot),
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  expect(output).toContain(`active=${scenario}`);
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
        SCENARIO_RUNTIME_ROOT: runtimeRoot(tempRoot),
        ACTIVE_SCENARIO_LOCK_FILE: activeLockPath(tempRoot),
      },
      stdio: 'pipe',
    },
  );
}

describe('rehearsal reset transition lifecycle', () => {
  it('lets cluster-rehearsal reset reclaim an active demo-rehearsal and leave the lock clear for the next step', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'rehearsal-reset-transition-'));

    try {
      stageRehearsalResetFixture(tempRoot);
      mkdirSync(runtimeRoot(tempRoot), { recursive: true });
      const demoScenarioRoot = path.join(tempRoot, 'campaign', 'lane-demo-rehearsal', 'scenario');
      primeActiveScenario(tempRoot, 'demo-rehearsal', demoScenarioRoot);

      const output = runScenarioScript(tempRoot, 'scripts/scenarios/cluster-rehearsal/reset.sh');

      expect(output).toContain('[demo-rehearsal] reset complete');
      expect(output).toContain('[cluster-rehearsal] reset complete');
      expect(readTransitionLog(tempRoot)).toEqual([
        `demo-reset root=${demoScenarioRoot}`,
        `local-kind-destroy agentsmith-cluster agentsmith-cluster-registry ${path.join(tempRoot, 'artifacts', 'runtime', 'scenario', 'cluster-rehearsal', 'state', 'local-kind')}`,
        'cluster-legacy-cleanup',
        `cluster-reset root=${path.join(tempRoot, 'artifacts', 'runtime', 'scenario', 'cluster-rehearsal')}`,
      ]);
      expect(existsSync(activeLockPath(tempRoot))).toBe(false);
      assertScenarioCanAcquireLock(tempRoot, 'cluster-rehearsal');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('routes demo-rehearsal reset through cluster-rehearsal reset so the current cluster-owned world is cleaned before switching', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'rehearsal-reset-transition-'));

    try {
      stageRehearsalResetFixture(tempRoot);
      mkdirSync(runtimeRoot(tempRoot), { recursive: true });
      const clusterScenarioRoot = path.join(tempRoot, 'campaign', 'lane-cluster-rehearsal', 'scenario');
      primeActiveScenario(tempRoot, 'cluster-rehearsal', clusterScenarioRoot);

      const output = runScenarioScript(tempRoot, 'scripts/scenarios/demo-rehearsal/reset.sh');

      expect(output).toContain('[cluster-rehearsal] reset complete');
      expect(output).toContain('[demo-rehearsal] reset complete');
      expect(readTransitionLog(tempRoot)).toEqual([
        `local-kind-destroy agentsmith-cluster agentsmith-cluster-registry ${path.join(clusterScenarioRoot, 'state', 'local-kind')}`,
        'cluster-legacy-cleanup',
        `cluster-reset root=${clusterScenarioRoot}`,
        `demo-reset root=${path.join(tempRoot, 'artifacts', 'runtime', 'scenario', 'demo-rehearsal')}`,
      ]);
      expect(existsSync(activeLockPath(tempRoot))).toBe(false);
      assertScenarioCanAcquireLock(tempRoot, 'demo-rehearsal');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
