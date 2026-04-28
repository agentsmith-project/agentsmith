import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateBuildSkipDecision } from '../governance/build-artifact-broker';

const repoRoot = process.cwd();
const APP_BASE_DIGEST = `sha256:${'a'.repeat(64)}`;
const APP_MC_DIGEST = `sha256:${'f'.repeat(64)}`;
const LLMUP_RUST_BASE_DIGEST = `sha256:${'b'.repeat(64)}`;
const LLMUP_RUNTIME_BASE_DIGEST = `sha256:${'c'.repeat(64)}`;
const APP_IMAGE_DIGEST = `sha256:${'d'.repeat(64)}`;
const LLMUP_IMAGE_DIGEST = `sha256:${'e'.repeat(64)}`;

function writeFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function writeExecutable(filePath: string, content: string): void {
  writeFile(filePath, content);
  chmodSync(filePath, 0o755);
}

function writeRawBuildBaseImagesLock(tempRoot: string, content: string): void {
  writeFile(path.join(tempRoot, 'infra', 'deploy', 'shared', 'build-base-images.lock'), content);
}

function writeBuildBaseImagesLock(
  tempRoot: string,
  entries: Readonly<Record<string, string>> = {
    app_node_base_image: `node:24.14.1-bookworm@${APP_BASE_DIGEST}`,
    app_mc_image: `minio/mc:RELEASE.2025-08-13T08-35-41Z@${APP_MC_DIGEST}`,
    llmup_rust_base_image: `rust:1.88-bookworm@${LLMUP_RUST_BASE_DIGEST}`,
    llmup_runtime_base_image: `debian:bookworm-slim@${LLMUP_RUNTIME_BASE_DIGEST}`,
  },
): void {
  writeRawBuildBaseImagesLock(
    tempRoot,
    [
      '# AgentSmith cluster build base/dependency image lock.',
      ...Object.entries(entries).map(([id, ref]) => `${id}=${ref}`),
      '',
    ].join('\n'),
  );
}

function stageBuildImagesFixture(tempRoot: string): void {
  copyFileToFixture('scripts/cluster-deploy/build-images.sh', tempRoot);
  copyFileToFixture('scripts/governance/build-artifact-broker.ts', tempRoot);
  copyFileToFixture('scripts/governance/build-artifact-broker-cli.ts', tempRoot);
  copyFileToFixture('scripts/governance/current-build-artifact-broker-schema.ts', tempRoot);
  writeBuildBaseImagesLock(tempRoot);

  writeFile(
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'lib.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
log() { printf '[cluster-build-images-test] %s\\n' "$*"; }
die() { printf '[cluster-build-images-test] ERROR: %s\\n' "$*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }
ensure_operator_registry_env() { mkdir -p "\${RELEASE_ROOT}/env"; }
load_registry_env() {
  export REGISTRY_HOST="\${REGISTRY_HOST:-localhost:5001}"
  export REGISTRY_PROJECT="\${REGISTRY_PROJECT:-mbos}"
  export K8S_REGISTRY_HOST="\${K8S_REGISTRY_HOST:-kind-registry:5000}"
}
`,
  );
  writeFile(
    path.join(tempRoot, 'scripts', 'lib', 'docker-buildx-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
docker_build_local() {
  printf 'docker_build_local %s\\n' "$*" >> "\${RELEASE_ROOT}/build-images-docker.log"
}
`,
  );
  writeFile(
    path.join(tempRoot, 'scripts', 'lib', 'runner-image-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
runner_release_base_image() { printf 'agentsmith-%s-runner-base:%s\\n' "$1" "$2"; }
runner_release_image() { printf '%s/agentsmith-%s-runner:%s\\n' "$3" "$1" "$2"; }
build_runner_image() {
  printf 'build_runner_image %s %s %s\\n' "$1" "$2" "$3" >> "\${RELEASE_ROOT}/build-images-docker.log"
}
`,
  );

  writeFile(path.join(tempRoot, 'release', 'env', 'registry.env'), 'REGISTRY_HOST=localhost:5001\nREGISTRY_PROJECT=mbos\n');
  writeFile(path.join(tempRoot, 'release', 'sources', 'agentsmith', 'package.json'), '{"name":"agentsmith"}\n');
  writeFile(path.join(tempRoot, 'release', 'sources', 'agentsmith', 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFile(path.join(tempRoot, 'release', 'sources', 'agentsmith', 'next.config.ts'), 'export default {};\n');
  writeFile(path.join(tempRoot, 'release', 'sources', 'agentsmith', 'src', 'app', 'page.tsx'), 'export default null;\n');
  writeFile(
    path.join(tempRoot, 'release', 'sources', 'agentsmith', 'infra', 'deploy', 'Dockerfile.agentsmith-app'),
    'FROM app-base\n',
  );
  writeFile(
    path.join(tempRoot, 'release', 'sources', 'agentsmith', 'infra', 'deploy', 'Dockerfile.agentsmith-app-base'),
    'FROM node\n',
  );
  writeFile(
    path.join(tempRoot, 'release', 'sources', 'agentsmith', 'infra', 'deploy', 'Dockerfile.agentsmith-verify-runner'),
    'FROM verify-base\n',
  );
  writeFile(
    path.join(
      tempRoot,
      'release',
      'sources',
      'agentsmith',
      'infra',
      'deploy',
      'Dockerfile.agentsmith-verify-runner-base',
    ),
    'FROM playwright\n',
  );
  writeFile(path.join(tempRoot, 'release', 'sources', 'llm-universal-proxy', 'Cargo.toml'), '[package]\n');
  writeFile(path.join(tempRoot, 'release', 'sources', 'llm-universal-proxy', 'Cargo.lock'), '# lock\n');
  writeFile(path.join(tempRoot, 'release', 'sources', 'llm-universal-proxy', 'src', 'main.rs'), 'fn main() {}\n');
  writeFile(path.join(tempRoot, 'release', 'sources', 'llm-universal-proxy', 'Dockerfile'), 'FROM rust\n');
  writeFile(path.join(tempRoot, 'release', 'sources', 'mbos-sandbox-v1', 'manager-service', 'Dockerfile'), 'FROM golang\n');

  writeExecutable(
    path.join(tempRoot, 'bin', 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> "\${RELEASE_ROOT}/build-images-docker.log"
if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
  image="\${@: -1}"
  case "\${image}" in
    *agentsmith-app*) printf '%s\\n' '${APP_IMAGE_DIGEST}' ;;
    *llm-universal-proxy*) printf '%s\\n' '${LLMUP_IMAGE_DIGEST}' ;;
    *) exit 0 ;;
  esac
  exit 0
fi
exit 0
`,
  );
}

function writeContentRefProbeDockerMock(tempRoot: string, options: { matchLabels: boolean }): void {
  const mismatchDigest = `sha256:${'0'.repeat(64)}`;

  writeExecutable(
    path.join(tempRoot, 'bin', 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> "\${RELEASE_ROOT}/build-images-docker.log"
if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
  format=""
  if [[ "\${3:-}" == "--format" ]]; then
    format="\${4:-}"
  fi
  image="\${@: -1}"
  target=""
  digest=""
  case "\${image}" in
    *agentsmith-app*) target="app"; digest="${APP_IMAGE_DIGEST}" ;;
    *llm-universal-proxy*) target="llmup"; digest="${LLMUP_IMAGE_DIGEST}" ;;
    *) exit 0 ;;
  esac

  if [[ "\${format}" == *"com.agentsmith.build.input_digest"* ]]; then
    node - "\${RELEASE_ROOT}/build-artifact-broker-plan.json" "\${target}" "\${digest}" "${options.matchLabels ? '1' : '0'}" <<'NODE'
const fs = require('node:fs');

const [planPath, target, digest, matchLabels] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const entry = plan.targets.find((candidate) => candidate.target === target);

if (!entry) {
  process.exit(1);
}

process.stdout.write([
  digest,
  entry.input_digest,
  matchLabels === '1' ? entry.base_image_digest : '${mismatchDigest}',
  entry.content_key,
  entry.target,
  entry.producer.name,
  'release-from-previous-build',
].join('\\n') + '\\n');
NODE
  else
    printf '%s\\n' "\${digest}"
  fi
  exit 0
fi
exit 0
`,
  );
}

function copyFileToFixture(relativePath: string, tempRoot: string): void {
  const targetPath = path.join(tempRoot, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  copyFileSync(path.join(repoRoot, relativePath), targetPath);
}

function runBuildImages(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync('bash', [path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-images.sh')], {
    cwd: tempRoot,
    env: {
      ...process.env,
      PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
      HOME: tempRoot,
      DEPLOY_ROOT: path.join(tempRoot, 'deploy'),
      RELEASE_ROOT: path.join(tempRoot, 'release'),
      RELEASE_ID: 'release-20260427',
      BUILD_ARTIFACT_BROKER_TSX_COMMAND: path.join(repoRoot, 'node_modules', '.bin', 'tsx'),
      BUILD_ARTIFACT_BROKER_GENERATED_AT: '2026-04-27T12:00:00.000Z',
      BUILD_ARTIFACT_BROKER_RUN_ID: 'cluster-build-images-test',
      ...extraEnv,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function runBuildImagesResult(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('bash', [path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-images.sh')], {
    cwd: tempRoot,
    env: {
      ...process.env,
      PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
      HOME: tempRoot,
      DEPLOY_ROOT: path.join(tempRoot, 'deploy'),
      RELEASE_ROOT: path.join(tempRoot, 'release'),
      RELEASE_ID: 'release-20260427',
      BUILD_ARTIFACT_BROKER_TSX_COMMAND: path.join(repoRoot, 'node_modules', '.bin', 'tsx'),
      BUILD_ARTIFACT_BROKER_GENERATED_AT: '2026-04-27T12:00:00.000Z',
      BUILD_ARTIFACT_BROKER_RUN_ID: 'cluster-build-images-test',
      ...extraEnv,
    },
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readNdjson(filePath: string): unknown[] {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split(/\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

describe('cluster build-images build artifact broker integration', () => {
  it('builds app and llmup final images with content tags, labels them, and writes release aliases to VERSION', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-content-tags-'));

    try {
      stageBuildImagesFixture(tempRoot);

      runBuildImages(tempRoot, { RELEASE_ID: 'test-release' });

      const releaseRoot = path.join(tempRoot, 'release');
      const plan = readJson(path.join(releaseRoot, 'build-artifact-broker-plan.json')) as {
        targets: Array<{
          target: string;
          content_key: string;
          content_ref: string;
          release_alias_ref: string;
          input_digest: string;
          base_image_digest: string;
        }>;
      };
      const appTarget = plan.targets.find((target) => target.target === 'app');
      const llmupTarget = plan.targets.find((target) => target.target === 'llmup');

      expect(appTarget).toBeDefined();
      expect(llmupTarget).toBeDefined();
      expect(appTarget?.content_ref).toMatch(/^localhost:5001\/mbos\/agentsmith-app:ck-[a-f0-9]{32}$/u);
      expect(appTarget?.release_alias_ref).toBe('localhost:5001/mbos/agentsmith-app:release-test-release');
      expect(llmupTarget?.content_ref).toMatch(
        /^localhost:5001\/mbos\/llm-universal-proxy:ck-[a-f0-9]{32}$/u,
      );
      expect(llmupTarget?.release_alias_ref).toBe(
        'localhost:5001/mbos/llm-universal-proxy:release-test-release',
      );

      const versionContent = readFileSync(path.join(releaseRoot, 'VERSION'), 'utf8');
      const dockerLog = readFileSync(path.join(releaseRoot, 'build-images-docker.log'), 'utf8');

      expect(versionContent).toContain('release_id=test-release');
      expect(versionContent).toContain(`agentsmith_app_image=${appTarget?.release_alias_ref}`);
      expect(versionContent).toContain(`llm_universal_proxy_image=${llmupTarget?.release_alias_ref}`);
      expect(versionContent).not.toContain('agentsmith_app_image=localhost:5001/mbos/agentsmith-app:test-release');
      expect(versionContent).not.toContain(
        'llm_universal_proxy_image=localhost:5001/mbos/llm-universal-proxy:test-release',
      );

      expect(dockerLog).toContain(`-t ${appTarget?.content_ref}`);
      expect(dockerLog).toContain(`docker tag ${appTarget?.content_ref} ${appTarget?.release_alias_ref}`);
      expect(dockerLog).toContain(`--label com.agentsmith.build.input_digest=${appTarget?.input_digest}`);
      expect(dockerLog).toContain(`--label com.agentsmith.build.base_image_digest=${appTarget?.base_image_digest}`);
      expect(dockerLog).toContain(`--label com.agentsmith.build.content_key=${appTarget?.content_key}`);
      expect(dockerLog).toContain('--label com.agentsmith.build.release_id=test-release');
      expect(dockerLog).toContain('--label com.agentsmith.build.target=app');
      expect(dockerLog).toContain('--label com.agentsmith.build.producer=build-artifact-broker');

      expect(dockerLog).toContain(`-t ${llmupTarget?.content_ref}`);
      expect(dockerLog).toContain(`docker tag ${llmupTarget?.content_ref} ${llmupTarget?.release_alias_ref}`);
      expect(dockerLog).toContain(`--label com.agentsmith.build.input_digest=${llmupTarget?.input_digest}`);
      expect(dockerLog).toContain(`--label com.agentsmith.build.base_image_digest=${llmupTarget?.base_image_digest}`);
      expect(dockerLog).toContain(`--label com.agentsmith.build.content_key=${llmupTarget?.content_key}`);
      expect(dockerLog).toContain('--label com.agentsmith.build.target=llmup');
      expect(dockerLog).toContain('--label com.agentsmith.build.producer=build-artifact-broker');

      expect(existsSync(path.join(releaseRoot, 'build-manifest.json'))).toBe(true);
      expect(existsSync(path.join(releaseRoot, 'build-artifact-broker-report.json'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('reuses local content refs for app and llmup final docker builds when required labels and digests match', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-content-ref-skip-'));

    try {
      stageBuildImagesFixture(tempRoot);
      writeContentRefProbeDockerMock(tempRoot, { matchLabels: true });

      runBuildImages(tempRoot, { RELEASE_ID: 'test-release' });

      const releaseRoot = path.join(tempRoot, 'release');
      const plan = readJson(path.join(releaseRoot, 'build-artifact-broker-plan.json')) as {
        targets: Array<{
          target: string;
          content_ref: string;
          release_alias_ref: string;
          input_digest: string;
        }>;
      };
      const manifest = readJson(path.join(releaseRoot, 'build-manifest.json')) as {
        targets: Array<{ target: string; decision: string }>;
      };
      const dockerLog = readFileSync(path.join(releaseRoot, 'build-images-docker.log'), 'utf8');
      const dockerLogLines = dockerLog.split(/\n/u);
      const appTarget = plan.targets.find((target) => target.target === 'app');
      const llmupTarget = plan.targets.find((target) => target.target === 'llmup');

      expect(appTarget).toBeDefined();
      expect(llmupTarget).toBeDefined();
      expect(dockerLogLines.some((line) => line.includes('docker_build_local') && line.includes(`-t ${appTarget?.content_ref}`)))
        .toBe(false);
      expect(dockerLogLines.some((line) => line.includes('docker_build_local') && line.includes(`-t ${llmupTarget?.content_ref}`)))
        .toBe(false);
      expect(dockerLog).toContain(`docker tag ${appTarget?.content_ref} ${appTarget?.release_alias_ref}`);
      expect(dockerLog).toContain(`docker tag ${llmupTarget?.content_ref} ${llmupTarget?.release_alias_ref}`);

      const skipDecisions = readNdjson(path.join(releaseRoot, 'skip-decisions.ndjson')) as Array<{
        target: string;
        operation: string;
        input_digest: string;
        existing_artifact_digest: string;
        skip_reason: string;
        validator: string;
        generated_at: string;
        status?: string;
        verdict?: string;
        reusable?: boolean;
      }>;
      const decisionsByTarget = Object.fromEntries(skipDecisions.map((decision) => [decision.target, decision]));
      const manifestDecisionsByTarget = Object.fromEntries(
        manifest.targets.map((target) => [target.target, target.decision]),
      );

      expect(skipDecisions).toHaveLength(2);
      for (const decision of skipDecisions) {
        expect(validateBuildSkipDecision(decision).ok).toBe(true);
        expect(decision.operation).toBe('docker_build');
        expect(decision.skip_reason).toBe('local_content_ref_labels_match');
        expect(decision.validator).toBe('build-images.sh local content_ref label probe');
        expect(decision.generated_at).toBe('2026-04-27T12:00:00.000Z');
        expect(decision.status).toBeUndefined();
        expect(decision.verdict).toBeUndefined();
        expect(decision.reusable).toBeUndefined();
      }
      expect(decisionsByTarget.app).toMatchObject({
        input_digest: appTarget?.input_digest,
        existing_artifact_digest: APP_IMAGE_DIGEST,
      });
      expect(decisionsByTarget.llmup).toMatchObject({
        input_digest: llmupTarget?.input_digest,
        existing_artifact_digest: LLMUP_IMAGE_DIGEST,
      });
      expect(manifestDecisionsByTarget).toMatchObject({
        app: 'reused',
        llmup: 'reused',
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('forces app and llmup final docker builds and does not write docker_build skip decisions when FORCE_REBUILD is set', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-force-rebuild-'));

    try {
      stageBuildImagesFixture(tempRoot);
      writeContentRefProbeDockerMock(tempRoot, { matchLabels: true });

      runBuildImages(tempRoot, { FORCE_REBUILD: '1', RELEASE_ID: 'test-release' });

      const releaseRoot = path.join(tempRoot, 'release');
      const plan = readJson(path.join(releaseRoot, 'build-artifact-broker-plan.json')) as {
        targets: Array<{ target: string; content_ref: string }>;
      };
      const manifest = readJson(path.join(releaseRoot, 'build-manifest.json')) as {
        targets: Array<{ target: string; decision: string }>;
      };
      const dockerLogLines = readFileSync(path.join(releaseRoot, 'build-images-docker.log'), 'utf8').split(/\n/u);
      const appTarget = plan.targets.find((target) => target.target === 'app');
      const llmupTarget = plan.targets.find((target) => target.target === 'llmup');
      const manifestDecisionsByTarget = Object.fromEntries(
        manifest.targets.map((target) => [target.target, target.decision]),
      );

      expect(dockerLogLines.some((line) => line.includes('docker_build_local') && line.includes(`-t ${appTarget?.content_ref}`)))
        .toBe(true);
      expect(dockerLogLines.some((line) => line.includes('docker_build_local') && line.includes(`-t ${llmupTarget?.content_ref}`)))
        .toBe(true);
      expect(existsSync(path.join(releaseRoot, 'skip-decisions.ndjson'))).toBe(false);
      expect(manifestDecisionsByTarget).toMatchObject({
        app: 'built',
        llmup: 'built',
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed to final docker builds when a local content ref label does not match the prebuild plan', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-label-mismatch-'));

    try {
      stageBuildImagesFixture(tempRoot);
      writeContentRefProbeDockerMock(tempRoot, { matchLabels: false });

      runBuildImages(tempRoot, { RELEASE_ID: 'test-release' });

      const releaseRoot = path.join(tempRoot, 'release');
      const plan = readJson(path.join(releaseRoot, 'build-artifact-broker-plan.json')) as {
        targets: Array<{ target: string; content_ref: string }>;
      };
      const manifest = readJson(path.join(releaseRoot, 'build-manifest.json')) as {
        targets: Array<{ target: string; decision: string }>;
      };
      const dockerLogLines = readFileSync(path.join(releaseRoot, 'build-images-docker.log'), 'utf8').split(/\n/u);
      const appTarget = plan.targets.find((target) => target.target === 'app');
      const llmupTarget = plan.targets.find((target) => target.target === 'llmup');
      const manifestDecisionsByTarget = Object.fromEntries(
        manifest.targets.map((target) => [target.target, target.decision]),
      );

      expect(dockerLogLines.some((line) => line.includes('docker_build_local') && line.includes(`-t ${appTarget?.content_ref}`)))
        .toBe(true);
      expect(dockerLogLines.some((line) => line.includes('docker_build_local') && line.includes(`-t ${llmupTarget?.content_ref}`)))
        .toBe(true);
      expect(existsSync(path.join(releaseRoot, 'skip-decisions.ndjson'))).toBe(false);
      expect(manifestDecisionsByTarget).toMatchObject({
        app: 'built',
        llmup: 'built',
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed before final app and llmup builds when the prebuild plan cannot trust the llmup Dockerfile', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-plan-fail-closed-'));

    try {
      stageBuildImagesFixture(tempRoot);
      writeFile(
        path.join(tempRoot, 'release', 'sources', 'llm-universal-proxy', 'Dockerfile'),
        'FROM rust\nCOPY tests ./tests\nCOPY src ./src\n',
      );

      const result = runBuildImagesResult(tempRoot, { RELEASE_ID: 'test-release' });
      const releaseRoot = path.join(tempRoot, 'release');
      const reportPath = path.join(releaseRoot, 'build-artifact-broker-report.json');

      expect(result.status).not.toBe(0);
      expect(existsSync(path.join(releaseRoot, 'VERSION'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-manifest.json'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-artifact-broker-plan.json'))).toBe(false);
      expect(existsSync(reportPath)).toBe(true);
      expect(JSON.stringify(readJson(reportPath))).toContain('llmup_runtime_tests_copy_present');
      expect(existsSync(path.join(releaseRoot, 'build-images-docker.log'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed after Docker build when the post-build digest probe cannot verify a final image', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-digest-probe-fail-'));

    try {
      stageBuildImagesFixture(tempRoot);
      writeExecutable(
        path.join(tempRoot, 'bin', 'docker'),
        `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> "\${RELEASE_ROOT}/build-images-docker.log"
if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
  image="\${@: -1}"
  case "\${image}" in
    *agentsmith-app*) printf '%s\\n' '${APP_IMAGE_DIGEST}' ;;
    *llm-universal-proxy*) exit 1 ;;
    *) exit 0 ;;
  esac
  exit 0
fi
exit 0
`,
      );

      const result = runBuildImagesResult(tempRoot, { RELEASE_ID: 'test-release' });
      const releaseRoot = path.join(tempRoot, 'release');
      const reportPath = path.join(releaseRoot, 'build-artifact-broker-report.json');
      const dockerLog = readFileSync(path.join(releaseRoot, 'build-images-docker.log'), 'utf8');

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('build artifact broker manifest gate failed');
      expect(existsSync(path.join(releaseRoot, 'build-manifest.json'))).toBe(false);
      expect(existsSync(reportPath)).toBe(true);
      expect(JSON.stringify(readJson(reportPath))).toContain('missing_image_digest');
      expect(JSON.stringify(readJson(reportPath))).toContain('llmup');
      expect(dockerLog).toContain('docker tag');
      expect(result.stdout).not.toContain('build-images ok');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the post-build broker writes a diagnostic report and exits 42', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-postbuild-broker-42-'));
    const fakeBrokerRunner = path.join(tempRoot, 'bin', 'broker-runner');

    try {
      stageBuildImagesFixture(tempRoot);
      writeExecutable(
        fakeBrokerRunner,
        `#!/usr/bin/env bash
set -euo pipefail
broker_cli="$1"
shift
for arg in "$@"; do
  if [[ "\${arg}" == "--artifact-kind" ]]; then
    exec "${path.join(repoRoot, 'node_modules', '.bin', 'tsx')}" "\${broker_cli}" "$@"
  fi
done
cat > "\${RELEASE_ROOT}/build-artifact-broker-report.json" <<'JSON'
{
  "report_kind": "build_artifact_broker_diagnostic",
  "diagnostics": [
    {
      "reason_code": "release_id_truth_failure",
      "path": "VERSION.release_id",
      "message": "forced post-build release truth diagnostic"
    }
  ]
}
JSON
rm -f "\${RELEASE_ROOT}/build-manifest.json"
exit 42
`,
      );

      const result = runBuildImagesResult(tempRoot, {
        BUILD_ARTIFACT_BROKER_TSX_COMMAND: fakeBrokerRunner,
      });
      const releaseRoot = path.join(tempRoot, 'release');

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('build artifact broker manifest gate failed with exit 42');
      expect(existsSync(path.join(releaseRoot, 'build-manifest.json'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-artifact-broker-report.json'))).toBe(true);
      expect(result.stdout).not.toContain('build-images ok');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses repo locked base image refs by default and writes them to VERSION', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-manifest-'));

    try {
      stageBuildImagesFixture(tempRoot);

      runBuildImages(tempRoot);

      const releaseRoot = path.join(tempRoot, 'release');
      const manifest = readJson(path.join(releaseRoot, 'build-manifest.json')) as {
        release_id: string;
        targets: Array<{ target: string }>;
      };

      const versionContent = readFileSync(path.join(releaseRoot, 'VERSION'), 'utf8');

      expect(versionContent).toContain('release_id=release-20260427');
      expect(versionContent).toContain(`app_node_base_image_ref=node:24.14.1-bookworm@${APP_BASE_DIGEST}`);
      expect(versionContent).toContain(
        `app_mc_image_ref=minio/mc:RELEASE.2025-08-13T08-35-41Z@${APP_MC_DIGEST}`,
      );
      expect(versionContent).toContain(`llmup_rust_base_image_ref=rust:1.88-bookworm@${LLMUP_RUST_BASE_DIGEST}`);
      expect(versionContent).toContain(
        `llmup_runtime_base_image_ref=debian:bookworm-slim@${LLMUP_RUNTIME_BASE_DIGEST}`,
      );
      expect(existsSync(path.join(releaseRoot, 'build-artifact-broker-report.json'))).toBe(false);
      expect(manifest.release_id).toBe('release-20260427');
      expect(manifest.targets.map((target) => target.target)).toEqual(['app', 'llmup']);
      const dockerLog = readFileSync(path.join(releaseRoot, 'build-images-docker.log'), 'utf8');
      expect(dockerLog).toContain('docker_build_local');
      expect(dockerLog).toContain(
        `--build-arg MC_IMAGE=minio/mc:RELEASE.2025-08-13T08-35-41Z@${APP_MC_DIGEST}`,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the repo lock is missing a required default base image entry', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-missing-lock-entry-'));

    try {
      stageBuildImagesFixture(tempRoot);
      writeBuildBaseImagesLock(tempRoot, {
        app_node_base_image: `node:24.14.1-bookworm@${APP_BASE_DIGEST}`,
        app_mc_image: `minio/mc:RELEASE.2025-08-13T08-35-41Z@${APP_MC_DIGEST}`,
        llmup_rust_base_image: `rust:1.88-bookworm@${LLMUP_RUST_BASE_DIGEST}`,
      });

      const result = runBuildImagesResult(tempRoot);
      const releaseRoot = path.join(tempRoot, 'release');

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('missing required build base image lock entry: llmup_runtime_base_image');
      expect(existsSync(path.join(releaseRoot, 'VERSION'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-manifest.json'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-artifact-broker-report.json'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when a missing repo lock entry has a pinned explicit override', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-missing-lock-with-override-'));
    const mirroredMcImage = `mirror.local/minio/mc:RELEASE.2025-08-13T08-35-41Z@${APP_MC_DIGEST}`;

    try {
      stageBuildImagesFixture(tempRoot);
      writeBuildBaseImagesLock(tempRoot, {
        app_node_base_image: `node:24.14.1-bookworm@${APP_BASE_DIGEST}`,
        llmup_rust_base_image: `rust:1.88-bookworm@${LLMUP_RUST_BASE_DIGEST}`,
        llmup_runtime_base_image: `debian:bookworm-slim@${LLMUP_RUNTIME_BASE_DIGEST}`,
      });

      const result = runBuildImagesResult(tempRoot, {
        APP_MC_IMAGE: mirroredMcImage,
      });
      const releaseRoot = path.join(tempRoot, 'release');

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('missing required build base image lock entry: app_mc_image');
      expect(existsSync(path.join(releaseRoot, 'build-images-docker.log'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'VERSION'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-manifest.json'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-artifact-broker-report.json'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the repo lock file is missing', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-missing-lock-'));

    try {
      stageBuildImagesFixture(tempRoot);
      rmSync(path.join(tempRoot, 'infra', 'deploy', 'shared', 'build-base-images.lock'), { force: true });

      const result = runBuildImagesResult(tempRoot);
      const releaseRoot = path.join(tempRoot, 'release');

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('missing build base image lock');
      expect(existsSync(path.join(releaseRoot, 'VERSION'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-manifest.json'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-artifact-broker-report.json'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed before Docker build when the repo lock has duplicate ids', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-duplicate-lock-'));

    try {
      stageBuildImagesFixture(tempRoot);
      writeRawBuildBaseImagesLock(
        tempRoot,
        [
          `app_node_base_image=node:24.14.1-bookworm@${APP_BASE_DIGEST}`,
          `app_mc_image=minio/mc:RELEASE.2025-08-13T08-35-41Z@${APP_MC_DIGEST}`,
          `app_mc_image=minio/mc:RELEASE.2025-08-13T08-35-41Z@${APP_MC_DIGEST}`,
          `llmup_rust_base_image=rust:1.88-bookworm@${LLMUP_RUST_BASE_DIGEST}`,
          `llmup_runtime_base_image=debian:bookworm-slim@${LLMUP_RUNTIME_BASE_DIGEST}`,
          '',
        ].join('\n'),
      );

      const result = runBuildImagesResult(tempRoot);
      const releaseRoot = path.join(tempRoot, 'release');

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('duplicate build base image lock entry: app_mc_image');
      expect(existsSync(path.join(releaseRoot, 'build-images-docker.log'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'VERSION'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-manifest.json'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-artifact-broker-report.json'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed before Docker build when an explicit base image override is unpinned', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-report-'));

    try {
      stageBuildImagesFixture(tempRoot);

      const result = runBuildImagesResult(tempRoot, {
        APP_MC_IMAGE: 'minio/mc:latest',
      });
      const releaseRoot = path.join(tempRoot, 'release');

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('base image override APP_MC_IMAGE must include a sha256 digest');
      expect(existsSync(path.join(releaseRoot, 'build-images-docker.log'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'VERSION'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-manifest.json'))).toBe(false);
      expect(existsSync(path.join(releaseRoot, 'build-artifact-broker-report.json'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('allows explicit pinned base image overrides for mirrors', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-images-pinned-override-'));
    const mirroredMcImage = `mirror.local/minio/mc:RELEASE.2025-08-13T08-35-41Z@${APP_MC_DIGEST}`;

    try {
      stageBuildImagesFixture(tempRoot);

      runBuildImages(tempRoot, {
        APP_MC_IMAGE: mirroredMcImage,
      });
      const releaseRoot = path.join(tempRoot, 'release');

      expect(readFileSync(path.join(releaseRoot, 'VERSION'), 'utf8')).toContain(
        `app_mc_image_ref=${mirroredMcImage}`,
      );
      expect(readFileSync(path.join(releaseRoot, 'build-images-docker.log'), 'utf8')).toContain(
        `--build-arg MC_IMAGE=${mirroredMcImage}`,
      );
      expect(existsSync(path.join(releaseRoot, 'build-manifest.json'))).toBe(true);
      expect(existsSync(path.join(releaseRoot, 'build-artifact-broker-report.json'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
