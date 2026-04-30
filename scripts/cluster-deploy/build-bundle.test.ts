import { execFileSync } from 'node:child_process';
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

  return {
    archiveDigest: sha256Digest(readFileSync(archivePath)),
    configDigest: sha256Digest(configBytes),
    imageRef: entry.RepoTags[0],
  };
}

function readArchiveMember(archivePath: string, memberName: string): Buffer {
  return execFileSync('tar', ['-xOf', archivePath, memberName]);
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

function findCacheArchiveForImage(tempRoot: string, imageRef: string): string {
  const cacheTarPaths = execFileSync(
    'find',
    [path.join(tempRoot, 'out', '.image-archive-cache', 'v1'), '-type', 'f', '-name', 'archive.tar'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  const cacheTar = cacheTarPaths.find((cacheTarPath) => {
    try {
      return readDockerArchiveProof(cacheTarPath).imageRef === imageRef;
    } catch {
      return false;
    }
  });
  expect(cacheTar).toBeDefined();
  return cacheTar as string;
}

function writeCacheArchiveWithLayerProblem(cacheArchivePath: string, problem: 'missing-layer' | 'diff-id-mismatch'): void {
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOf', cacheArchivePath, 'manifest.json'], { encoding: 'utf8' }),
  ) as DockerSaveManifestEntry[];
  const configPath = manifest[0]?.Config;
  expect(configPath).toBeDefined();
  const configBytes = readArchiveMember(cacheArchivePath, configPath as string);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cluster-bad-image-cache-'));

  try {
    writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    writeFile(path.join(tempDir, configPath as string), configBytes.toString('utf8'));

    if (problem === 'missing-layer') {
      manifest[0].Layers = ['missing-layer.tar'];
      writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      execFileSync('tar', ['-C', tempDir, '-cf', cacheArchivePath, 'manifest.json', configPath as string]);
      return;
    }

    manifest[0].Layers = ['layer.tar'];
    writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    writeFile(path.join(tempDir, 'layer.tar'), 'not the layer bytes described by config rootfs.diff_ids\n');
    execFileSync('tar', ['-C', tempDir, '-cf', cacheArchivePath, 'manifest.json', configPath as string, 'layer.tar']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function stageClusterBuildBundleFixture(tempRoot: string): void {
  const siblingRoot = path.dirname(tempRoot);
  mkdirSync(path.join(siblingRoot, 'mbos-sandbox-v1', 'manager-service'), { recursive: true });

  mkdirSync(path.join(tempRoot, 'scripts', 'cluster-deploy'), { recursive: true });
  copyFileSync(
    path.join(repoRoot, 'scripts', 'cluster-deploy', 'build-bundle.sh'),
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-bundle.sh'),
  );

  writeFile(
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'lib.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "\${SCRIPT_DIR}/../.." && pwd)"
export DEPLOY_ROOT_DEFAULT="\${CLUSTER_DEPLOY_ROOT:-\${HOME}/agentsmith/cluster-deploy}"
export DEPLOY_LOG_PREFIX="\${DEPLOY_LOG_PREFIX:-cluster-build-test}"
source "\${ROOT_DIR}/scripts/lib/deploy-common.sh"
ensure_operator_registry_env() { :; }
load_registry_env() {
  export REGISTRY_HOST="\${REGISTRY_HOST:-localhost:5001}"
  export REGISTRY_PROJECT="\${REGISTRY_PROJECT:-mbos}"
  export K8S_REGISTRY_HOST="\${K8S_REGISTRY_HOST:-kind-registry:5000}"
}
`,
  );
  writeExecutable(
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-images.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
release_alias="\${RELEASE_ID}"
if [[ "\${release_alias}" != release-* ]]; then
  release_alias="release-\${release_alias}"
fi
cat > "\${RELEASE_ROOT}/build-images-env.log" <<EOF
UNIVERSAL_PROXY_SOURCE_DIR_OVERRIDE=\${UNIVERSAL_PROXY_SOURCE_DIR_OVERRIDE:-}
EOF
cat > "\${RELEASE_ROOT}/VERSION" <<EOF
release_id=\${RELEASE_ID}
agentsmith_app_image=localhost:5001/mbos/agentsmith-app:\${release_alias}
agentsmith_runner_image=localhost:5001/mbos/agentsmith-notebook-codex-runner:\${RELEASE_ID}
agentsmith_chat_runner_image=localhost:5001/mbos/agentsmith-chat-llm-runner:\${RELEASE_ID}
agentsmith_chat_runner_k8s_image=kind-registry:5000/mbos/agentsmith-chat-llm-runner:\${RELEASE_ID}
agentsmith_verify_runner_image=localhost:5001/mbos/agentsmith-verify-runner:\${RELEASE_ID}
sandbox_manager_image=localhost:5001/mbos/sandbox-manager:\${RELEASE_ID}
llm_universal_proxy_image=localhost:5001/mbos/llm-universal-proxy:v0.2.25
llmup_version=v0.2.25
llmup_source_image=${LLMUP_SOURCE_IMAGE}
llmup_source_image_digest=${LLMUP_DIGEST}
registry_host=localhost:5001
registry_project=mbos
EOF
if [[ "\${WRITE_BUILD_MANIFEST:-0}" == "1" ]]; then
  cat > "\${RELEASE_ROOT}/build-manifest.json" <<EOF_MANIFEST
{"schema":"cluster-build-test-manifest.v1","release_id":"\${RELEASE_ID}","targets":[]}
EOF_MANIFEST
fi
`,
  );
  writeExecutable(
    path.join(tempRoot, 'scripts', 'cluster-deploy', 'verify.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\n',
  );

  writeExecutable(
    path.join(tempRoot, 'scripts', 'lib', 'ensure-juicefs-vendor.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\n',
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
    'scripts/cluster-upgrade-smoke.sh',
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
    path.join(repoRoot, 'scripts', 'lib', 'deploy-common.sh'),
    path.join(tempRoot, 'scripts', 'lib', 'deploy-common.sh'),
  );
  copyFileSync(
    path.join(repoRoot, 'scripts', 'lib', 'image-archive-manifest.sh'),
    path.join(tempRoot, 'scripts', 'lib', 'image-archive-manifest.sh'),
  );

  writeFile(path.join(tempRoot, 'scripts', 'notebook-agent-refresh-token.js'), 'console.log("ok");\n');
  writeFile(path.join(tempRoot, 'infra', 'runtime', 'presets.env'), 'PRESET_ENDPOINT_MODEL=placeholder-model\n');

  writeFile(path.join(tempRoot, 'infra', 'deploy', 'cluster', 'docker-compose.yml'), 'services: {}\n');
  writeFile(
    path.join(tempRoot, 'infra', 'deploy', 'cluster', 'deployment.manifest.json'),
    JSON.stringify({
      bundle_files: [],
      bundle_source_sets: [
        {
          name: 'backend_real_story_verify_source_set',
          helper: 'scripts/lib/release-story-verify-source-set.sh',
        },
      ],
    }, null, 2),
  );
  for (const relativePath of [
    'infra/deploy/cluster/env/site.env.example',
    'infra/deploy/cluster/env/registry.env.example',
    'infra/deploy/cluster/env/kubeconfig.example.yaml',
    'infra/deploy/cluster/env/admin-kubeconfig.example.yaml',
    'infra/deploy/cluster/env/manager-kubeconfig.example.yaml',
    'infra/integration/postgres-init/001-create-databases.sql',
    'packages/adapters-private/sql/projects.sql',
    'infra/integration/minio/init-minio.sh',
    'infra/integration/keycloak/realm-mbos-dev.json',
    'infra/deploy/shared/universal-proxy/config.yaml',
    'docs/user-guides/cluster-admin-runbook.md',
    'docs/contracts/cluster-deployment-spec-v1.md',
    'docs/user-guides/cluster-deploy-operations.md',
    'docs/user-guides/cluster-upgrade-operations.md',
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
  ]) {
    writeFile(path.join(tempRoot, relativePath), 'placeholder\n');
  }
  writeFile(path.join(tempRoot, 'infra', 'deploy', 'cluster', 'admin-examples', 'placeholder.yaml'), 'apiVersion: v1\n');
  writeFile(path.join(tempRoot, 'infra', 'deploy', 'cluster', 'addons', 'ingress-nginx', 'upstream-deploy.yaml'), 'apiVersion: v1\n');
  writeFile(path.join(tempRoot, 'infra', 'deploy', 'cluster', 'addons', 'juicefs-csi', 'upstream-manifest.yaml'), 'apiVersion: v1\n');

  const binDir = path.join(tempRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeExecutable(path.join(binDir, 'kubectl'), '#!/usr/bin/env bash\nset -euo pipefail\n');
  writeExecutable(
    path.join(binDir, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  image)
    if [[ "$2" == "inspect" ]]; then
      if [[ "\${3:-}" == "--format" ]]; then
        format="\${4:-}"
        image_ref="\${@: -1}"
        python3 - "\${image_ref}" "\${DOCKER_IMAGE_ID_SALT:-stable}" "\${format}" "\${DOCKER_IMAGE_ID_MODE:-config}" <<'PY'
import hashlib
import io
import json
import sys
import tarfile

image_ref = sys.argv[1]
salt = sys.argv[2]
inspect_format = sys.argv[3]
image_id_mode = sys.argv[4]
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
layer_diff_id = "sha256:" + hashlib.sha256(layer_buffer.getvalue()).hexdigest()
config = {
    "architecture": "amd64",
    "config": {"Image": image_ref, "Salt": salt},
    "created": "2026-04-27T00:00:00Z",
    "os": "linux",
    "rootfs": {"diff_ids": [layer_diff_id], "type": "layers"},
}
data = (json.dumps(config, sort_keys=True, separators=(",", ":")) + "\\n").encode("utf-8")
config_digest = "sha256:" + hashlib.sha256(data).hexdigest()
image_id = config_digest
if image_id_mode == "index":
    image_id = "sha256:" + hashlib.sha256(f"fake index for {image_ref} {salt}\\n".encode("utf-8")).hexdigest()
inspect_payload = {
    "Id": image_id,
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
  pull|tag)
    exit 0
    ;;
  save)
    output=''
    image=''
    shift
    while [[ "$#" -gt 0 ]]; do
      case "$1" in
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
    if [[ "\${DOCKER_SAVE_INVALID_ARCHIVE_FOR:-}" == "\${image}" ]]; then
      printf '{}\\n' > "\${temp_dir}/config.json"
      tar -C "\${temp_dir}" -cf "$output" config.json
      rm -rf "\${temp_dir}"
      exit 0
    fi
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
blob_dir = temp_dir / "blobs" / "sha256"
blob_dir.mkdir(parents=True, exist_ok=True)
(blob_dir / layer_blob_hex).write_bytes(layer_blob_bytes)
(blob_dir / config_hex).write_bytes(config_bytes)
(temp_dir / "manifest.json").write_text(
    json.dumps([{
        "Config": f"blobs/sha256/{config_hex}",
        "RepoTags": [image_ref],
        "Layers": [f"blobs/sha256/{layer_blob_hex}"],
    }], separators=(",", ":")) + "\\n",
    encoding="utf-8",
)
(temp_dir / "oci-layout").write_text('{"imageLayoutVersion":"1.0.0"}\\n', encoding="utf-8")
PY
    tar -C "\${temp_dir}" -cf "$output" manifest.json oci-layout blobs
    rm -rf "\${temp_dir}"
    exit 0
    ;;
esac
exit 0
`,
  );
}

function runClusterBuildBundle(tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'bash',
    [path.join(tempRoot, 'scripts', 'cluster-deploy', 'build-bundle.sh')],
    {
      cwd: tempRoot,
      env: {
        ...process.env,
        PATH: `${path.join(tempRoot, 'bin')}:${process.env.PATH}`,
        HOME: tempRoot,
        OUT_DIR: path.join(tempRoot, 'out'),
        RELEASE_ID: 'test-release',
        SKIP_BUNDLE_INPUTS_CHECK: '1',
        ...extraEnv,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
}

describe('cluster build bundle archive packaging', () => {
  it('builds without a sibling llm-universal-proxy worktree and does not pass an llmup source override', () => {
    const parentRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-no-llmup-parent-'));
    const tempRoot = path.join(parentRoot, 'agentsmith');

    try {
      mkdirSync(tempRoot, { recursive: true });
      stageClusterBuildBundleFixture(tempRoot);
      rmSync(path.join(parentRoot, 'llm-universal-proxy'), { recursive: true, force: true });

      runClusterBuildBundle(tempRoot, {
        SKIP_RELEASE_ARCHIVE: '1',
        SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1',
      });

      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const buildImagesEnv = readFileSync(path.join(bundleDir, 'build-images-env.log'), 'utf8');
      const version = readFileSync(path.join(bundleDir, 'VERSION'), 'utf8');

      expect(buildImagesEnv).toContain('UNIVERSAL_PROXY_SOURCE_DIR_OVERRIDE=');
      expect(buildImagesEnv).not.toContain('llm-universal-proxy');
      expect(version).toContain('llmup_version=v0.2.25');
      expect(version).toContain(`llmup_source_image=${LLMUP_SOURCE_IMAGE}`);
      expect(version).toContain(`llmup_source_image_digest=${LLMUP_DIGEST}`);
      expect(version).toContain(
        'llm_universal_proxy_image=localhost:5001/mbos/llm-universal-proxy:v0.2.25',
      );
    } finally {
      rmSync(parentRoot, { recursive: true, force: true });
    }
  });

  it('writes the release archive by default', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-default-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);

      const output = runClusterBuildBundle(tempRoot);
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const archivePath = path.join(tempRoot, 'out', 'agentsmith-test-release.tar.gz');

      expect(output).toContain(`bundle ready: ${archivePath}`);
      expect(existsSync(bundleDir)).toBe(true);
      expect(existsSync(path.join(bundleDir, 'VERSION'))).toBe(true);
      expect(existsSync(path.join(bundleDir, 'checksums.txt'))).toBe(true);
      expect(existsSync(archivePath)).toBe(true);

      const manifestPath = path.join(bundleDir, 'images', 'image-archives.manifest.json');
      const manifest = readJsonFile<ImageArchiveManifest>(manifestPath);
      const appArchiveRelpath = 'images/localhost-5001-mbos-agentsmith-app-release-test-release.tar';
      const proxyArchiveRelpath = 'images/localhost-5001-mbos-llm-universal-proxy-v0.2.25.tar';
      const appArchivePath = path.join(bundleDir, appArchiveRelpath);
      const appProof = readDockerArchiveProof(appArchivePath);
      const appManifestEntry = findManifestArchive(manifest, appArchiveRelpath);
      const proxyProof = readDockerArchiveProof(path.join(bundleDir, proxyArchiveRelpath));
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
      expect(proxyManifestEntry).toMatchObject({
        image_ref: proxyProof.imageRef,
        archive_config_digest: proxyProof.configDigest,
      });
      expect(appManifestEntry.image_ref).toBe('localhost:5001/mbos/agentsmith-app:release-test-release');
      expect(appManifestEntry.source_build_manifest_digest).toBeNull();
      expect(appManifestEntry.source_manifest_digest).toBeNull();
      expect(appManifestEntry.validator).toContain('manifest.json');
      expectNoEvidenceTruthFields(manifest);
      expect(checksums).toContain(`${manifestHex}  ./images/image-archives.manifest.json`);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 15000);

  it('records the source build manifest digest when build-manifest.json exists', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-source-manifest-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);

      runClusterBuildBundle(tempRoot, {
        SKIP_RELEASE_ARCHIVE: '1',
        WRITE_BUILD_MANIFEST: '1',
      });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const sourceManifestPath = path.join(bundleDir, 'build-manifest.json');
      const expectedDigest = sha256Digest(readFileSync(sourceManifestPath));
      const manifest = readJsonFile<ImageArchiveManifest>(
        path.join(bundleDir, 'images', 'image-archives.manifest.json'),
      );

      expect(manifest.archives.length).toBeGreaterThan(1);
      for (const archive of manifest.archives) {
        expect(archive.source_manifest_digest).toBe(expectedDigest);
        expect(archive.source_build_manifest_digest).toBe(expectedDigest);
      }
      expectNoEvidenceTruthFields(manifest);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 15000);

  it('skips release archive packaging when SKIP_RELEASE_ARCHIVE=1 while keeping the bundle directory intact', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-skip-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);

      const output = runClusterBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const archivePath = path.join(tempRoot, 'out', 'agentsmith-test-release.tar.gz');

      expect(output).toContain(`[cluster-build-test] skipped release archive packaging for ${bundleDir}`);
      expect(existsSync(bundleDir)).toBe(true);
      expect(existsSync(path.join(bundleDir, 'VERSION'))).toBe(true);
      expect(existsSync(path.join(bundleDir, 'checksums.txt'))).toBe(true);
      expect(existsSync(archivePath)).toBe(false);
      expect(readFileSync(path.join(bundleDir, 'VERSION'), 'utf8')).toContain('release_id=test-release');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 15000);

  it('omits bundled image archives when SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION=1 while preserving bundle metadata', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-no-images-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);

      runClusterBuildBundle(tempRoot, { SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1' });
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
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-image-cache-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);
      const imageRef = 'localhost:5001/mbos/agentsmith-app:release-test-release';
      const archiveRelpath = 'images/localhost-5001-mbos-agentsmith-app-release-test-release.tar';
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const cacheRoot = path.join(tempRoot, 'out', '.image-archive-cache', 'v1');

      runClusterBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });
      expect(countDockerSaveCalls(tempRoot, imageRef)).toBe(1);
      expect(existsSync(cacheRoot)).toBe(true);
      expect(existsSync(path.join(bundleDir, 'skip-decisions.ndjson'))).toBe(false);

      rmSync(path.join(tempRoot, 'docker-save.log'), { force: true });
      runClusterBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });

      const archivePath = path.join(bundleDir, archiveRelpath);
      const proof = readDockerArchiveProof(archivePath);
      const manifestPath = path.join(bundleDir, 'images', 'image-archives.manifest.json');
      const manifest = readJsonFile<ImageArchiveManifest>(manifestPath);
      const manifestEntry = findManifestArchive(manifest, archiveRelpath);
      const checksums = readFileSync(path.join(bundleDir, 'checksums.txt'), 'utf8');
      const decisions = readNdjsonFile<BuildSkipDecision>(path.join(bundleDir, 'skip-decisions.ndjson'));
      const decision = decisions.find((entry) => entry.target === `image:${imageRef}`);

      expect(countDockerSaveCalls(tempRoot, imageRef)).toBe(0);
      expect(existsSync(archivePath)).toBe(true);
      expect(manifestEntry.archive_sha256).toBe(proof.archiveDigest);
      expect(manifestEntry.archive_config_digest).toBe(proof.configDigest);
      expect(manifestEntry.local_image_id).toBe(proof.configDigest);
      expect(checksums).toContain(`${sha256Digest(readFileSync(archivePath)).slice('sha256:'.length)}  ./images/localhost-5001-mbos-agentsmith-app-release-test-release.tar`);
      expect(checksums).toContain(`${sha256Digest(readFileSync(manifestPath)).slice('sha256:'.length)}  ./images/image-archives.manifest.json`);
      expect(decision).toBeDefined();
      expectDockerSaveSkipDecision(decision, imageRef, proof.configDigest);
      expect(decision?.existing_artifact_digest).toBe(proof.archiveDigest);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30000);

  it('accepts an OCI archive when docker inspect reports an external index digest', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-platform-index-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);
      const imageRef = 'localhost:5001/mbos/agentsmith-app:release-test-release';
      const archiveRelpath = 'images/localhost-5001-mbos-agentsmith-app-release-test-release.tar';
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');

      runClusterBuildBundle(tempRoot, { DOCKER_IMAGE_ID_MODE: 'index', SKIP_RELEASE_ARCHIVE: '1' });

      const archivePath = path.join(bundleDir, archiveRelpath);
      const proof = readDockerArchiveProof(archivePath);
      const manifest = readJsonFile<ImageArchiveManifest>(
        path.join(bundleDir, 'images', 'image-archives.manifest.json'),
      );
      const manifestEntry = findManifestArchive(manifest, archiveRelpath);

      expect(manifestEntry).toMatchObject({
        image_ref: imageRef,
        archive_sha256: proof.archiveDigest,
        archive_config_digest: proof.configDigest,
        local_image_id: fakeIndexDigest(imageRef),
        local_config_digest: null,
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30000);

  it('fails closed to docker save when a cached archive is corrupt and does not write a docker_save skip decision', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-image-cache-corrupt-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);
      const imageRef = 'localhost:5001/mbos/agentsmith-app:release-test-release';
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');

      runClusterBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });
      const appCacheTar = findCacheArchiveForImage(tempRoot, imageRef);
      writeFileSync(appCacheTar, 'not a tar archive\n', 'utf8');

      rmSync(path.join(tempRoot, 'docker-save.log'), { force: true });
      runClusterBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });

      const decisionsPath = path.join(bundleDir, 'skip-decisions.ndjson');
      const decisions = existsSync(decisionsPath) ? readNdjsonFile<BuildSkipDecision>(decisionsPath) : [];

      expect(countDockerSaveCalls(tempRoot, imageRef)).toBe(1);
      expect(decisions.some((entry) => entry.target === `image:${imageRef}` && entry.operation === 'docker_save')).toBe(false);
      expect(readDockerArchiveProof(path.join(bundleDir, 'images', 'localhost-5001-mbos-agentsmith-app-release-test-release.tar')).imageRef).toBe(imageRef);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30000);

  it.each([
    ['missing-layer' as const],
    ['diff-id-mismatch' as const],
  ])('fails closed to docker save when cached archive has %s proof drift', (problem) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), `cluster-build-bundle-image-cache-${problem}-`));

    try {
      stageClusterBuildBundleFixture(tempRoot);
      const imageRef = 'localhost:5001/mbos/agentsmith-app:release-test-release';
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');

      runClusterBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });
      const appCacheTar = findCacheArchiveForImage(tempRoot, imageRef);
      const originalProof = readDockerArchiveProof(appCacheTar);
      writeCacheArchiveWithLayerProblem(appCacheTar, problem);
      expect(readDockerArchiveProof(appCacheTar).configDigest).toBe(originalProof.configDigest);

      rmSync(path.join(tempRoot, 'docker-save.log'), { force: true });
      runClusterBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1' });

      const decisionsPath = path.join(bundleDir, 'skip-decisions.ndjson');
      const decisions = existsSync(decisionsPath) ? readNdjsonFile<BuildSkipDecision>(decisionsPath) : [];

      expect(countDockerSaveCalls(tempRoot, imageRef)).toBe(1);
      expect(decisions.some((entry) => entry.target === `image:${imageRef}` && entry.operation === 'docker_save')).toBe(false);
      expect(readDockerArchiveProof(path.join(bundleDir, 'images', 'localhost-5001-mbos-agentsmith-app-release-test-release.tar')).configDigest).toBe(originalProof.configDigest);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 30000);

  it('binds the cache key to the local image config digest instead of only the archive filename or tag', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-image-cache-digest-key-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);
      const imageRef = 'localhost:5001/mbos/agentsmith-app:release-test-release';
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      const archivePath = path.join(bundleDir, 'images', 'localhost-5001-mbos-agentsmith-app-release-test-release.tar');

      runClusterBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1', DOCKER_IMAGE_ID_SALT: 'first' });
      const firstArchiveProof = readDockerArchiveProof(archivePath);
      rmSync(path.join(tempRoot, 'docker-save.log'), { force: true });
      runClusterBuildBundle(tempRoot, { SKIP_RELEASE_ARCHIVE: '1', DOCKER_IMAGE_ID_SALT: 'second' });

      const archiveProof = readDockerArchiveProof(archivePath);
      const decisionsPath = path.join(bundleDir, 'skip-decisions.ndjson');
      const decisions = existsSync(decisionsPath) ? readNdjsonFile<BuildSkipDecision>(decisionsPath) : [];

      expect(countDockerSaveCalls(tempRoot, imageRef)).toBe(1);
      expect(archiveProof.configDigest).not.toBe(firstArchiveProof.configDigest);
      expect(decisions.some((entry) => entry.target === `image:${imageRef}` && entry.operation === 'docker_save')).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 15000);

  it('fails instead of inferring manifest proof from an archive filename when archive manifest.json is missing', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-invalid-image-archive-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);

      expect(() =>
        runClusterBuildBundle(tempRoot, {
          DOCKER_SAVE_INVALID_ARCHIVE_FOR: 'localhost:5001/mbos/agentsmith-app:release-test-release',
        }),
      ).toThrow();

      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');
      expect(existsSync(path.join(bundleDir, 'images', 'image-archives.manifest.json'))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('uses the explicit bundle RELEASE_ID even when current/VERSION has another release id', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-current-truth-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);
      const deployRoot = path.join(tempRoot, 'cluster-deploy-root');
      const currentRoot = path.join(deployRoot, 'current');
      mkdirSync(currentRoot, { recursive: true });
      writeFileSync(path.join(currentRoot, 'VERSION'), 'release_id=current-release\n', 'utf8');

      runClusterBuildBundle(tempRoot, { CLUSTER_DEPLOY_ROOT: deployRoot, RELEASE_ID: 'new-release' });
      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-new-release');
      const version = readFileSync(path.join(bundleDir, 'VERSION'), 'utf8');

      expect(version).toContain('release_id=new-release');
      expect(version).not.toContain('current-release');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 15000);

  it('does not pass UNIVERSAL_PROXY_ROOT_OVERRIDE through as an llmup source override', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'cluster-build-bundle-ignore-llmup-override-'));

    try {
      stageClusterBuildBundleFixture(tempRoot);
      const fixedLlmupRoot = path.join(tempRoot, 'fixed-llmup-worktree');
      mkdirSync(fixedLlmupRoot, { recursive: true });

      runClusterBuildBundle(tempRoot, {
        SKIP_RELEASE_ARCHIVE: '1',
        SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION: '1',
        UNIVERSAL_PROXY_ROOT_OVERRIDE: fixedLlmupRoot,
      });

      const bundleDir = path.join(tempRoot, 'out', 'agentsmith-test-release');

      expect(readFileSync(path.join(bundleDir, 'build-images-env.log'), 'utf8')).toContain(
        'UNIVERSAL_PROXY_SOURCE_DIR_OVERRIDE=',
      );
      expect(readFileSync(path.join(bundleDir, 'build-images-env.log'), 'utf8')).not.toContain(fixedLlmupRoot);
      expect(readFileSync(path.join(bundleDir, 'VERSION'), 'utf8')).toContain(
        'llm_universal_proxy_image=localhost:5001/mbos/llm-universal-proxy:v0.2.25',
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
