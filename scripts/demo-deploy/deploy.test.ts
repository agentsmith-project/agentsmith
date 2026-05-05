import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateBuildSkipDecision } from '../governance/build-artifact-broker';

const repoRoot = process.cwd();
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

const DEMO_KIND_IMAGES = [
  'agentsmith-agent-task-runner:test',
  'sandbox-manager:test',
  'juicedata/juicefs-csi-driver:v0.31.3',
  'juicedata/csi-dashboard:v0.31.3',
  'juicedata/mount:ce-v1.3.1',
  'registry.k8s.io/sig-storage/csi-provisioner:v3.6.0',
  'registry.k8s.io/sig-storage/csi-resizer:v1.9.0',
  'registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0',
  'registry.k8s.io/sig-storage/livenessprobe:v2.11.0',
] as const;

const FORBIDDEN_SKIP_DECISION_FIELDS = [
  'passed',
  'verdict',
  'reusable',
  'claim_id',
  'status',
  'result_status',
  'failure_class',
] as const;

function dockerFixtureKey(image: string): string {
  return Buffer.from(image).toString('base64url');
}

function imageRepoForTest(image: string): string {
  const imageWithoutDigest = image.split('@')[0] ?? image;
  const lastComponent = imageWithoutDigest.split('/').at(-1) ?? imageWithoutDigest;
  return lastComponent.includes(':') ? imageWithoutDigest.replace(/:[^/:]+$/u, '') : imageWithoutDigest;
}

function imageTarNameForTest(image: string): string {
  return image.replace(/[/:@]/gu, '-');
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

function writeDockerRepoDigestsFixture(tempRoot: string, image: string, repoDigests: unknown): void {
  const fixtureDir = path.join(tempRoot, 'docker-fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    path.join(fixtureDir, `repo-digests-${dockerFixtureKey(image)}.json`),
    `${typeof repoDigests === 'string' ? repoDigests : JSON.stringify(repoDigests)}\n`,
    'utf8',
  );
}

function writeDockerRepoDigestsFailure(tempRoot: string, image: string): void {
  const fixtureDir = path.join(tempRoot, 'docker-fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(fixtureDir, `repo-digests-${dockerFixtureKey(image)}.fail`), 'repo digest inspect failed\n', 'utf8');
}

function writeKindContainerdTargetDigestFixture(tempRoot: string, image: string, digest: string): void {
  const fixtureDir = path.join(tempRoot, 'kind-containerd-fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    path.join(fixtureDir, `target-${dockerFixtureKey(image)}.json`),
    `${JSON.stringify({ target: { digest } })}\n`,
    'utf8',
  );
}

function writeKindContainerdInspectFixture(tempRoot: string, image: string, inspectJson: string): void {
  const fixtureDir = path.join(tempRoot, 'kind-containerd-fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(fixtureDir, `target-${dockerFixtureKey(image)}.json`), `${inspectJson}\n`, 'utf8');
}

function writeKindContainerdInspectFailure(tempRoot: string, image: string): void {
  const fixtureDir = path.join(tempRoot, 'kind-containerd-fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(fixtureDir, `target-${dockerFixtureKey(image)}.fail`), 'containerd inspect failed\n', 'utf8');
}

function writeDemoKindImageArchives(tempRoot: string): void {
  const imagesDir = path.join(tempRoot, 'release', 'images');
  mkdirSync(imagesDir, { recursive: true });
  for (const image of DEMO_KIND_IMAGES) {
    writeFileSync(path.join(imagesDir, `${imageTarNameForTest(image)}.tar`), `archive for ${image}\n`, 'utf8');
  }
}

function writeDemoReleaseVersion(tempRoot: string, bundledImageArchivesIncluded: boolean): void {
  writeFileSync(
    path.join(tempRoot, 'release', 'VERSION'),
    [
      'release_id=release-test',
      'agentsmith_app_image=agentsmith-app:test',
      'agentsmith_agent_task_runner_image=agentsmith-agent-task-runner:test',
      'sandbox_manager_image=sandbox-manager:test',
      'llm_universal_proxy_image=llm-universal-proxy:test',
      `bundled_image_archives_included=${bundledImageArchivesIncluded ? '1' : '0'}`,
      '',
    ].join('\n'),
    'utf8',
  );
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

function readNdjson(filePath: string): readonly Record<string, unknown>[] {
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function stageDemoDeployFixture(tempRoot: string): void {
  const deployScriptPath = path.join(repoRoot, 'scripts', 'demo-deploy', 'deploy.sh');
  const stagedDeployScriptPath = path.join(tempRoot, 'scripts', 'demo-deploy', 'deploy.sh');
  mkdirSync(path.dirname(stagedDeployScriptPath), { recursive: true });
  copyFileSync(deployScriptPath, stagedDeployScriptPath);

  mkdirSync(path.join(tempRoot, 'scripts', 'lib'), { recursive: true });
  copyFileSync(path.join(repoRoot, 'scripts', 'lib', 'deploy-common.sh'), path.join(tempRoot, 'scripts', 'lib', 'deploy-common.sh'));
  writeFileSync(
    path.join(tempRoot, 'scripts', 'lib', 'common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
source "\${BASH_SOURCE[0]%/*}/deploy-common.sh"
export DEMO_DEPLOY_ROOT="\${DEPLOY_ROOT}"
API_PORT="\${API_PORT:-20000}"
WEB_PORT="\${WEB_PORT:-3001}"
KEYCLOAK_REALM="\${KEYCLOAK_REALM:-mbos}"
INTERNAL_AGENT_K8S_NAMESPACE="\${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-internal}"
ensure_operator_site_env() {
  mkdir -p "\${RELEASE_ROOT}/env"
  if [[ ! -f "\${RELEASE_ROOT}/env/site.env" ]]; then
    printf 'KEYCLOAK_REALM=mbos\\nAPI_PORT=20000\\nWEB_PORT=3001\\n' > "\${RELEASE_ROOT}/env/site.env"
  fi
}
demo_deploy_mode() { printf '%s\\n' "\${DEMO_DEPLOY_MODE:-simple}"; }
demo_mode_is_full() { [[ "\$(demo_deploy_mode)" == "full" ]]; }
wait_http() { :; }
wait_tcp() { :; }
`,
    'utf8',
  );
  writeFileSync(path.join(tempRoot, 'scripts', 'lib', 'k8s-external-services.sh'), '#!/usr/bin/env bash\nset -euo pipefail\n', 'utf8');

  mkdirSync(path.join(tempRoot, 'scripts', 'substrate'), { recursive: true });
  writeFileSync(
    path.join(tempRoot, 'scripts', 'substrate', 'deploy-common.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nrelease_substrate_up() { :; }\n',
    'utf8',
  );

  mkdirSync(path.join(tempRoot, 'scripts', 'app'), { recursive: true });
  writeFileSync(
    path.join(tempRoot, 'scripts', 'app', 'deploy-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
write_compose_env() { :; }
release_app_up() { :; }
ensure_kind_nodes_on_network() { :; }
render_k8s_external_dependency_services() { :; }
`,
    'utf8',
  );

  const releaseRoot = path.join(tempRoot, 'release');
  mkdirSync(path.join(releaseRoot, 'images'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'env'), { recursive: true });
  mkdirSync(path.join(releaseRoot, 'scripts'), { recursive: true });
  writeFileSync(path.join(releaseRoot, 'images', 'example.tar'), 'tarball', 'utf8');
  writeFileSync(
    path.join(releaseRoot, 'VERSION'),
    [
      'release_id=release-test',
      'agentsmith_app_image=agentsmith-app:test',
      'agentsmith_agent_task_runner_image=agentsmith-agent-task-runner:test',
      'sandbox_manager_image=sandbox-manager:test',
      'llm_universal_proxy_image=llm-universal-proxy:test',
      'bundled_image_archives_included=1',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(path.join(releaseRoot, 'env', 'site.env'), 'KEYCLOAK_REALM=mbos\nAPI_PORT=20000\nWEB_PORT=3001\n', 'utf8');
  writeFileSync(path.join(releaseRoot, 'scripts', 'resolve-runtime-addresses.sh'), '#!/usr/bin/env bash\nset -euo pipefail\n: > "${RELEASE_ROOT}/env/runtime-addresses.env"\n', 'utf8');
  writeFileSync(path.join(releaseRoot, 'scripts', 'render-env.sh'), '#!/usr/bin/env bash\nset -euo pipefail\n', 'utf8');

  const binDir = path.join(tempRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${tempRoot}/docker.log"
case "$1" in
  image)
    if [[ "$2" == "inspect" ]]; then
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
      if [[ "$*" == *"--format {{json .RepoDigests}}"* ]]; then
        key="$(node -e 'process.stdout.write(Buffer.from(process.argv[1]).toString("base64url"))' "\${image}")"
        fail_fixture="${tempRoot}/docker-fixtures/repo-digests-\${key}.fail"
        fixture="${tempRoot}/docker-fixtures/repo-digests-\${key}.json"
        if [[ -f "\${fail_fixture}" ]]; then
          cat "\${fail_fixture}" >&2
          exit 1
        fi
        if [[ -f "\${fixture}" ]]; then
          cat "\${fixture}"
          exit 0
        fi
        printf 'repo digests fixture missing\\n' >&2
        exit 1
      fi
      exit 0
    fi
    ;;
  exec)
    image="\${@: -1}"
    key="$(node -e 'process.stdout.write(Buffer.from(process.argv[1]).toString("base64url"))' "\${image}")"
    fail_fixture="${tempRoot}/kind-containerd-fixtures/target-\${key}.fail"
    fixture="${tempRoot}/kind-containerd-fixtures/target-\${key}.json"
    if [[ -f "\${fail_fixture}" ]]; then
      cat "\${fail_fixture}" >&2
      exit 1
    fi
    if [[ -f "\${fixture}" ]]; then
      cat "\${fixture}"
      exit 0
    fi
    printf '{}\\n'
    exit 0
    ;;
  ps)
    exit 0
    ;;
  save)
    output=''
    shift
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
        --platform)
          shift 2
          ;;
        -o)
          output="$2"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    mkdir -p "$(dirname "$output")"
    printf 'temp archive\\n' > "$output"
    exit 0
    ;;
  rm|load|compose)
    exit 0
    ;;
esac
exit 0
`,
    'utf8',
  );
  chmodSync(path.join(binDir, 'docker'), 0o755);
  writeFileSync(
    path.join(binDir, 'kind'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${tempRoot}/kind.log"
if [[ "$1" == "load" && "$2" == "docker-image" && -n "\${KIND_FAIL_DOCKER_IMAGE_MATCH:-}" ]]; then
  for arg in "$@"; do
    if [[ "$arg" == *"\${KIND_FAIL_DOCKER_IMAGE_MATCH}"* ]]; then
      printf 'ctr: rpc error: code = NotFound desc = content digest sha256:test not found\\n' >&2
      exit 1
    fi
  done
fi
exit 0
`,
    'utf8',
  );
  chmodSync(path.join(binDir, 'kind'), 0o755);
  writeFileSync(
    path.join(binDir, 'kubectl'),
    `#!/usr/bin/env bash
set -euo pipefail
exit 0
`,
    'utf8',
  );
  chmodSync(path.join(binDir, 'kubectl'), 0o755);
}

function runDemoLoadBundledImages(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        export HOME="${tempRoot}"
        export RELEASE_ROOT="${path.join(tempRoot, 'release')}"
        export DEMO_DEPLOY_ROOT="${path.join(tempRoot, 'deploy-root')}"
        export PATH="${path.join(tempRoot, 'bin')}:$PATH"
        source "${path.join(tempRoot, 'scripts', 'demo-deploy', 'deploy.sh')}"
        load_demo_bundled_images
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

function runDemoLoadKindImages(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [
      '-lc',
      `
        set -euo pipefail
        export HOME="${tempRoot}"
        export RELEASE_ROOT="${path.join(tempRoot, 'release')}"
        export DEMO_DEPLOY_ROOT="${path.join(tempRoot, 'deploy-root')}"
        export PATH="${path.join(tempRoot, 'bin')}:$PATH"
        source "${path.join(tempRoot, 'scripts', 'demo-deploy', 'deploy.sh')}"
        load_demo_kind_images
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

describe('demo deploy bundled image loading', () => {
  it('loads bundled images by default', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-load-'));
    try {
      stageDemoDeployFixture(tempRoot);
      runDemoLoadBundledImages(tempRoot);
      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      expect(dockerLog).toContain('load -i');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips bundled image reload when SKIP_BUNDLED_IMAGE_LOAD=1', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-skip-load-'));
    try {
      stageDemoDeployFixture(tempRoot);
      unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
      runDemoLoadBundledImages(tempRoot, { SKIP_BUNDLED_IMAGE_LOAD: '1' });
      expect(existsSync(path.join(tempRoot, 'docker.log'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips docker load when the archive config digest matches the local Docker image ID', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-digest-skip-'));
    const image = 'registry.test/mbos/agentsmith-app:release-test';
    try {
      stageDemoDeployFixture(tempRoot);
      const configDigest = replaceDefaultArchiveWithDockerSaveArchive(tempRoot, image);
      writeDockerImageIdFixture(tempRoot, image, configDigest);

      runDemoLoadBundledImages(tempRoot, { BUILD_ARTIFACT_BROKER_GENERATED_AT: '2026-04-27T12:00:00.000Z' });

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
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-digest-mismatch-'));
    const image = 'registry.test/mbos/agentsmith-app:release-test';
    try {
      stageDemoDeployFixture(tempRoot);
      replaceDefaultArchiveWithDockerSaveArchive(tempRoot, image);
      writeDockerImageIdFixture(tempRoot, image, DIGEST_B);

      runDemoLoadBundledImages(tempRoot);

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
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), `demo-deploy-fail-closed-${testCase.name}-`));
      const image = 'registry.test/mbos/agentsmith-app:release-test';
      try {
        stageDemoDeployFixture(tempRoot);
        testCase.configure(tempRoot, image);

        runDemoLoadBundledImages(tempRoot);

        const archivePath = path.join(tempRoot, 'release', 'images', testCase.archiveName);
        const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
        expect(dockerLog).toContain(`load -i ${archivePath}`);
        expect(existsSync(path.join(tempRoot, 'release', 'skip-decisions.ndjson'))).toBe(false);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('loads bundled kind image archive when only local RepoDigest matches kind containerd target digest', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-kind-bundled-fail-closed-'));
    const image = 'agentsmith-agent-task-runner:test';
    try {
      stageDemoDeployFixture(tempRoot);
      writeDemoKindImageArchives(tempRoot);
      writeDockerRepoDigestsFixture(tempRoot, image, [`${imageRepoForTest(image)}@${DIGEST_A}`]);
      writeKindContainerdTargetDigestFixture(tempRoot, image, DIGEST_A);

      runDemoLoadKindImages(tempRoot, { BUILD_ARTIFACT_BROKER_GENERATED_AT: '2026-04-27T12:00:00.000Z' });

      const archivePath = path.join(tempRoot, 'release', 'images', `${imageTarNameForTest(image)}.tar`);
      const kindLog = readFileSync(path.join(tempRoot, 'kind.log'), 'utf8');
      expect(kindLog).toContain(`load image-archive ${archivePath} --name agentsmith`);
      expect(existsSync(path.join(tempRoot, 'release', 'skip-decisions.ndjson'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips local-image kind preload when local RepoDigest matches kind containerd target digest', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-kind-local-skip-'));
    const image = 'agentsmith-agent-task-runner:test';
    try {
      stageDemoDeployFixture(tempRoot);
      writeDemoReleaseVersion(tempRoot, false);
      unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
      writeDockerRepoDigestsFixture(tempRoot, image, [`${imageRepoForTest(image)}@${DIGEST_A}`]);
      writeKindContainerdTargetDigestFixture(tempRoot, image, DIGEST_A);

      runDemoLoadKindImages(tempRoot, { BUILD_ARTIFACT_BROKER_GENERATED_AT: '2026-04-27T12:00:00.000Z' });

      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      const kindLog = readFileSync(path.join(tempRoot, 'kind.log'), 'utf8');
      expect(dockerLog).toContain(`image inspect --format {{json .RepoDigests}} ${image}`);
      expect(dockerLog).toContain(`exec agentsmith-control-plane ctr -n k8s.io images inspect ${image}`);
      expect(dockerLog).not.toContain(`image inspect --format {{.Id}} ${image}`);
      expect(kindLog).not.toContain(`load docker-image ${image} --name agentsmith`);
      expect(kindLog).not.toContain(`load image-archive ${image}`);

      const decisions = readNdjson(path.join(tempRoot, 'release', 'skip-decisions.ndjson'));
      expect(decisions).toHaveLength(1);
      expect(validateBuildSkipDecision(decisions[0]).ok).toBe(true);
      for (const field of FORBIDDEN_SKIP_DECISION_FIELDS) {
        expect(decisions[0]).not.toHaveProperty(field);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('does not skip local-image kind preload when only Docker image ID matches kind target digest', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-kind-local-id-no-skip-'));
    const image = 'agentsmith-agent-task-runner:test';
    try {
      stageDemoDeployFixture(tempRoot);
      writeDemoReleaseVersion(tempRoot, false);
      unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
      writeDockerImageIdFixture(tempRoot, image, DIGEST_A);
      writeKindContainerdTargetDigestFixture(tempRoot, image, DIGEST_A);

      runDemoLoadKindImages(tempRoot);

      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      const kindLog = readFileSync(path.join(tempRoot, 'kind.log'), 'utf8');
      expect(dockerLog).toContain(`image inspect --format {{json .RepoDigests}} ${image}`);
      expect(dockerLog).not.toContain(`image inspect --format {{.Id}} ${image}`);
      expect(kindLog).toContain(`load docker-image ${image} --name agentsmith`);
      expect(existsSync(path.join(tempRoot, 'release', 'skip-decisions.ndjson'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed to local-image kind preload without a skip decision when digest proof is absent or untrusted', () => {
    const cases: readonly Array<{
      name: string;
      configure: (tempRoot: string, image: string) => void;
    }> = [
      {
        name: 'digest-mismatch',
        configure: (tempRoot, image) => {
          writeDockerRepoDigestsFixture(tempRoot, image, [`${imageRepoForTest(image)}@${DIGEST_A}`]);
          writeKindContainerdTargetDigestFixture(tempRoot, image, DIGEST_B);
        },
      },
      {
        name: 'missing-local-repodigest',
        configure: (tempRoot, image) => {
          writeDockerRepoDigestsFixture(tempRoot, image, []);
          writeKindContainerdTargetDigestFixture(tempRoot, image, DIGEST_A);
        },
      },
      {
        name: 'invalid-local-repodigest',
        configure: (tempRoot, image) => {
          writeDockerRepoDigestsFixture(tempRoot, image, [`${imageRepoForTest(image)}@sha256:not-a-manifest-digest`]);
          writeKindContainerdTargetDigestFixture(tempRoot, image, DIGEST_A);
        },
      },
      {
        name: 'invalid-kind-target-digest',
        configure: (tempRoot, image) => {
          writeDockerRepoDigestsFixture(tempRoot, image, [`${imageRepoForTest(image)}@${DIGEST_A}`]);
          writeKindContainerdInspectFixture(tempRoot, image, JSON.stringify({ target: { digest: 'sha512:bad' } }));
        },
      },
      {
        name: 'local-probe-failure',
        configure: (tempRoot, image) => {
          writeDockerRepoDigestsFailure(tempRoot, image);
          writeKindContainerdTargetDigestFixture(tempRoot, image, DIGEST_A);
        },
      },
      {
        name: 'kind-probe-failure',
        configure: (tempRoot, image) => {
          writeDockerRepoDigestsFixture(tempRoot, image, [`${imageRepoForTest(image)}@${DIGEST_A}`]);
          writeKindContainerdInspectFailure(tempRoot, image);
        },
      },
    ];

    for (const testCase of cases) {
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), `demo-deploy-kind-fail-closed-${testCase.name}-`));
      const image = 'agentsmith-agent-task-runner:test';
      try {
        stageDemoDeployFixture(tempRoot);
        writeDemoReleaseVersion(tempRoot, false);
        unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
        testCase.configure(tempRoot, image);

        runDemoLoadKindImages(tempRoot);

        const kindLog = readFileSync(path.join(tempRoot, 'kind.log'), 'utf8');
        expect(kindLog).toContain(`load docker-image ${image} --name agentsmith`);
        expect(existsSync(path.join(tempRoot, 'release', 'skip-decisions.ndjson'))).toBe(false);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  }, 10000);

  it('forces kind preload without probing or writing a skip decision when FORCE_KIND_PRELOAD=1', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-kind-force-preload-'));
    const image = 'agentsmith-agent-task-runner:test';
    try {
      stageDemoDeployFixture(tempRoot);
      writeDemoReleaseVersion(tempRoot, false);
      unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));
      writeDockerRepoDigestsFixture(tempRoot, image, [`${imageRepoForTest(image)}@${DIGEST_A}`]);
      writeKindContainerdTargetDigestFixture(tempRoot, image, DIGEST_A);

      runDemoLoadKindImages(tempRoot, { FORCE_KIND_PRELOAD: '1' });

      const dockerLog = existsSync(path.join(tempRoot, 'docker.log'))
        ? readFileSync(path.join(tempRoot, 'docker.log'), 'utf8')
        : '';
      const kindLog = readFileSync(path.join(tempRoot, 'kind.log'), 'utf8');
      expect(dockerLog).not.toContain('image inspect --format {{json .RepoDigests}}');
      expect(dockerLog).not.toContain('ctr -n k8s.io images inspect');
      expect(kindLog).toContain(`load docker-image ${image} --name agentsmith`);
      expect(existsSync(path.join(tempRoot, 'release', 'skip-decisions.ndjson'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preloads demo full-mode kind images from local docker images when the release bundle omits archives', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-kind-local-'));
    try {
      stageDemoDeployFixture(tempRoot);
      writeFileSync(
        path.join(tempRoot, 'release', 'VERSION'),
        [
          'release_id=release-test',
          'agentsmith_app_image=agentsmith-app:test',
          'agentsmith_agent_task_runner_image=agentsmith-agent-task-runner:test',
          'sandbox_manager_image=sandbox-manager:test',
          'llm_universal_proxy_image=llm-universal-proxy:test',
          'bundled_image_archives_included=0',
          '',
        ].join('\n'),
        'utf8',
      );
      unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));

      runDemoLoadKindImages(tempRoot);
      const kindLog = readFileSync(path.join(tempRoot, 'kind.log'), 'utf8');

      expect(kindLog).toContain('load docker-image agentsmith-agent-task-runner:test');
      expect(kindLog).not.toContain('load image-archive');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('falls back to a temporary platform-specific archive when direct local kind loading fails for a dependency image', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-deploy-kind-fallback-'));
    try {
      stageDemoDeployFixture(tempRoot);
      writeFileSync(
        path.join(tempRoot, 'release', 'VERSION'),
        [
          'release_id=release-test',
          'agentsmith_app_image=agentsmith-app:test',
          'agentsmith_agent_task_runner_image=agentsmith-agent-task-runner:test',
          'sandbox_manager_image=sandbox-manager:test',
          'llm_universal_proxy_image=llm-universal-proxy:test',
          'bundled_image_archives_included=0',
          '',
        ].join('\n'),
        'utf8',
      );
      unlinkSync(path.join(tempRoot, 'release', 'images', 'example.tar'));

      runDemoLoadKindImages(tempRoot, {
        KIND_FAIL_DOCKER_IMAGE_MATCH: 'juicedata/juicefs-csi-driver:v0.31.3',
      });

      const kindLog = readFileSync(path.join(tempRoot, 'kind.log'), 'utf8');
      const dockerLog = readFileSync(path.join(tempRoot, 'docker.log'), 'utf8');
      const archiveMatch = kindLog.match(/load image-archive (\S+) --name/);

      expect(kindLog).toContain('load docker-image juicedata/juicefs-csi-driver:v0.31.3');
      expect(kindLog).toContain('load image-archive ');
      expect(dockerLog).toContain('save --platform linux/amd64 juicedata/juicefs-csi-driver:v0.31.3 -o');
      expect(archiveMatch).not.toBeNull();
      expect(existsSync(archiveMatch?.[1] ?? '')).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
