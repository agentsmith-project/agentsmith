import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const LLMUP_DIGEST = 'sha256:a6d5b309f25f17cafbd7fadb601fef5f80726c4a299509820e8e863be0928058';
const LLMUP_SOURCE_IMAGE = `ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.25@${LLMUP_DIGEST}`;
const forbiddenEvidenceTruthFields = new Set([
  'verdict',
  'claim_id',
  'reusable',
  'passed',
  'failed',
  'status',
  'result_status',
  'failure_class',
  'evidence_claim',
  'claim_reuse',
  'cache_hit',
]);

interface DockerSaveManifestEntry {
  Config: string;
  RepoTags: string[];
  Layers: string[];
}

interface ArchiveProof {
  archiveDigest: string;
  configDigest: string;
  imageRef: string;
  platformManifestDigest?: string;
}

interface ImageArchiveManifestEntry {
  archive_relpath: string;
  image_ref: string;
  archive_sha256: string;
  archive_config_digest: string;
  local_image_id: string | null;
  local_config_digest: string | null;
  platform: string;
  source_manifest_digest?: string | null;
  source_build_manifest_digest?: string | null;
  validator: string;
}

interface ImageArchiveManifest {
  schema: string;
  version: number;
  release_id: string;
  generated_at: string;
  producer: unknown;
  archives: ImageArchiveManifestEntry[];
}

interface BuildSkipDecision {
  schema: string;
  version: number;
  target: string;
  operation: string;
  input_digest: string;
  existing_artifact_digest: string;
  skip_reason: string;
  validator: string;
  generated_at: string;
}

function writeExecutable(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

function writeFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function sha256Digest(content: Buffer | string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function fakeIndexDigest(imageRef: string, salt = 'stable'): string {
  return sha256Digest(`fake index for ${imageRef} ${salt}\n`);
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function readNdjsonFile<T>(filePath: string): T[] {
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function readDockerArchiveProof(archivePath: string): ArchiveProof {
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOf', archivePath, 'manifest.json'], { encoding: 'utf8' }),
  ) as DockerSaveManifestEntry[];
  const [entry] = manifest;
  const configBytes = execFileSync('tar', ['-xOf', archivePath, entry.Config]);
  let platformManifestDigest: string | undefined;

  try {
    const index = JSON.parse(execFileSync('tar', ['-xOf', archivePath, 'index.json'], { encoding: 'utf8' })) as {
      manifests?: Array<{ digest?: string }>;
    };
    const firstDigest = index.manifests?.find((descriptor) => typeof descriptor.digest === 'string')?.digest;
    if (firstDigest?.match(/^sha256:[a-f0-9]{64}$/)) {
      platformManifestDigest = firstDigest;
    }
  } catch {
    platformManifestDigest = undefined;
  }

  return {
    archiveDigest: sha256Digest(readFileSync(archivePath)),
    configDigest: sha256Digest(configBytes),
    imageRef: entry.RepoTags[0],
    platformManifestDigest,
  };
}

function expectNoEvidenceTruthFields(value: unknown, pathLabel = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => expectNoEvidenceTruthFields(entry, `${pathLabel}[${index}]`));
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    expect(forbiddenEvidenceTruthFields.has(key), `${pathLabel}.${key} must not be an evidence truth field`).toBe(false);
    expectNoEvidenceTruthFields(child, `${pathLabel}.${key}`);
  }
}

function findManifestArchive(manifest: ImageArchiveManifest, archiveRelpath: string): ImageArchiveManifestEntry {
  const archive = manifest.archives.find((entry) => entry.archive_relpath === archiveRelpath);
  expect(archive).toBeDefined();
  return archive as ImageArchiveManifestEntry;
}

function countDockerSaveCalls(tempRoot: string, imageRef?: string): number {
  const logPath = path.join(tempRoot, 'docker-save.log');
  if (!existsSync(logPath)) {
    return 0;
  }
  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  if (!imageRef) {
    return lines.length;
  }
  return lines.filter((line) => line === imageRef).length;
}

function readDockerSaveArgLines(tempRoot: string): string[] {
  const logPath = path.join(tempRoot, 'docker-save-args.log');
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
}

function expectDockerSaveSkipDecision(value: unknown, imageRef: string, inputDigest: string): BuildSkipDecision {
  expectNoEvidenceTruthFields(value);
  expect(value).toMatchObject({
    schema: 'current-build-skip-decision.v1',
    version: 1,
    target: `image:${imageRef}`,
    operation: 'docker_save',
    input_digest: inputDigest,
    skip_reason: 'image_archive_cache_verified',
  });
  expect(value).toHaveProperty('existing_artifact_digest');
  expect((value as BuildSkipDecision).existing_artifact_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect((value as BuildSkipDecision).validator).toContain('archive sha256');
  return value as BuildSkipDecision;
}

function stageDemoBuildBundleFixture(tempRoot: string): void {
  const siblingRoot = path.dirname(tempRoot);
  mkdirSync(path.join(siblingRoot, 'mbos-sandbox-v1', 'manager-service'), { recursive: true });

  mkdirSync(path.join(tempRoot, 'scripts', 'demo-deploy'), { recursive: true });
  copyFileSync(
    path.join(repoRoot, 'scripts', 'demo-deploy', 'build-offline-bundle.sh'),
    path.join(tempRoot, 'scripts', 'demo-deploy', 'build-offline-bundle.sh'),
  );
  mkdirSync(path.join(tempRoot, 'scripts', 'lib'), { recursive: true });
  copyFileSync(
    path.join(repoRoot, 'scripts', 'lib', 'llmup-image-lock.sh'),
    path.join(tempRoot, 'scripts', 'lib', 'llmup-image-lock.sh'),
  );

  writeFile(
    path.join(tempRoot, 'infra', 'deploy', 'shared', 'llmup-image.lock'),
    [
      '# AgentSmith llmup external image lock.',
      '# Format: llmup_version=<version> and llmup_source_image=<image:tag@sha256:digest>',
      'llmup_version=v0.2.25',
      `llmup_source_image=${LLMUP_SOURCE_IMAGE}`,
      '',
    ].join('\n'),
  );

  writeFile(
    path.join(tempRoot, 'scripts', 'lib', 'ensure-juicefs-vendor.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
ensure_juicefs_vendor_dir() {
  mkdir -p "$1/infra/vendor/juicefs"
}
`,
  );
  writeFile(
    path.join(tempRoot, 'scripts', 'lib', 'docker-buildx-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
docker_build_local() { :; }
`,
  );
  writeFile(
    path.join(tempRoot, 'scripts', 'lib', 'runner-image-common.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
build_runner_image() { :; }
`,
  );
  writeFile(
    path.join(tempRoot, 'scripts', 'lib', 'release-story-verify-source-set.sh'),
    `#!/usr/bin/env bash

release_story_verify_source_set_name() {
  printf '%s\\n' 'backend_real_story_verify_source_set'
}

release_story_verify_source_set_helper_path() {
  printf '%s\\n' 'scripts/lib/release-story-verify-source-set.sh'
}

release_story_verify_source_set() {
  printf '%s\\n' 'e2e/stories/backend-real/example.story.md'
}
`,
  );

  for (const relativePath of [
    'scripts/check-preset-external-file-library.sh',
    'scripts/file-library-real-smoke.sh',
    'scripts/demo-deploy-modes-gate.sh',
    'scripts/lib/common.sh',
    'scripts/lib/deploy-common.sh',
    'scripts/lib/release-stage-common.sh',
    'scripts/lib/bootstrap-common.sh',
    'scripts/lib/k8s-external-services.sh',
    'scripts/lib/preset-common.sh',
    'scripts/lib/runtime-verification.sh',
    'scripts/substrate/deploy-common.sh',
    'scripts/app/deploy-common.sh',
  ]) {
    writeExecutable(path.join(tempRoot, relativePath), '#!/usr/bin/env bash\nset -euo pipefail\n');
  }
  copyFileSync(
    path.join(repoRoot, 'scripts', 'lib', 'image-archive-manifest.sh'),
    path.join(tempRoot, 'scripts', 'lib', 'image-archive-manifest.sh'),
  );

  writeFile(path.join(tempRoot, 'scripts', 'notebook-agent-refresh-token.js'), 'console.log("ok");\n');
  writeFile(path.join(tempRoot, 'README-demo-deploy.md'), 'demo bundle\n');
  writeFile(path.join(tempRoot, 'infra', 'runtime', 'presets.env'), 'PRESET_ENDPOINT_MODEL=placeholder-model\n');

  writeFile(path.join(tempRoot, 'infra', 'deploy', 'demo', 'docker-compose.yml'), 'services: {}\n');
  writeFile(
    path.join(tempRoot, 'infra', 'deploy', 'demo', 'deployment.manifest.json'),
    JSON.stringify({
      bundle_files: [],
      bundled_tools: ['kind', 'kubectl', 'juicefs', 'mc'],
      required_env: {},
      bundle_source_sets: [
        {
          name: 'backend_real_story_verify_source_set',
          helper: 'scripts/lib/release-story-verify-source-set.sh',
        },
      ],
    }, null, 2),
  );

  for (const relativePath of [
    'infra/deploy/demo/env/site.env.example',
    'infra/deploy/demo/kind/config.yaml',
    'infra/deploy/demo/k8s/juicefs-csi.yaml',
    'infra/deploy/shared/universal-proxy/config.yaml',
    'infra/integration/postgres-init/001-create-databases.sql',
    'packages/adapters-private/sql/projects.sql',
    'infra/integration/minio/init-minio.sh',
    'infra/integration/keycloak/realm-mbos-dev.json',
    'docs/contracts/deployment-spec-v1.md',
    'docs/user-guides/demo-deploy-operations.md',
    'docs/user-guides/demo-deploy-simple-quickstart-zh.md',
    'e2e/integration-real-helpers.ts',
    'e2e/integration-files.spec.ts',
    'e2e/notebook-execution-outcome.ts',
    'e2e/integration-workspace-access.ts',
    'e2e/integration-workspace-entry.spec.ts',
    'e2e/integration-workspace-publish-usable.spec.ts',
    'e2e/integration-preset-external-file-library.spec.ts',
    'e2e/integration-internal-chat-runner.spec.ts',
    'e2e/integration-chat-local-upstream.ts',
    'e2e/internal-chat-isolation-probe.ts',
    'e2e/stories/backend-real/example.story.md',
    'infra/deploy/Dockerfile.agentsmith-app-base',
    'infra/deploy/Dockerfile.agentsmith-app',
    'infra/deploy/Dockerfile.agentsmith-verify-runner-base',
    'infra/deploy/Dockerfile.agentsmith-verify-runner',
    'infra/runner/Dockerfile.notebook-codex-runner-base',
    'infra/runner/Dockerfile.chat-llm-runner-base',
    'package.json',
    'package-lock.json',
    'packages/adapters-cf/package.json',
    'packages/adapters-private/package.json',
    'packages/notebook-codex-runner/package.json',
    'packages/api-entry-cf/package.json',
    'packages/api-entry-node/package.json',
    'packages/application/package.json',
    'packages/contracts/package.json',
    'packages/domain/package.json',
    'packages/ports/package.json',
    'packages/agent-runner/package.json',
    'packages/chat-llm-runner/package.json',
  ]) {
    writeFile(path.join(tempRoot, relativePath), 'placeholder\n');
  }

  const binDir = path.join(tempRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeExecutable(path.join(binDir, 'kind'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  writeExecutable(path.join(binDir, 'kubectl'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  writeExecutable(path.join(binDir, 'juicefs'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  writeExecutable(path.join(binDir, 'mc'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  writeExecutable(
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  network)
    if [[ "$2" == "inspect" ]]; then
      printf '172.17.0.1\\n'
      exit 0
    fi
    ;;
  image)
    if [[ "$2" == "inspect" ]]; then
      shift 2
      format=''
      image_ref=''
      platform_requested='0'
      while [[ "$#" -gt 0 ]]; do
        case "$1" in
          --platform)
            platform_requested='1'
            shift 2
            ;;
          --format)
            format="$2"
            shift 2
            ;;
          *)
            image_ref="$1"
            shift
            ;;
        esac
      done
      if [[ -n "\${format}" ]]; then
        python3 - "\${image_ref}" "\${DOCKER_IMAGE_ID_SALT:-stable}" "\${format}" "\${DOCKER_IMAGE_ID_MODE:-config}" "\${platform_requested}" <<'PY'
import gzip
import hashlib
import io
import json
import sys
import tarfile

image_ref = sys.argv[1]
salt = sys.argv[2]
inspect_format = sys.argv[3]
image_id_mode = sys.argv[4]
platform_requested = sys.argv[5] == "1"
layer_payload = f"fake layer for {image_ref} {salt}\\n".encode("utf-8")
layer_buffer = io.BytesIO()
with tarfile.open(fileobj=layer_buffer, mode="w") as layer_tar:
    info = tarfile.TarInfo("layer.txt")
    info.size = len(layer_payload)
    info.mode = 0o644
    info.mtime = 0
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    layer_tar.addfile(info, io.BytesIO(layer_payload))
layer_bytes = layer_buffer.getvalue()
layer_diff_id = "sha256:" + hashlib.sha256(layer_bytes).hexdigest()
layer_blob_bytes = gzip.compress(layer_bytes, mtime=0)
layer_blob_digest = "sha256:" + hashlib.sha256(layer_blob_bytes).hexdigest()
config = {
    "architecture": "amd64",
    "config": {"Image": image_ref, "Salt": salt},
    "created": "2026-04-27T00:00:00Z",
    "os": "linux",
    "rootfs": {"diff_ids": [layer_diff_id], "type": "layers"},
}
config_bytes = (json.dumps(config, sort_keys=True, separators=(",", ":")) + "\\n").encode("utf-8")
config_digest = "sha256:" + hashlib.sha256(config_bytes).hexdigest()
image_manifest = {
    "schemaVersion": 2,
    "mediaType": "application/vnd.oci.image.manifest.v1+json",
    "config": {
        "mediaType": "application/vnd.oci.image.config.v1+json",
        "digest": config_digest,
        "size": len(config_bytes),
    },
    "layers": [{
        "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
        "digest": layer_blob_digest,
        "size": len(layer_blob_bytes),
    }],
}
image_manifest_bytes = (json.dumps(image_manifest, sort_keys=True, separators=(",", ":")) + "\\n").encode("utf-8")
platform_manifest_digest = "sha256:" + hashlib.sha256(image_manifest_bytes).hexdigest()
image_id = config_digest
if platform_requested:
    image_id = platform_manifest_digest
elif image_id_mode == "index":
    image_id = "sha256:" + hashlib.sha256(f"fake index for {image_ref} {salt}\\n".encode("utf-8")).hexdigest()
inspect_payload = {
    "Id": image_id,
    "Descriptor": {
        "digest": image_id,
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "platform": {"architecture": config["architecture"], "os": config["os"]},
        "size": len(image_manifest_bytes),
    },
    "Architecture": config["architecture"],
    "Os": config["os"],
    "Created": config["created"],
    "Config": config["config"],
    "RootFS": {"Type": "layers", "Layers": config["rootfs"]["diff_ids"]},
}
if inspect_format == "{{json .}}":
    print(json.dumps(inspect_payload, sort_keys=True, separators=(",", ":")))
else:
    print(image_id)
PY
      fi
      exit 0
    fi
    ;;
  pull)
    exit 0
    ;;
  save)
    printf '%s\\n' "$*" >> "\${DOCKER_SAVE_ARGS_LOG:-${tempRoot}/docker-save-args.log}"
    output=''
    image=''
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
          image="$1"
          shift
          ;;
      esac
    done
    printf '%s\\n' "\${image}" >> "\${DOCKER_SAVE_LOG:-${tempRoot}/docker-save.log}"
    mkdir -p "$(dirname "$output")"
    temp_dir="$(mktemp -d)"
    python3 - "\${temp_dir}" "\${image}" "\${DOCKER_IMAGE_ID_SALT:-stable}" <<'PY'
import gzip
import hashlib
import io
import json
import pathlib
import sys
import tarfile

temp_dir = pathlib.Path(sys.argv[1])
image_ref = sys.argv[2]
salt = sys.argv[3]
layer_payload = f"fake layer for {image_ref} {salt}\\n".encode("utf-8")
layer_buffer = io.BytesIO()
with tarfile.open(fileobj=layer_buffer, mode="w") as layer_tar:
    info = tarfile.TarInfo("layer.txt")
    info.size = len(layer_payload)
    info.mode = 0o644
    info.mtime = 0
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    layer_tar.addfile(info, io.BytesIO(layer_payload))
layer_bytes = layer_buffer.getvalue()
layer_diff_id = "sha256:" + hashlib.sha256(layer_bytes).hexdigest()
layer_blob_bytes = gzip.compress(layer_bytes, mtime=0)
layer_blob_hex = hashlib.sha256(layer_blob_bytes).hexdigest()
config = {
    "architecture": "amd64",
    "config": {"Image": image_ref, "Salt": salt},
    "created": "2026-04-27T00:00:00Z",
    "os": "linux",
    "rootfs": {"diff_ids": [layer_diff_id], "type": "layers"},
}
config_bytes = (json.dumps(config, sort_keys=True, separators=(",", ":")) + "\\n").encode("utf-8")
config_hex = hashlib.sha256(config_bytes).hexdigest()
image_manifest = {
    "schemaVersion": 2,
    "mediaType": "application/vnd.oci.image.manifest.v1+json",
    "config": {
        "mediaType": "application/vnd.oci.image.config.v1+json",
        "digest": f"sha256:{config_hex}",
        "size": len(config_bytes),
    },
    "layers": [{
        "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
        "digest": f"sha256:{layer_blob_hex}",
        "size": len(layer_blob_bytes),
    }],
}
image_manifest_bytes = (json.dumps(image_manifest, sort_keys=True, separators=(",", ":")) + "\\n").encode("utf-8")
image_manifest_hex = hashlib.sha256(image_manifest_bytes).hexdigest()
index = {
    "schemaVersion": 2,
    "mediaType": "application/vnd.oci.image.index.v1+json",
    "manifests": [{
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "digest": f"sha256:{image_manifest_hex}",
        "size": len(image_manifest_bytes),
        "platform": {"architecture": "amd64", "os": "linux"},
    }],
}
blob_dir = temp_dir / "blobs" / "sha256"
blob_dir.mkdir(parents=True, exist_ok=True)
(blob_dir / layer_blob_hex).write_bytes(layer_blob_bytes)
(blob_dir / config_hex).write_bytes(config_bytes)
(blob_dir / image_manifest_hex).write_bytes(image_manifest_bytes)
(temp_dir / "manifest.json").write_text(
    json.dumps([{
        "Config": f"blobs/sha256/{config_hex}",
        "RepoTags": [image_ref],
        "Layers": [f"blobs/sha256/{layer_blob_hex}"],
    }], separators=(",", ":")) + "\\n",
    encoding="utf-8",
)
(temp_dir / "index.json").write_text(json.dumps(index, sort_keys=True, separators=(",", ":")) + "\\n", encoding="utf-8")
(temp_dir / "oci-layout").write_text('{"imageLayoutVersion":"1.0.0"}\\n', encoding="utf-8")
PY
    tar -C "\${temp_dir}" -cf "$output" manifest.json index.json oci-layout blobs
    rm -rf "\${temp_dir}"
    exit 0
    ;;
esac
exit 0
`,
  );
}

function runDemoBuildBundle(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [path.join(tempRoot, 'scripts', 'demo-deploy', 'build-offline-bundle.sh')],
    {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
        HOME: tempRoot,
        OUT_DIR: path.join(tempRoot, 'out'),
        RELEASE_ID: 'test-release',
        SKIP_BUNDLE_INPUTS_CHECK: '1',
        SKIP_RELEASE_PRECHECK: '1',
        ...extraEnv,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

function runDemoBuildBundleResult(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    'bash',
    [path.join(tempRoot, 'scripts', 'demo-deploy', 'build-offline-bundle.sh')],
    {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
        HOME: tempRoot,
        OUT_DIR: path.join(tempRoot, 'out'),
        RELEASE_ID: 'test-release',
        SKIP_BUNDLE_INPUTS_CHECK: '1',
        SKIP_RELEASE_PRECHECK: '1',
        ...extraEnv,
      },
      encoding: 'utf8',
    },
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('demo build bundle image archives', () => {
  it('builds without a sibling llm-universal-proxy worktree and records the external llmup image truth', () => {
    const parentRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-build-bundle-no-llmup-parent-'));
    const tempRoot = path.join(parentRoot, 'agentsmith');

    try {
      mkdirSync(tempRoot, { recursive: true });
      stageDemoBuildBundleFixture(tempRoot);
      rmSync(path.join(parentRoot, 'llm-universal-proxy'), { recursive: true, force: true });

      runDemoBuildBundle(tempRoot, {
        SKIP_RELEASE_ARCHIVE: '1',
        SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1',
      });

      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const version = readFileSync(path.join(bundleDir, 'VERSION'), 'utf8');

      expect(version).toContain('llmup_version=v0.2.25');
      expect(version).toContain(`llmup_source_image=${LLMUP_SOURCE_IMAGE}`);
      expect(version).toContain(`llmup_source_image_digest=${LLMUP_DIGEST}`);
      expect(version).toContain('llm_universal_proxy_image=llm-universal-proxy:v0.2.25');
    } finally {
      rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the llmup source image override is not pinned by digest', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-build-bundle-llmup-unpinned-'));

    try {
      stageDemoBuildBundleFixture(tempRoot);

      const result = runDemoBuildBundleResult(tempRoot, {
        LLMUP_SOURCE_IMAGE: 'ghcr.io/agentsmith-project/llm-universal-proxy:v0.2.25',
        SKIP_RELEASE_ARCHIVE: '1',
        SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1',
      });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('LLMUP_SOURCE_IMAGE must include a sha256 digest');
      expect(existsSync(path.join(bundleDir, 'VERSION'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when the llmup source image tag does not match LLMUP_VERSION', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-build-bundle-llmup-version-mismatch-'));

    try {
      stageDemoBuildBundleFixture(tempRoot);

      const result = runDemoBuildBundleResult(tempRoot, {
        LLMUP_VERSION: 'v0.2.26',
        LLMUP_SOURCE_IMAGE,
        SKIP_RELEASE_ARCHIVE: '1',
        SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1',
      });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('LLMUP_SOURCE_IMAGE tag must match LLMUP_VERSION');
      expect(existsSync(path.join(bundleDir, 'VERSION'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('writes an image archive manifest from docker save archive content and includes it in checksums', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-build-bundle-image-manifest-'));

    try {
      stageDemoBuildBundleFixture(tempRoot);

      runDemoBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const manifestPath = path.join(bundleDir, 'images', 'image-archives.manifest.json');
      const appArchiveRelpath = 'images/agentsmith-app-test-release.tar';
      const proxyArchiveRelpath = 'images/llm-universal-proxy-v0.2.25.tar';
      const appArchivePath = path.join(bundleDir, appArchiveRelpath);
      const appProof = readDockerArchiveProof(appArchivePath);
      const proxyProof = readDockerArchiveProof(path.join(bundleDir, proxyArchiveRelpath));
      const manifest = readJsonFile<ImageArchiveManifest>(manifestPath);
      const appManifestEntry = findManifestArchive(manifest, appArchiveRelpath);
      const proxyManifestEntry = findManifestArchive(manifest, proxyArchiveRelpath);
      const checksums = readFileSync(path.join(bundleDir, 'checksums.txt'), 'utf8');
      const manifestHex = sha256Digest(readFileSync(manifestPath)).slice('sha256:'.length);

      expect(manifest).toMatchObject({
        schema: 'image-archive-manifest.v1',
        version: 1,
        release_id: 'test-release',
      });
      expect(manifest.archives.length).toBeGreaterThan(1);
      expect(appManifestEntry).toMatchObject({
        image_ref: appProof.imageRef,
        archive_sha256: appProof.archiveDigest,
        archive_config_digest: appProof.configDigest,
        local_image_id: appProof.configDigest,
        local_config_digest: appProof.configDigest,
        platform: 'linux/amd64',
      });
      expect(appManifestEntry.image_ref).toBe('agentsmith-app:test-release');
      expect(proxyManifestEntry.image_ref).toBe('llm-universal-proxy:v0.2.25');
      expect(proxyManifestEntry.archive_config_digest).toBe(proxyProof.configDigest);
      expect(appManifestEntry.source_build_manifest_digest).toBeNull();
      expect(appManifestEntry.source_manifest_digest).toBeNull();
      expect(appManifestEntry.validator).toContain('manifest.json');
      expectNoEvidenceTruthFields(manifest);
      expect(checksums).toContain(`${manifestHex}  ./images/image-archives.manifest.json`);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30000);

  it('omits bundled image archives when SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1 while preserving bundle metadata', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-build-bundle-no-images-'));

    try {
      stageDemoBuildBundleFixture(tempRoot);

      runDemoBuildBundle(tempRoot, { SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1' });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');

      expect(existsSync(path.join(bundleDir, 'images'))).toBe(false);
      expect(existsSync(path.join(bundleDir, 'images', 'image-archives.manifest.json'))).toBe(false);
      expect(existsSync(path.join(bundleDir, 'skip-decisions.ndjson'))).toBe(false);
      expect(existsSync(path.join(tempRoot, 'out', '.image-archive-cache'))).toBe(false);
      expect(readFileSync(path.join(bundleDir, 'VERSION'), 'utf8')).toContain('bundled_image_archives_included=0');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('fills the image archive cache on first run and skips docker save on second run when the cache proof matches', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-build-bundle-image-cache-'));

    try {
      stageDemoBuildBundleFixture(tempRoot);
      const imageRef = 'agentsmith-app:test-release';
      const archiveRelpath = 'images/agentsmith-app-test-release.tar';
      const dependencyImageRef = 'pgvector/pgvector:pg16';
      const dependencyArchiveRelpath = 'images/pgvector-pgvector-pg16.tar';
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const cacheRoot = path.join(tempRoot, 'out', '.image-archive-cache', 'v1');

      runDemoBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });
      const firstRunSaveArgLines = readDockerSaveArgLines(tempRoot);
      const appSaveArgs = firstRunSaveArgLines.find((line) => line.includes(` ${imageRef} `));
      const dependencySaveArgs = firstRunSaveArgLines.find((line) => line.includes(` ${dependencyImageRef} `));

      expect(countDockerSaveCalls(tempRoot, imageRef)).toBe(1);
      expect(countDockerSaveCalls(tempRoot, dependencyImageRef)).toBe(1);
      expect(appSaveArgs).toBeDefined();
      expect(appSaveArgs).not.toContain('--platform');
      expect(dependencySaveArgs).toBeDefined();
      expect(dependencySaveArgs).toContain(`--platform linux/amd64 ${dependencyImageRef}`);
      expect(existsSync(cacheRoot)).toBe(true);
      expect(existsSync(path.join(bundleDir, 'skip-decisions.ndjson'))).toBe(false);

      rmSync(path.join(tempRoot, 'docker-save.log'), { force: true });
      rmSync(path.join(tempRoot, 'docker-save-args.log'), { force: true });
      runDemoBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });

      const archivePath = path.join(bundleDir, archiveRelpath);
      const dependencyArchivePath = path.join(bundleDir, dependencyArchiveRelpath);
      const proof = readDockerArchiveProof(archivePath);
      const dependencyProof = readDockerArchiveProof(dependencyArchivePath);
      const manifestPath = path.join(bundleDir, 'images', 'image-archives.manifest.json');
      const manifest = readJsonFile<ImageArchiveManifest>(manifestPath);
      const manifestEntry = findManifestArchive(manifest, archiveRelpath);
      const dependencyManifestEntry = findManifestArchive(manifest, dependencyArchiveRelpath);
      const checksums = readFileSync(path.join(bundleDir, 'checksums.txt'), 'utf8');
      const decisions = readNdjsonFile<BuildSkipDecision>(path.join(bundleDir, 'skip-decisions.ndjson'));
      const decision = decisions.find((entry) => entry.target === `image:${imageRef}`);
      const dependencyDecision = decisions.find((entry) => entry.target === `image:${dependencyImageRef}`);

      expect(countDockerSaveCalls(tempRoot, imageRef)).toBe(0);
      expect(countDockerSaveCalls(tempRoot, dependencyImageRef)).toBe(0);
      expect(existsSync(archivePath)).toBe(true);
      expect(existsSync(dependencyArchivePath)).toBe(true);
      expect(manifestEntry.archive_sha256).toBe(proof.archiveDigest);
      expect(manifestEntry.archive_config_digest).toBe(proof.configDigest);
      expect(manifestEntry.local_image_id).toBe(proof.configDigest);
      expect(dependencyManifestEntry).toMatchObject({
        image_ref: dependencyImageRef,
        archive_sha256: dependencyProof.archiveDigest,
        archive_config_digest: dependencyProof.configDigest,
        platform: 'linux/amd64',
      });
      expect(checksums).toContain(`${sha256Digest(readFileSync(archivePath)).slice('sha256:'.length)}  ./images/agentsmith-app-test-release.tar`);
      expect(checksums).toContain(`${sha256Digest(readFileSync(dependencyArchivePath)).slice('sha256:'.length)}  ./images/pgvector-pgvector-pg16.tar`);
      expect(checksums).toContain(`${sha256Digest(readFileSync(manifestPath)).slice('sha256:'.length)}  ./images/image-archives.manifest.json`);
      expect(decision).toBeDefined();
      expectDockerSaveSkipDecision(decision, imageRef, proof.configDigest);
      expect(decision?.existing_artifact_digest).toBe(proof.archiveDigest);
      expect(dependencyDecision).toBeDefined();
      expect(dependencyProof.platformManifestDigest).toBeDefined();
      expectDockerSaveSkipDecision(
        dependencyDecision,
        dependencyImageRef,
        dependencyProof.platformManifestDigest as string,
      );
      expect(dependencyDecision?.existing_artifact_digest).toBe(dependencyProof.archiveDigest);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30000);

  it('accepts a platform OCI archive when docker inspect reports an external index digest', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'demo-build-bundle-platform-index-'));

    try {
      stageDemoBuildBundleFixture(tempRoot);
      const dependencyImageRef = 'pgvector/pgvector:pg16';
      const dependencyArchiveRelpath = 'images/pgvector-pgvector-pg16.tar';
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');

      runDemoBuildBundle(tempRoot, { DOCKER_IMAGE_ID_MODE: 'index', SKIP_RELEASE_ARCHIVE: '1' });
      rmSync(path.join(tempRoot, 'docker-save.log'), { force: true });
      runDemoBuildBundle(tempRoot, { DOCKER_IMAGE_ID_MODE: 'index', SKIP_RELEASE_ARCHIVE: '1' });

      const dependencyArchivePath = path.join(bundleDir, dependencyArchiveRelpath);
      const dependencyProof = readDockerArchiveProof(dependencyArchivePath);
      const manifest = readJsonFile<ImageArchiveManifest>(
        path.join(bundleDir, 'images', 'image-archives.manifest.json'),
      );
      const dependencyManifestEntry = findManifestArchive(manifest, dependencyArchiveRelpath);
      const decisions = readNdjsonFile<BuildSkipDecision>(path.join(bundleDir, 'skip-decisions.ndjson'));
      const dependencyDecision = decisions.find((entry) => entry.target === `image:${dependencyImageRef}`);

      expect(countDockerSaveCalls(tempRoot, dependencyImageRef)).toBe(0);
      expect(dependencyProof.platformManifestDigest).toBeDefined();
      expect(dependencyManifestEntry).toMatchObject({
        image_ref: dependencyImageRef,
        archive_sha256: dependencyProof.archiveDigest,
        archive_config_digest: dependencyProof.configDigest,
        local_image_id: fakeIndexDigest(dependencyImageRef),
        local_config_digest: null,
        platform: 'linux/amd64',
      });
      expect(dependencyDecision).toBeDefined();
      expectDockerSaveSkipDecision(
        dependencyDecision,
        dependencyImageRef,
        dependencyProof.platformManifestDigest as string,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30000);
});
