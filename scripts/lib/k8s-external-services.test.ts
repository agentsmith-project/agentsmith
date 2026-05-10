import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

describe('k8s external service namespace helpers', () => {
  it('renders AgentSmith-owned namespace manifests for guarded backend-real cleanup', () => {
    const manifest = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          source scripts/lib/k8s-external-services.sh
          render_agentsmith_owned_namespace_manifest agentsmith-sandbox
        `,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    expect(manifest).toContain('kind: Namespace');
    expect(manifest).toContain('name: agentsmith-sandbox');
    expect(manifest).toContain('app.kubernetes.io/managed-by: agentsmith');
  });
});
