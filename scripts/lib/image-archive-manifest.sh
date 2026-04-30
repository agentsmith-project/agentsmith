#!/usr/bin/env bash
set -euo pipefail

IMAGE_ARCHIVE_CACHE_SCHEMA_VERSION="image-archive-cache.v1"
IMAGE_ARCHIVE_CACHE_SKIP_VALIDATOR="docker save archive manifest.json single RepoTag, Layers members, OCI blob sha256 or legacy rootfs.diff_ids layer sha256, Config bytes digest, local image identity/config-rootfs proof, archive sha256, and docker image inspect --format {{.Id}}/{{json .}}"

image_archive_cache_root() {
  local out_dir="$1"
  if [[ -n "${IMAGE_ARCHIVE_CACHE_DIR:-}" ]]; then
    printf '%s\n' "${IMAGE_ARCHIVE_CACHE_DIR}"
    return 0
  fi

  printf '%s/.image-archive-cache/v1\n' "${out_dir}"
}

image_archive_generated_at() {
  if [[ -n "${BUILD_ARTIFACT_BROKER_GENERATED_AT:-}" ]]; then
    printf '%s' "${BUILD_ARTIFACT_BROKER_GENERATED_AT}"
    return 0
  fi

  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

image_archive_local_image_id() {
  local image_ref="$1"
  local inspect_output
  local image_id

  if ! inspect_output="$(docker image inspect --format '{{.Id}}' "${image_ref}" 2>/dev/null)"; then
    return 1
  fi

  image_id="$(printf '%s\n' "${inspect_output}" | awk 'NF { print; exit }')"
  if [[ ! "${image_id}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    return 1
  fi

  printf '%s\n' "${image_id}"
}

image_archive_local_export_digest() {
  local image_ref="$1"
  local save_mode="$2"
  local save_platform="$3"
  local inspect_output
  local export_digest

  if [[ "${save_mode}" == "platform" ]]; then
    if inspect_output="$(docker image inspect --platform "${save_platform}" --format '{{json .}}' "${image_ref}" 2>/dev/null)" \
      && export_digest="$(python3 -c '
import json
import re
import sys

digest_pattern = re.compile(r"^sha256:[a-f0-9]{64}$")
try:
    payload = json.loads(sys.argv[1])
except (IndexError, json.JSONDecodeError):
    raise SystemExit(1)
if not isinstance(payload, dict):
    raise SystemExit(1)
descriptor = payload.get("Descriptor")
descriptor_digest = descriptor.get("digest") if isinstance(descriptor, dict) else None
image_id = payload.get("Id")
for value in (descriptor_digest, image_id):
    if isinstance(value, str) and digest_pattern.match(value):
        print(value)
        raise SystemExit(0)
raise SystemExit(1)
' "${inspect_output}")"; then
      printf '%s\n' "${export_digest}"
      return 0
    fi
  fi

  image_archive_local_image_id "${image_ref}"
}

image_archive_cache_key() {
  local image_ref="$1"
  local local_image_id="$2"
  local save_mode="$3"
  local save_platform="$4"

  {
    printf '%s\0' "${IMAGE_ARCHIVE_CACHE_SCHEMA_VERSION}"
    printf '%s\0' "docker_save"
    printf '%s\0' "${image_ref}"
    printf '%s\0' "${local_image_id}"
    printf '%s\0' "${save_mode}"
    printf '%s\0' "${save_platform}"
  } | sha256sum | awk '{ print $1 }'
}

image_archive_verify_archive() {
  local archive_path="$1"
  local expected_image_ref="$2"
  local expected_config_digest="$3"

  python3 - "${archive_path}" "${expected_image_ref}" "${expected_config_digest}" <<'PY'
import gzip
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tarfile

archive_path = pathlib.Path(sys.argv[1])
expected_image_ref = sys.argv[2]
expected_config_digest = sys.argv[3]
digest_pattern = re.compile(r"^sha256:[a-f0-9]{64}$")
image_ref_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]*$")


def fail(message):
    raise SystemExit(message)


def sha256_bytes(content):
    return "sha256:" + hashlib.sha256(content).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def is_safe_archive_path(value):
    if not isinstance(value, str) or not value or value.startswith("/") or value.startswith("-"):
        return False
    return all(part not in {"", ".", ".."} for part in value.split("/"))


def read_member_bytes(archive, member_name):
    try:
        member = archive.getmember(member_name)
    except KeyError:
        fail(f"missing_archive_member:{member_name}")
    if not member.isfile():
        fail(f"archive_member_not_file:{member_name}")
    extracted = archive.extractfile(member)
    if extracted is None:
        fail(f"archive_member_unreadable:{member_name}")
    return extracted.read()


def sha256_archive_member(archive, member_name):
    try:
        member = archive.getmember(member_name)
    except KeyError:
        fail(f"missing_archive_member:{member_name}")
    if not member.isfile():
        fail(f"archive_member_not_file:{member_name}")
    extracted = archive.extractfile(member)
    if extracted is None:
        fail(f"archive_member_unreadable:{member_name}")
    digest = hashlib.sha256()
    for chunk in iter(lambda: extracted.read(1024 * 1024), b""):
        digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def sha256_gzip_uncompressed_archive_member(archive, member_name):
    try:
        member = archive.getmember(member_name)
    except KeyError:
        fail(f"missing_archive_member:{member_name}")
    if not member.isfile():
        fail(f"archive_member_not_file:{member_name}")
    extracted = archive.extractfile(member)
    if extracted is None:
        fail(f"archive_member_unreadable:{member_name}")
    digest = hashlib.sha256()
    try:
        with gzip.GzipFile(fileobj=extracted) as gzip_member:
            for chunk in iter(lambda: gzip_member.read(1024 * 1024), b""):
                digest.update(chunk)
    except (EOFError, OSError):
        return None
    return "sha256:" + digest.hexdigest()


def oci_blob_digest_from_path(member_name):
    prefix = "blobs/sha256/"
    if not isinstance(member_name, str) or not member_name.startswith(prefix):
        return None
    hex_digest = member_name[len(prefix):]
    if re.fullmatch(r"[a-f0-9]{64}", hex_digest):
        return "sha256:" + hex_digest
    return None


def archive_has_matching_oci_blob(archive, digest):
    if not digest_pattern.match(digest):
        return False
    member_name = "blobs/sha256/" + digest.removeprefix("sha256:")
    try:
        return sha256_archive_member(archive, member_name) == digest
    except SystemExit:
        return False


def read_verified_oci_blob(archive, digest):
    if not digest_pattern.match(digest):
        return None
    member_name = "blobs/sha256/" + digest.removeprefix("sha256:")
    try:
        member = archive.getmember(member_name)
    except KeyError:
        return None
    if not member.isfile():
        return None
    extracted = archive.extractfile(member)
    if extracted is None:
        return None
    content = extracted.read()
    return content if sha256_bytes(content) == digest else None


def parse_json_bytes(content):
    try:
        parsed = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def descriptor_digest(descriptor):
    if not isinstance(descriptor, dict):
        return None
    value = descriptor.get("digest")
    return value if isinstance(value, str) and digest_pattern.match(value) else None


def descriptor_size_matches(descriptor, content):
    if not isinstance(descriptor, dict):
        return False
    size = descriptor.get("size")
    return not isinstance(size, int) or size == len(content)


def oci_image_manifest_matches_entry(archive, digest, archive_config_digest, layer_paths):
    content = read_verified_oci_blob(archive, digest)
    if content is None:
        return False
    manifest = parse_json_bytes(content)
    if manifest is None or manifest.get("schemaVersion") != 2:
        return False
    config_descriptor = manifest.get("config")
    if descriptor_digest(config_descriptor) != archive_config_digest:
        return False
    config_blob = read_verified_oci_blob(archive, archive_config_digest)
    if config_blob is None or not descriptor_size_matches(config_descriptor, config_blob):
        return False
    layer_descriptors = manifest.get("layers")
    if not isinstance(layer_descriptors, list) or len(layer_descriptors) != len(layer_paths):
        return False
    for descriptor, layer_path in zip(layer_descriptors, layer_paths):
        layer_digest = oci_blob_digest_from_path(layer_path)
        if layer_digest is None or descriptor_digest(descriptor) != layer_digest:
            return False
        layer_blob = read_verified_oci_blob(archive, layer_digest)
        if layer_blob is None or not descriptor_size_matches(descriptor, layer_blob):
            return False
    return True


def oci_descriptor_reaches_entry(archive, digest, archive_config_digest, layer_paths, seen=None):
    if seen is None:
        seen = set()
    if digest in seen:
        return False
    seen.add(digest)
    content = read_verified_oci_blob(archive, digest)
    if content is None:
        return False
    payload = parse_json_bytes(content)
    if payload is None or payload.get("schemaVersion") != 2:
        return False
    if isinstance(payload.get("config"), dict):
        return oci_image_manifest_matches_entry(archive, digest, archive_config_digest, layer_paths)
    manifests = payload.get("manifests")
    if not isinstance(manifests, list):
        return False
    for descriptor in manifests:
        child_digest = descriptor_digest(descriptor)
        if child_digest is None:
            continue
        child_content = read_verified_oci_blob(archive, child_digest)
        if child_content is None or not descriptor_size_matches(descriptor, child_content):
            continue
        if oci_descriptor_reaches_entry(archive, child_digest, archive_config_digest, layer_paths, seen):
            return True
    return False


def local_image_inspect(image_ref):
    try:
        result = subprocess.run(
            ["docker", "image", "inspect", "--format", "{{json .}}", image_ref],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    value = result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def meaningful_config_value(value):
    return value not in (None, "", [], {})


def archive_config_matches_local_image(config, diff_ids, expected_digest):
    local = local_image_inspect(expected_image_ref)
    if local is None or local.get("Id") != expected_digest:
        return False
    rootfs = local.get("RootFS")
    if not isinstance(rootfs, dict) or rootfs.get("Layers") != diff_ids:
        return False
    if config.get("architecture") != local.get("Architecture"):
        return False
    if config.get("os") != local.get("Os"):
        return False

    archive_created = config.get("created")
    local_created = local.get("Created")
    if isinstance(archive_created, str) and isinstance(local_created, str) and archive_created != local_created:
        return False

    archive_config = config.get("config")
    local_config = local.get("Config")
    if not isinstance(archive_config, dict) or not isinstance(local_config, dict):
        return False

    config_keys = [
        "ArgsEscaped",
        "Cmd",
        "Entrypoint",
        "Env",
        "ExposedPorts",
        "Healthcheck",
        "Labels",
        "OnBuild",
        "Shell",
        "StopSignal",
        "User",
        "Volumes",
        "WorkingDir",
    ]
    for key in config_keys:
        archive_value = archive_config.get(key)
        local_value = local_config.get(key)
        if meaningful_config_value(archive_value) or meaningful_config_value(local_value):
            if archive_value != local_value:
                return False
    return True


if not digest_pattern.match(expected_config_digest):
    fail("invalid_expected_image_digest")
if not image_ref_pattern.match(expected_image_ref):
    fail("invalid_expected_image_ref")
if not archive_path.is_file():
    fail("missing_archive")

try:
    with tarfile.open(archive_path, "r:*") as archive:
        manifest_bytes = read_member_bytes(archive, "manifest.json")
        manifest = json.loads(manifest_bytes.decode("utf-8"))
        if not isinstance(manifest, list) or len(manifest) != 1:
            fail("invalid_manifest_shape")
        entry = manifest[0]
        if not isinstance(entry, dict):
            fail("invalid_manifest_entry")
        repo_tags = entry.get("RepoTags")
        if repo_tags != [expected_image_ref]:
            fail("repo_tag_mismatch")
        config_path = entry.get("Config")
        if not is_safe_archive_path(config_path):
            fail("invalid_config_path")
        layers = entry.get("Layers")
        if not isinstance(layers, list):
            fail("invalid_layers")
        config_bytes = read_member_bytes(archive, config_path)
        config = json.loads(config_bytes.decode("utf-8"))
        if not isinstance(config, dict):
            fail("invalid_config")
        archive_config_digest = sha256_bytes(config_bytes)
        expected_config_blob_digest = oci_blob_digest_from_path(config_path)
        if expected_config_blob_digest:
            if archive_config_digest != expected_config_blob_digest:
                fail("config_blob_digest_mismatch")
        elif archive_config_digest != expected_config_digest:
            fail("config_digest_mismatch")
        rootfs = config.get("rootfs")
        if not isinstance(rootfs, dict):
            fail("invalid_rootfs")
        diff_ids = rootfs.get("diff_ids")
        if not isinstance(diff_ids, list):
            fail("invalid_rootfs_diff_ids")
        if len(layers) != len(diff_ids):
            fail("layer_diff_id_count_mismatch")
        for index, layer_path in enumerate(layers):
            if not is_safe_archive_path(layer_path):
                fail(f"invalid_layer_path:{index}")
            expected_diff_id = diff_ids[index]
            if not isinstance(expected_diff_id, str) or not digest_pattern.match(expected_diff_id):
                fail(f"invalid_layer_diff_id:{index}")
            layer_digest = sha256_archive_member(archive, layer_path)
            expected_oci_blob_digest = oci_blob_digest_from_path(layer_path)
            if expected_oci_blob_digest:
                if layer_digest != expected_oci_blob_digest:
                    fail(f"layer_blob_digest_mismatch:{index}")
                uncompressed_digest = sha256_gzip_uncompressed_archive_member(archive, layer_path)
                if uncompressed_digest is not None:
                    if uncompressed_digest != expected_diff_id:
                        fail(f"layer_diff_id_mismatch:{index}")
                elif layer_digest != expected_diff_id:
                    fail(f"layer_diff_id_mismatch:{index}")
            elif layer_digest != expected_diff_id:
                fail(f"layer_diff_id_mismatch:{index}")
        if archive_config_digest != expected_config_digest and not oci_descriptor_reaches_entry(
            archive,
            expected_config_digest,
            archive_config_digest,
            layers,
        ):
            if not archive_config_matches_local_image(config, diff_ids, expected_config_digest):
                fail("image_identity_mismatch")
except tarfile.TarError as error:
    fail(f"invalid_tar:{error}")
except UnicodeDecodeError as error:
    fail(f"invalid_utf8:{error}")
except json.JSONDecodeError as error:
    fail(f"invalid_json:{error}")

print(sha256_file(archive_path))
PY
}

image_archive_append_docker_save_skip_decision() {
  local bundle_dir="$1"
  local image_ref="$2"
  local input_digest="$3"
  local existing_artifact_digest="$4"
  local generated_at

  generated_at="$(image_archive_generated_at)"
  python3 - \
    "${bundle_dir}/skip-decisions.ndjson" \
    "${image_ref}" \
    "${input_digest}" \
    "${existing_artifact_digest}" \
    "${IMAGE_ARCHIVE_CACHE_SKIP_VALIDATOR}" \
    "${generated_at}" <<'PY'
import json
import pathlib
import re
import sys

skip_decisions_path = pathlib.Path(sys.argv[1])
image_ref, input_digest, existing_artifact_digest, validator, generated_at = sys.argv[2:]
digest_pattern = re.compile(r"^sha256:[a-f0-9]{64}$")
image_ref_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]*$")

if not image_ref_pattern.match(image_ref):
    raise SystemExit("invalid_image_ref")
if not digest_pattern.match(input_digest) or not digest_pattern.match(existing_artifact_digest):
    raise SystemExit("invalid_digest")

decision = {
    "schema": "current-build-skip-decision.v1",
    "version": 1,
    "target": f"image:{image_ref}",
    "operation": "docker_save",
    "input_digest": input_digest,
    "existing_artifact_digest": existing_artifact_digest,
    "skip_reason": "image_archive_cache_verified",
    "validator": validator,
    "generated_at": generated_at,
}

skip_decisions_path.parent.mkdir(parents=True, exist_ok=True)
with skip_decisions_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(decision, sort_keys=True, separators=(",", ":")))
    handle.write("\n")
PY
}

image_archive_run_docker_save() {
  local image_ref="$1"
  local archive_path="$2"
  local save_mode="$3"
  local save_platform="$4"

  case "${save_mode}" in
    default)
      docker save "${image_ref}" -o "${archive_path}"
      ;;
    platform)
      docker save --platform "${save_platform}" "${image_ref}" -o "${archive_path}"
      ;;
    *)
      printf 'unsupported image archive save mode: %s\n' "${save_mode}" >&2
      return 2
      ;;
  esac
}

save_image_archive_with_cache() {
  local image_ref="$1"
  local archive_path="$2"
  local out_dir="$3"
  local bundle_dir="$4"
  local save_mode="$5"
  local save_platform="$6"
  local local_image_id=""
  local cache_root=""
  local cache_key=""
  local cache_dir=""
  local cache_archive_path=""
  local archive_sha256=""
  local temp_archive_path=""

  if local_image_id="$(image_archive_local_export_digest "${image_ref}" "${save_mode}" "${save_platform}")"; then
    cache_root="$(image_archive_cache_root "${out_dir}")"
    cache_key="$(image_archive_cache_key "${image_ref}" "${local_image_id}" "${save_mode}" "${save_platform}")"
    cache_dir="${cache_root}/${cache_key}"
    cache_archive_path="${cache_dir}/archive.tar"

    if [[ -f "${cache_archive_path}" ]] \
      && archive_sha256="$(image_archive_verify_archive "${cache_archive_path}" "${image_ref}" "${local_image_id}" 2>/dev/null)"; then
      mkdir -p "$(dirname "${archive_path}")"
      temp_archive_path="${archive_path}.tmp.$$"
      rm -f "${temp_archive_path}"
      cp "${cache_archive_path}" "${temp_archive_path}"
      if archive_sha256="$(image_archive_verify_archive "${temp_archive_path}" "${image_ref}" "${local_image_id}" 2>/dev/null)"; then
        mv "${temp_archive_path}" "${archive_path}"
        image_archive_append_docker_save_skip_decision "${bundle_dir}" "${image_ref}" "${local_image_id}" "${archive_sha256}"
        return 0
      fi
      rm -f "${temp_archive_path}" "${archive_path}"
    fi
  fi

  image_archive_run_docker_save "${image_ref}" "${archive_path}" "${save_mode}" "${save_platform}"

  if [[ -z "${local_image_id}" ]]; then
    local_image_id="$(image_archive_local_export_digest "${image_ref}" "${save_mode}" "${save_platform}")" || return 0
    cache_root="$(image_archive_cache_root "${out_dir}")"
    cache_key="$(image_archive_cache_key "${image_ref}" "${local_image_id}" "${save_mode}" "${save_platform}")"
    cache_dir="${cache_root}/${cache_key}"
    cache_archive_path="${cache_dir}/archive.tar"
  fi

  archive_sha256="$(image_archive_verify_archive "${archive_path}" "${image_ref}" "${local_image_id}")"
  mkdir -p "${cache_dir}"
  temp_archive_path="${cache_archive_path}.tmp.$$"
  rm -f "${temp_archive_path}"
  cp "${archive_path}" "${temp_archive_path}"
  mv "${temp_archive_path}" "${cache_archive_path}"
}

write_image_archive_manifest() {
  local bundle_dir="$1"
  local release_id="$2"
  local producer_script="$3"
  local platform="${4:-unknown}"

  [[ -d "${bundle_dir}/images" ]] || return 0

  python3 - "${bundle_dir}" "${release_id}" "${producer_script}" "${platform}" <<'PY'
from datetime import datetime, timezone
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tarfile
import tempfile

bundle_dir = pathlib.Path(sys.argv[1]).resolve()
release_id = sys.argv[2]
producer_script = sys.argv[3]
platform = sys.argv[4] or "unknown"
images_dir = bundle_dir / "images"
manifest_path = images_dir / "image-archives.manifest.json"
archive_paths = sorted(path for path in images_dir.glob("*.tar") if path.is_file())
digest_pattern = re.compile(r"^sha256:[a-f0-9]{64}$")
image_ref_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]*$")


def fail(message):
    raise SystemExit(f"image_archive_manifest:{message}")


def sha256_bytes(content):
    return "sha256:" + hashlib.sha256(content).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def is_safe_archive_path(value):
    if not isinstance(value, str) or not value or value.startswith("/") or value.startswith("-"):
        return False
    return all(part not in {"", ".", ".."} for part in value.split("/"))


def read_member_bytes(archive, member_name, archive_path):
    try:
        member = archive.getmember(member_name)
    except KeyError:
        fail(f"missing_archive_member:{archive_path.name}:{member_name}")
    if not member.isfile():
        fail(f"archive_member_not_file:{archive_path.name}:{member_name}")
    extracted = archive.extractfile(member)
    if extracted is None:
        fail(f"archive_member_unreadable:{archive_path.name}:{member_name}")
    return extracted.read()


def parse_archive(archive_path):
    try:
        with tarfile.open(archive_path, "r:*") as archive:
            manifest_bytes = read_member_bytes(archive, "manifest.json", archive_path)
            manifest = json.loads(manifest_bytes.decode("utf-8"))
            if not isinstance(manifest, list) or len(manifest) != 1:
                fail(f"invalid_manifest_shape:{archive_path.name}")
            entry = manifest[0]
            if not isinstance(entry, dict):
                fail(f"invalid_manifest_entry:{archive_path.name}")
            repo_tags = entry.get("RepoTags")
            if not isinstance(repo_tags, list) or len(repo_tags) != 1 or not isinstance(repo_tags[0], str):
                fail(f"invalid_repo_tags:{archive_path.name}")
            image_ref = repo_tags[0]
            if not image_ref_pattern.match(image_ref):
                fail(f"invalid_image_ref:{archive_path.name}")
            config_path = entry.get("Config")
            if not is_safe_archive_path(config_path):
                fail(f"invalid_config_path:{archive_path.name}")
            config_bytes = read_member_bytes(archive, config_path, archive_path)
            json.loads(config_bytes.decode("utf-8"))
            return image_ref, sha256_bytes(config_bytes)
    except tarfile.TarError as error:
        fail(f"invalid_tar:{archive_path.name}:{error}")
    except UnicodeDecodeError as error:
        fail(f"invalid_utf8:{archive_path.name}:{error}")
    except json.JSONDecodeError as error:
        fail(f"invalid_json:{archive_path.name}:{error}")


def local_image_id(image_ref):
    try:
        result = subprocess.run(
            ["docker", "image", "inspect", "--format", "{{.Id}}", image_ref],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    value = result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""
    return value if digest_pattern.match(value) else None


source_build_manifest_path = bundle_dir / "build-manifest.json"
source_build_manifest_digest = (
    sha256_file(source_build_manifest_path) if source_build_manifest_path.exists() else None
)
generated_at = (
    os.environ.get("IMAGE_ARCHIVE_MANIFEST_GENERATED_AT")
    or os.environ.get("BUILD_ARTIFACT_BROKER_GENERATED_AT")
    or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
)

archives = []
for archive_path in archive_paths:
    image_ref, archive_config_digest = parse_archive(archive_path)
    inspected_image_id = local_image_id(image_ref)
    local_config_digest = archive_config_digest if inspected_image_id == archive_config_digest else None
    archives.append(
        {
            "archive_relpath": archive_path.relative_to(bundle_dir).as_posix(),
            "image_ref": image_ref,
            "archive_sha256": sha256_file(archive_path),
            "archive_config_digest": archive_config_digest,
            "local_image_id": inspected_image_id,
            "local_config_digest": local_config_digest,
            "platform": platform,
            "source_manifest_digest": source_build_manifest_digest,
            "source_build_manifest_digest": source_build_manifest_digest,
            "validator": "docker save archive manifest.json RepoTags, Config bytes sha256, and optional local docker image inspect identity",
        }
    )

payload = {
    "schema": "image-archive-manifest.v1",
    "version": 1,
    "release_id": release_id,
    "generated_at": generated_at,
    "producer": {
        "name": "agentsmith-image-archive-manifest",
        "script": producer_script,
        "helper": "scripts/lib/image-archive-manifest.sh",
    },
    "archives": archives,
}

images_dir.mkdir(parents=True, exist_ok=True)
with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=images_dir, delete=False) as handle:
    temp_path = pathlib.Path(handle.name)
    handle.write(json.dumps(payload, indent=2, sort_keys=True))
    handle.write("\n")
temp_path.replace(manifest_path)
PY
}
