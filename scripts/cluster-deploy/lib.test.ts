import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateBuildSkipDecision } from '../governance/build-artifact-broker';

const repoRoot = process.cwd();
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const FORBIDDEN_SKIP_DECISION_FIELDS = [
  'passed',
  'verdict',
  'reusable',
  'claim_id',
  'status',
  'result_status',
  'failure_class',
] as const;

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
  copyFileSync(path.join(repoRoot, 'scripts', 'lib', 'deploy-common.sh'), path.join(tempRoot, 'scripts', 'lib', 'deploy-common.sh'));

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
  if [[ "$*" == *"--format {{.Id}}"* ]]; then
    key="$(node -e 'process.stdout.write(Buffer.from(process.argv[1]).toString("base64url"))' "\${image}")"
    fail_fixture="${tempRoot}/docker-fixtures/image-id-\${key}.fail"
    fixture="${tempRoot}/docker-fixtures/image-id-\${key}.txt"
    if [[ -f "\${fail_fixture}" ]]; then
      cat "\${fail_fixture}" >&2
      exit 1
    fi
    if [[ -f "\${fixture}" ]]; then
      cat "\${fixture}"
      exit 0
    fi
    printf 'sha256:%064d\\n' 0
    exit 0
  fi
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
  writeFileSync(
    path.join(binDir, 'kind'),
    `#!/usr/bin/env bash
set -euo pipefail
exit 0
`,
    { encoding: 'utf8', mode: 0o755 },
  );
  writeFileSync(
    path.join(binDir, 'kubectl'),
    `#!/usr/bin/env bash
set -euo pipefail
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

function writeDockerImageIdFixture(tempRoot: string, image: string, digest: string): void {
  const fixtureDir = path.join(tempRoot, 'docker-fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(fixtureDir, `image-id-${dockerFixtureKey(image)}.txt`), `${digest}\n`, 'utf8');
}

function writeDockerImageInspectFailure(tempRoot: string, image: string): void {
  const fixtureDir = path.join(tempRoot, 'docker-fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(fixtureDir, `image-id-${dockerFixtureKey(image)}.fail`), 'inspect failed\n', 'utf8');
}

function writeDockerSaveArchive(
  tempRoot: string,
  archiveName: string,
  options: {
    imageRef: string;
    repoTags?: readonly string[];
    entries?: readonly Array<{ Config: string; RepoTags: readonly string[]; Layers: readonly string[] }>;
    includeManifest?: boolean;
    malformed?: boolean;
  },
): { archivePath: string; configDigest: string } {
  const archivePath = path.join(tempRoot, 'release', 'images', archiveName);
  if (options.malformed) {
    writeFileSync(archivePath, 'not a tar archive', 'utf8');
    return { archivePath, configDigest: '' };
  }

  const archiveRoot = path.join(tempRoot, `archive-${archiveName.replace(/[^A-Za-z0-9]/g, '-')}`);
  mkdirSync(archiveRoot, { recursive: true });
  const configBytes = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux', image: options.imageRef }) + '\n');
  const configName = 'config.json';
  writeFileSync(path.join(archiveRoot, configName), configBytes);
  const configDigest = `sha256:${createHash('sha256').update(configBytes).digest('hex')}`;
  if (options.includeManifest !== false) {
    const manifest = options.entries ?? [
      {
        Config: configName,
        RepoTags: options.repoTags ?? [options.imageRef],
        Layers: [],
      },
    ];
    writeFileSync(path.join(archiveRoot, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  }
  const tarEntries = options.includeManifest === false ? [configName] : ['manifest.json', configName];
  execFileSync('tar', ['-cf', archivePath, '-C', archiveRoot, ...tarEntries], { stdio: 'pipe' });
  return { archivePath, configDigest };
}

function replaceDefaultArchiveWithDockerSaveArchive(tempRoot: string, imageRef: string): string {
  unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
  return writeDockerSaveArchive(tempRoot, 'example.tar', { imageRef }).configDigest;
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

  it('skips docker load when the archive config digest matches the local Docker image ID', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-lib-digest-skip-'));
    const image = 'registry.test/mbos/agentsmith-app:release-test';
    try {
      stageClusterLibFixture(tempRoot);
      const configDigest = replaceDefaultArchiveWithDockerSaveArchive(tempRoot, image);
      writeDockerImageIdFixture(tempRoot, image, configDigest);

      runClusterLoadBundledImages(tempRoot, { BUILD_ARTIFACT_BROKER_GENERATED_AT: '2026-04-27T12:00:00.000Z' });

      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      expect(dockerLog).toContain(`image inspect --format {{.Id}} ${image}`);
      expect(dockerLog).not.toContain(`load -i ${path.join(tempRoot, 'release', 'images', 'example.tar')}`);

      const decisions = readNdjson(path.join(tempRoot, 'release', 'skip-decisions.ndjson'));
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        schema: 'current-build-skip-decision.v1',
        version: 1,
        target: `image:${image}`,
        operation: 'docker_load',
        input_digest: configDigest,
        existing_artifact_digest: configDigest,
        skip_reason: 'local_docker_image_config_digest_matches_archive_config_digest',
        validator: 'docker save archive manifest Config digest and docker image inspect --format {{.Id}}',
        generated_at: '2026-04-27T12:00:00.000Z',
      });
      expect(validateBuildSkipDecision(decisions[0]).ok).toBe(true);
      for (const field of FORBIDDEN_SKIP_DECISION_FIELDS) {
        expect(decisions[0]).not.toHaveProperty(field);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('loads docker archive and does not write a skip decision when config digest mismatches local Docker image ID', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-lib-digest-mismatch-'));
    const image = 'registry.test/mbos/agentsmith-app:release-test';
    try {
      stageClusterLibFixture(tempRoot);
      replaceDefaultArchiveWithDockerSaveArchive(tempRoot, image);
      writeDockerImageIdFixture(tempRoot, image, DIGEST_B);

      runClusterLoadBundledImages(tempRoot);

      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      expect(dockerLog).toContain(`image inspect --format {{.Id}} ${image}`);
      expect(dockerLog).toContain(`load -i ${path.join(tempRoot, 'release', 'images', 'example.tar')}`);
      expect(existsSync(path.join(tempRoot, 'release', 'skip-decisions.ndjson'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed to docker load without a skip decision when archive proof or local inspect is not trustworthy', () => {
    const cases: readonly Array<{
      name: string;
      archiveName: string;
      configure: (tempRoot: string, image: string) => void;
    }> = [
      {
        name: 'malformed-archive',
        archiveName: 'example.tar',
        configure: (tempRoot, image) => {
          unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
          writeDockerSaveArchive(tempRoot, 'example.tar', { imageRef: image, malformed: true });
        },
      },
      {
        name: 'missing-manifest',
        archiveName: 'example.tar',
        configure: (tempRoot, image) => {
          unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
          writeDockerSaveArchive(tempRoot, 'example.tar', { imageRef: image, includeManifest: false });
        },
      },
      {
        name: 'multi-image',
        archiveName: 'example.tar',
        configure: (tempRoot, image) => {
          unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
          writeDockerSaveArchive(tempRoot, 'example.tar', {
            imageRef: image,
            entries: [
              { Config: 'config.json', RepoTags: [image], Layers: [] },
              { Config: 'config.json', RepoTags: ['registry.test/mbos/other:release-test'], Layers: [] },
            ],
          });
        },
      },
      {
        name: 'multi-tag',
        archiveName: 'example.tar',
        configure: (tempRoot, image) => {
          unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
          writeDockerSaveArchive(tempRoot, 'example.tar', {
            imageRef: image,
            repoTags: [image, 'registry.test/mbos/agentsmith-app:latest'],
          });
        },
      },
      {
        name: 'inspect-failure',
        archiveName: 'example.tar',
        configure: (tempRoot, image) => {
          unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
          writeDockerSaveArchive(tempRoot, 'example.tar', { imageRef: image });
          writeDockerImageInspectFailure(tempRoot, image);
        },
      },
      {
        name: 'invalid-image-id',
        archiveName: 'example.tar',
        configure: (tempRoot, image) => {
          unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
          writeDockerSaveArchive(tempRoot, 'example.tar', { imageRef: image });
          writeDockerImageIdFixture(tempRoot, image, 'sha256:not-a-canonical-image-id');
        },
      },
      {
        name: 'filename-like-ref-without-proof',
        archiveName: 'registry.test---mbos---agentsmith-app---release-test.tar',
        configure: (tempRoot, image) => {
          unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
          writeDockerSaveArchive(tempRoot, 'registry.test---mbos---agentsmith-app---release-test.tar', {
            imageRef: image,
            includeManifest: false,
          });
          writeDockerImageIdFixture(tempRoot, image, DIGEST_B);
        },
      },
    ];

    for (const testCase of cases) {
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), `cluster-lib-fail-closed-${testCase.name}-`));
      const image = 'registry.test/mbos/agentsmith-app:release-test';
      try {
        stageClusterLibFixture(tempRoot);
        testCase.configure(tempRoot, image);

        runClusterLoadBundledImages(tempRoot);

        const archivePath = path.join(tempRoot, 'release', 'images', testCase.archiveName);
        const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
        expect(dockerLog).toContain(`load -i ${archivePath}`);
        expect(existsSync(path.join(tempRoot, 'release', 'skip-decisions.ndjson'))).toBe(false);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
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
