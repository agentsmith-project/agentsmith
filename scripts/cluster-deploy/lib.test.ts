import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateBuildSkipDecision } from '../governance/build-artifact-broker';

const repoRoot = process.cwd();
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

const PUSH_IMAGE_ENV_KEYS = [
  'APP_IMAGE',
  'RUNNER_IMAGE',
  'CHAT_RUNNER_IMAGE',
  'VERIFY_RUNNER_IMAGE',
  'SANDBOX_MANAGER_IMAGE',
  'UNIVERSAL_PROXY_IMAGE',
  'JUICEFS_MOUNT_IMAGE',
  'JUICEFS_CSI_DRIVER_IMAGE',
  'JUICEFS_CSI_DASHBOARD_IMAGE',
  'JUICEFS_CSI_PROVISIONER_IMAGE',
  'JUICEFS_CSI_RESIZER_IMAGE',
  'JUICEFS_CSI_LIVENESSPROBE_IMAGE',
  'JUICEFS_CSI_NODE_REGISTRAR_IMAGE',
  'INGRESS_NGINX_CONTROLLER_IMAGE',
  'INGRESS_NGINX_CERTGEN_IMAGE',
] as const;

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
if [[ "\${1:-}" == "login" ]]; then
  if [[ "$*" == *"--password-stdin"* ]]; then
    password="$(cat)"
    printf 'password-stdin:%s\\n' "\${password}" >> "${tempRoot}/docker-stdin.log"
  fi
  exit 0
fi
if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
  image="\${@: -1}"
  key="$(node -e 'process.stdout.write(Buffer.from(process.argv[1]).toString("base64url"))' "\${image}")"
  fixture="${tempRoot}/docker-fixtures/local-\${key}.json"
  if [[ -f "\${fixture}" ]]; then
    cat "\${fixture}"
    exit 0
  fi
  printf '[]\\n'
  exit 0
fi
if [[ "\${1:-}" == "buildx" && "\${2:-}" == "imagetools" && "\${3:-}" == "inspect" ]]; then
  image="\${4:-}"
  key="$(node -e 'process.stdout.write(Buffer.from(process.argv[1]).toString("base64url"))' "\${image}")"
  fail_fixture="${tempRoot}/docker-fixtures/remote-\${key}.fail"
  fixture="${tempRoot}/docker-fixtures/remote-\${key}.json"
  if [[ -f "\${fail_fixture}" ]]; then
    cat "\${fail_fixture}" >&2
    exit 1
  fi
  if [[ -f "\${fixture}" ]]; then
    cat "\${fixture}"
    exit 0
  fi
  printf '{"digest":"sha256:%064d"}\\n' 0
  exit 0
fi
exit 0
`,
    { encoding: 'utf8', mode: 0o755 },
  );
}

function dockerFixtureKey(image: string): string {
  return Buffer.from(image).toString('base64url');
}

function writeDockerFixture(tempRoot: string, kind: 'local' | 'remote', image: string, content: string): void {
  const fixtureDir = path.join(tempRoot, 'docker-fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(fixtureDir, `${kind}-${dockerFixtureKey(image)}.json`), content, 'utf8');
}

function writeRemoteProbeFailure(tempRoot: string, image: string, message: string): void {
  const fixtureDir = path.join(tempRoot, 'docker-fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(fixtureDir, `remote-${dockerFixtureKey(image)}.fail`), message, 'utf8');
}

function imageRepoForTest(image: string): string {
  return image.slice(0, image.lastIndexOf(':'));
}

function buildPushImageEnv(primaryImage = 'registry.test/mbos/agentsmith-app:release-test'): NodeJS.ProcessEnv {
  const imageEnv: NodeJS.ProcessEnv = {
    REGISTRY_HOST: 'registry.test',
    BUILD_ARTIFACT_BROKER_GENERATED_AT: '2026-04-27T12:00:00.000Z',
  };
  PUSH_IMAGE_ENV_KEYS.forEach((key, index) => {
    imageEnv[key] = index === 0 ? primaryImage : `registry.test/mbos/${key.toLowerCase()}:release-test`;
  });
  return imageEnv;
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

function runClusterPushReleaseImages(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
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
        push_release_images
      `,
    ],
    {
      cwd: tempRoot,
      env: { ...process.env, ...buildPushImageEnv(), ...extraEnv },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

function readNdjson(filePath: string): readonly Record<string, unknown>[] {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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

describe('cluster deploy registry push skip', () => {
  it('skips an image push when local RepoDigest matches the remote top-level manifest digest', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-lib-skip-push-'));
    const image = 'registry.test/mbos/agentsmith-app:release-test';
    try {
      stageClusterLibFixture(tempRoot);
      writeDockerFixture(
        tempRoot,
        'local',
        image,
        JSON.stringify(['registry.test/mbos/agentsmith-app@' + DIGEST_A]),
      );
      writeDockerFixture(tempRoot, 'remote', image, JSON.stringify({ digest: DIGEST_A }));

      runClusterPushReleaseImages(tempRoot, buildPushImageEnv(image));

      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      expect(dockerLog).toContain(`image inspect --format {{json .RepoDigests}} ${image}`);
      expect(dockerLog).toContain(`buildx imagetools inspect ${image} --format {{json .Manifest}}`);
      expect(dockerLog).not.toContain(`push ${image}\n`);

      const decisions = readNdjson(path.join(tempRoot, 'release', 'skip-decisions.ndjson'));
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        schema: 'current-build-skip-decision.v1',
        version: 1,
        target: `image:${image}`,
        operation: 'registry_push',
        input_digest: DIGEST_A,
        existing_artifact_digest: DIGEST_A,
        skip_reason: 'remote_manifest_digest_matches',
        validator: 'registry manifest digest probe via docker buildx imagetools inspect',
        generated_at: '2026-04-27T12:00:00.000Z',
      });
      expect(validateBuildSkipDecision(decisions[0]).ok).toBe(true);
      expect(decisions[0]).not.toHaveProperty('passed');
      expect(decisions[0]).not.toHaveProperty('reusable');
      expect(decisions[0]).not.toHaveProperty('verdict');
      expect(decisions[0]).not.toHaveProperty('claim_id');
      expect(decisions[0]).not.toHaveProperty('status');
      expect(decisions[0]).not.toHaveProperty('result_status');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('pushes when docker image inspect only has an ImageID or lacks a matching RepoDigest', () => {
    const imageWithOnlyId = 'registry.test/mbos/agentsmith-app:release-test';
    const imageWithoutMatchingRepo = 'registry.test/mbos/agentsmith-runner:release-test';

    for (const [name, image, localInspectJson] of [
      ['only-id', imageWithOnlyId, JSON.stringify({ Id: DIGEST_A, RepoDigests: [] })],
      ['wrong-repo', imageWithoutMatchingRepo, JSON.stringify(['registry.test/other/agentsmith-runner@' + DIGEST_A])],
    ] as const) {
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), `cluster-lib-push-${name}-`));
      try {
        stageClusterLibFixture(tempRoot);
        writeDockerFixture(tempRoot, 'local', image, localInspectJson);
        writeDockerFixture(tempRoot, 'remote', image, JSON.stringify({ digest: DIGEST_A }));

        runClusterPushReleaseImages(tempRoot, buildPushImageEnv(image));

        const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
        expect(dockerLog).toContain(`push ${image}`);
        expect(existsSync(path.join(tempRoot, 'release', 'skip-decisions.ndjson'))).toBe(false);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('pushes when the remote manifest probe fails or returns a non-sha256 digest', () => {
    const probeFailureImage = 'registry.test/mbos/agentsmith-app:release-test';
    const invalidDigestImage = 'registry.test/mbos/agentsmith-runner:release-test';

    for (const [name, image, configureRemote] of [
      [
        'probe-failure',
        probeFailureImage,
        (tempRoot: string, targetImage: string) =>
          writeRemoteProbeFailure(tempRoot, targetImage, 'registry auth failed'),
      ],
      [
        'invalid-digest',
        invalidDigestImage,
        (tempRoot: string, targetImage: string) =>
          writeDockerFixture(tempRoot, 'remote', targetImage, JSON.stringify({ digest: 'sha512:bad' })),
      ],
    ] as const) {
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), `cluster-lib-remote-${name}-`));
      try {
        stageClusterLibFixture(tempRoot);
        writeDockerFixture(tempRoot, 'local', image, JSON.stringify([imageRepoForTest(image) + '@' + DIGEST_A]));
        configureRemote(tempRoot, image);

        runClusterPushReleaseImages(tempRoot, buildPushImageEnv(image));

        const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
        expect(dockerLog).toContain(`push ${image}`);
        expect(existsSync(path.join(tempRoot, 'release', 'skip-decisions.ndjson'))).toBe(false);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('forces push without writing a registry_push skip decision when FORCE_REGISTRY_PUSH=1', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-lib-force-push-'));
    const image = 'registry.test/mbos/agentsmith-app:release-test';
    try {
      stageClusterLibFixture(tempRoot);
      writeDockerFixture(tempRoot, 'local', image, JSON.stringify(['registry.test/mbos/agentsmith-app@' + DIGEST_A]));
      writeDockerFixture(tempRoot, 'remote', image, JSON.stringify({ digest: DIGEST_A }));

      runClusterPushReleaseImages(tempRoot, { ...buildPushImageEnv(image), FORCE_REGISTRY_PUSH: '1' });

      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      expect(dockerLog).not.toContain(`image inspect --format {{json .RepoDigests}} ${image}`);
      expect(dockerLog).not.toContain(`buildx imagetools inspect ${image} --format {{json .Manifest}}`);
      expect(dockerLog).toContain(`push ${image}`);
      expect(existsSync(path.join(tempRoot, 'release', 'skip-decisions.ndjson'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses docker login --password-stdin and runs probes and pushes after login', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-lib-login-push-'));
    const image = 'registry.test/mbos/agentsmith-app:release-test';
    try {
      stageClusterLibFixture(tempRoot);
      writeDockerFixture(tempRoot, 'local', image, JSON.stringify([]));
      writeDockerFixture(tempRoot, 'remote', image, JSON.stringify({ digest: DIGEST_B }));

      runClusterPushReleaseImages(tempRoot, {
        ...buildPushImageEnv(image),
        REGISTRY_USERNAME: 'robot$agentsmith',
        REGISTRY_PASSWORD: 'secret-token',
      });

      const dockerLogLines = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8').trim().split('\n');
      const loginIndex = dockerLogLines.findIndex((line) => line.includes('login registry.test'));
      const probeIndex = dockerLogLines.findIndex((line) =>
        line.includes(`image inspect --format {{json .RepoDigests}} ${image}`),
      );
      const pushIndex = dockerLogLines.findIndex((line) => line === `push ${image}`);
      expect(dockerLogLines[loginIndex]).toContain('--password-stdin');
      expect(dockerLogLines[loginIndex]).not.toContain('secret-token');
      expect(readFileSync(path.join(tempRoot, 'docker-stdin.log'), 'utf8')).toContain('password-stdin:secret-token');
      expect(loginIndex).toBeGreaterThanOrEqual(0);
      expect(probeIndex).toBeGreaterThan(loginIndex);
      expect(pushIndex).toBeGreaterThan(loginIndex);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
