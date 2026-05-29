import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function runBashResult(script: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('bash', ['-lc', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  return {
    status: result.status ?? 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function registryHarness(
  tempRoot: string,
  options: {
    imageInspectStatus: number;
    explicitArchive?: string;
    pullStatus?: number;
    releaseRoot?: string;
  },
): { status: number; stdout: string; stderr: string } {
  const commonScript = path.join(process.cwd(), 'scripts/scenarios/common.sh');
  const dockerLogPath = path.join(tempRoot, 'docker.log');
  const releaseRootSetup = options.releaseRoot === undefined
    ? 'unset RELEASE_ROOT'
    : `RELEASE_ROOT="${options.releaseRoot}"`;
  const explicitArchiveSetup = options.explicitArchive === undefined
    ? 'unset LOCAL_KIND_REGISTRY_IMAGE_ARCHIVE'
    : `LOCAL_KIND_REGISTRY_IMAGE_ARCHIVE="${options.explicitArchive}"`;
  const pullStatus = options.pullStatus ?? 0;

  return runBashResult(`
    source "${commonScript}"
    scenario_release_tool_path() {
      if [[ "$1" == "kubectl" ]]; then
        printf 'kubectl\\n'
        return 0
      fi
      return 1
    }
    docker() {
      printf '%s\\n' "$*" >> "${dockerLogPath}"
      if [[ "$1" == "image" && "$2" == "inspect" ]]; then
        return ${options.imageInspectStatus}
      fi
      if [[ "$1" == "pull" ]]; then
        return ${pullStatus}
      fi
      return 0
    }
    curl() {
      printf 'curl %s\\n' "$*" >> "${dockerLogPath}"
      return 0
    }
    kubectl() {
      printf 'kubectl KUBECONFIG=%s %s\\n' "\${KUBECONFIG:-}" "$*" >> "${dockerLogPath}"
      cat >/dev/null
      return 0
    }
    HOME="${tempRoot}"
    ${releaseRootSetup}
    ${explicitArchiveSetup}
    set +e
    ensure_local_kind_registry
    status=$?
    set -e
    printf 'status=%s\\n' "$status"
    [[ ! -f "${dockerLogPath}" ]] || cat "${dockerLogPath}"
  `);
}

describe('scenario local kind registry image bootstrap', () => {
  it('reuses a present local registry image without pulling or loading', () => {
    const tempRoot = mkdtempForRegistry('scenario-kind-registry-local-');
    const releaseRoot = path.join(tempRoot, 'release');
    const explicitArchive = path.join(tempRoot, 'explicit', 'missing-registry.tar');

    const result = registryHarness(tempRoot, {
      imageInspectStatus: 0,
      explicitArchive,
      releaseRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('status=0');
    expect(result.stdout).toContain('image inspect registry:2');
    expect(result.stdout).not.toContain('pull registry:2');
    expect(result.stdout).not.toContain('load -i');
    expect(result.stdout).toContain('run -d --restart=always -p 127.0.0.1:5001:5000 --name kind-registry registry:2');
    expect(result.stdout).toContain('network connect kind kind-registry');
    expect(result.stdout).toContain('curl -fsS http://127.0.0.1:5001/v2/_catalog');
    expect(result.stdout).toContain('kubectl KUBECONFIG=');
    expect(result.stdout).toContain('apply -f -');
  });

  it('loads an explicit registry image archive before considering RELEASE_ROOT', () => {
    const tempRoot = mkdtempForRegistry('scenario-kind-registry-explicit-archive-');
    const explicitArchive = path.join(tempRoot, 'explicit', 'registry.tar');
    const releaseRoot = path.join(tempRoot, 'release');
    const releaseArchive = path.join(releaseRoot, 'images', 'registry-2.tar');
    mkdirSync(path.dirname(explicitArchive), { recursive: true });
    mkdirSync(path.dirname(releaseArchive), { recursive: true });
    writeFileSync(explicitArchive, 'fake explicit registry archive\n');
    writeFileSync(releaseArchive, 'fake release registry archive\n');

    const result = registryHarness(tempRoot, {
      imageInspectStatus: 1,
      explicitArchive,
      releaseRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('status=0');
    expect(result.stdout).toContain('image inspect registry:2');
    expect(result.stdout).toContain(`load -i ${explicitArchive}`);
    expect(result.stdout).not.toContain(`load -i ${releaseArchive}`);
    expect(result.stdout).not.toContain('pull registry:2');
    expect(result.stdout).toContain('run -d --restart=always -p 127.0.0.1:5001:5000 --name kind-registry registry:2');
  });

  it('fails fast when an explicit registry image archive is missing without falling back', () => {
    const tempRoot = mkdtempForRegistry('scenario-kind-registry-explicit-missing-');
    const explicitArchive = path.join(tempRoot, 'explicit', 'missing-registry.tar');
    const releaseRoot = path.join(tempRoot, 'release');
    const releaseArchive = path.join(releaseRoot, 'images', 'registry-2.tar');
    mkdirSync(path.dirname(releaseArchive), { recursive: true });
    writeFileSync(releaseArchive, 'fake release registry archive\n');

    const result = registryHarness(tempRoot, {
      imageInspectStatus: 1,
      explicitArchive,
      releaseRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('status=1');
    expect(result.stdout).toContain('image inspect registry:2');
    expect(result.stdout).not.toContain(`load -i ${releaseArchive}`);
    expect(result.stdout).not.toContain('pull registry:2');
    expect(result.stdout).not.toContain('run -d --restart=always');
    expect(result.stderr).toContain(
      `[scenario-kind] ERROR: missing explicit registry image archive ${explicitArchive} for registry:2`,
    );
  });

  it('loads the bundled registry image when RELEASE_ROOT provides the archive', () => {
    const tempRoot = mkdtempForRegistry('scenario-kind-registry-release-');
    const releaseRoot = path.join(tempRoot, 'release');
    const archivePath = path.join(releaseRoot, 'images', 'registry-2.tar');
    mkdirSync(path.dirname(archivePath), { recursive: true });
    writeFileSync(archivePath, 'fake registry archive\n');

    const result = registryHarness(tempRoot, {
      imageInspectStatus: 1,
      releaseRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('status=0');
    expect(result.stdout).toContain('image inspect registry:2');
    expect(result.stdout).toContain(`load -i ${archivePath}`);
    expect(result.stdout).not.toContain('pull registry:2');
    expect(result.stdout).toContain('run -d --restart=always -p 127.0.0.1:5001:5000 --name kind-registry registry:2');
  });

  it('fails fast on a missing bundled registry image when RELEASE_ROOT is set', () => {
    const tempRoot = mkdtempForRegistry('scenario-kind-registry-missing-release-');
    const releaseRoot = path.join(tempRoot, 'release');
    mkdirSync(path.join(releaseRoot, 'images'), { recursive: true });

    const result = registryHarness(tempRoot, {
      imageInspectStatus: 1,
      releaseRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('status=1');
    expect(result.stdout).toContain('image inspect registry:2');
    expect(result.stdout).not.toContain('pull registry:2');
    expect(result.stdout).not.toContain('load -i');
    expect(result.stdout).not.toContain('run -d --restart=always');
    expect(result.stderr).toContain('[scenario-kind] ERROR: missing bundled registry image registry:2');
  });

  it('pulls the registry image online when RELEASE_ROOT is not configured', () => {
    const tempRoot = mkdtempForRegistry('scenario-kind-registry-online-');

    const result = registryHarness(tempRoot, {
      imageInspectStatus: 1,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('status=0');
    expect(result.stdout).toContain('image inspect registry:2');
    expect(result.stdout).toContain('pull registry:2');
    expect(result.stdout).not.toContain('load -i');
    expect(result.stdout).toContain('run -d --restart=always -p 127.0.0.1:5001:5000 --name kind-registry registry:2');
  });

  it('fails clearly when the online registry image pull fails', () => {
    const tempRoot = mkdtempForRegistry('scenario-kind-registry-pull-fail-');

    const result = registryHarness(tempRoot, {
      imageInspectStatus: 1,
      pullStatus: 42,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('status=1');
    expect(result.stdout).toContain('image inspect registry:2');
    expect(result.stdout).toContain('pull registry:2');
    expect(result.stdout).not.toContain('load -i');
    expect(result.stdout).not.toContain('run -d --restart=always');
    expect(result.stderr).toContain('[scenario-kind] ERROR: failed to pull registry image registry:2');
  });
});

function mkdtempForRegistry(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}
