import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function stageClusterLibFixture(tempRoot: string): void {
  const libPath = path.join(repoRoot, 'scripts', 'cluster-deploy', 'lib.sh');
  const stagedLibPath = path.join(tempRoot, 'scripts', 'cluster-deploy', 'lib.sh');
  mkdirSync(path.dirname(stagedLibPath), { recursive: true });
  copyFileSync(libPath, stagedLibPath);

  mkdirSync(path.join(tempRoot, 'scripts', 'lib'), { recursive: true });
  writeFileSync(
    path.join(tempRoot, 'scripts', 'lib', 'deploy-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
DEPLOY_ROOT="\${DEPLOY_ROOT:-${tempRoot}/cluster-deploy}"
CONFIG_DIR="\${CONFIG_DIR:-\${DEPLOY_ROOT}/config}"
CURRENT_LINK="\${DEPLOY_ROOT}/current"
RELEASE_ROOT="\${RELEASE_ROOT:-${tempRoot}/release}"
SHARED_SITE_ENV="\${CONFIG_DIR}/site.env"
ensure_dirs() { mkdir -p "\${DEPLOY_ROOT}" "\${CONFIG_DIR}"; }
log() { printf '[cluster-test] %s\\n' "$*"; }
die() { printf '[cluster-test] ERROR: %s\\n' "$*" >&2; exit 1; }
`,
    'utf8',
  );

  mkdirSync(path.join(tempRoot, 'release', 'images'), { recursive: true });
  writeFileSync(path.join(tempRoot, 'release', 'images', 'example.tar'), 'tarball', 'utf8');

  const binDir = path.join(tempRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${tempRoot}/docker.log"
exit 0
`,
    { encoding: 'utf8', mode: 0o755 },
  );
}

function runClusterLoadBundledImages(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        export PATH="${path.join(tempRoot, 'bin')}:$PATH"
        export ROOT_DIR="${tempRoot}"
        export RELEASE_ROOT="${path.join(tempRoot, 'release')}"
        source "${path.join(tempRoot, 'scripts', 'cluster-deploy', 'lib.sh')}"
        load_bundled_images
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

describe('cluster deploy bundled image loading', () => {
  it('loads bundled images by default', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-lib-load-'));
    try {
      stageClusterLibFixture(tempRoot);
      runClusterLoadBundledImages(tempRoot);
      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      expect(dockerLog).toContain('load -i');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips bundled image reload when SKIP_BUNDLED_IMAGE_LOAD=1', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-lib-skip-load-'));
    try {
      stageClusterLibFixture(tempRoot);
      unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
      runClusterLoadBundledImages(tempRoot, { SKIP_BUNDLED_IMAGE_LOAD: '1' });
      expect(existsSync(path.join(tempRoot, 'docker.log'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
