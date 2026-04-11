import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('cluster-rehearsal generated state ownership', () => {
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
});
