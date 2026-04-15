import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runPlatformReadiness(args: {
  apiReady?: boolean;
  webReady?: boolean;
  proxyReady?: boolean;
  apiPid?: string;
  webPid?: string;
}): { state: string; isReady: string } {
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'local-manual-platform-readiness-'));
  const backendRealRoot = path.join(tempRoot, 'backend-real', 'current');
  const runtimeLinesRoot = path.join(tempRoot, 'artifacts', 'runtime', 'lines');
  const localManualRoot = path.join(runtimeLinesRoot, 'local-manual', 'current');
  const substrateRoot = path.join(tempRoot, 'runtime', 'substrate', 'local-dev');
  const envFile = path.join(tempRoot, '.env.local-manual');

  try {
    mkdirSync(localManualRoot, { recursive: true });
    mkdirSync(substrateRoot, { recursive: true });
    writeFileSync(envFile, `SUBSTRATE_STATE_ROOT=${substrateRoot}\n`, 'utf8');

    if (args.apiReady ?? true) {
      writeFileSync(path.join(localManualRoot, 'api.ready'), 'ready\n', 'utf8');
    }
    if (args.webReady ?? true) {
      writeFileSync(path.join(localManualRoot, 'web.ready'), 'ready\n', 'utf8');
    }
    if (args.proxyReady ?? true) {
      writeFileSync(path.join(substrateRoot, 'proxy.ready'), 'ready\n', 'utf8');
    }
    if (args.apiPid) {
      writeFileSync(path.join(localManualRoot, 'api.pid'), `${args.apiPid}\n`, 'utf8');
    }
    if (args.webPid) {
      writeFileSync(path.join(localManualRoot, 'web.pid'), `${args.webPid}\n`, 'utf8');
    }

    const output = execFileSync(
      'bash',
      [
        '-lc',
        `
          set -euo pipefail
          export ENV_FILE="${envFile}"
          export BACKEND_REAL_STATE_DIR="${backendRealRoot}"
          export RUNTIME_LINES_ROOT="${runtimeLinesRoot}"
          source "${repoRoot}/scripts/local-manual/common.sh"
          printf 'state=%s\\n' "$(local_manual_platform_ready_state)"
          if local_manual_platform_is_ready; then
            printf 'is_ready=yes\\n'
          else
            printf 'is_ready=no\\n'
          fi
        `,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env },
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );

    const state = output.match(/^state=(.+)$/m)?.[1]?.trim() ?? '';
    const isReady = output.match(/^is_ready=(.+)$/m)?.[1]?.trim() ?? '';
    return { state, isReady };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('local-manual platform readiness', () => {
  it('treats substrate proxy readiness as part of the same platform truth even when proxy.ready is outside local-manual', () => {
    const readiness = runPlatformReadiness({
      apiReady: true,
      webReady: true,
      proxyReady: true,
    });

    expect(readiness.state).toBe('ready');
    expect(readiness.isReady).toBe('yes');
  });

  it('reports which readiness markers are missing when the shared platform is incomplete', () => {
    const readiness = runPlatformReadiness({
      apiReady: true,
      webReady: false,
      proxyReady: false,
    });

    expect(readiness.state).toBe('missing:web,proxy');
    expect(readiness.isReady).toBe('no');
  });

  it('does not let tracked web/api pid files keep the platform ready after stop-line cleared their readiness markers', () => {
    const readiness = runPlatformReadiness({
      apiReady: false,
      webReady: false,
      proxyReady: true,
      apiPid: '5100',
      webPid: '6100',
    });

    expect(readiness.state).toBe('missing:api,web');
    expect(readiness.isReady).toBe('no');
  });
});
