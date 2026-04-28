#!/usr/bin/env bash
set -euo pipefail

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
    archives.append(
        {
            "archive_relpath": archive_path.relative_to(bundle_dir).as_posix(),
            "image_ref": image_ref,
            "archive_sha256": sha256_file(archive_path),
            "archive_config_digest": archive_config_digest,
            "local_image_id": inspected_image_id,
            "local_config_digest": inspected_image_id,
            "platform": platform,
            "source_manifest_digest": source_build_manifest_digest,
            "source_build_manifest_digest": source_build_manifest_digest,
            "validator": "docker save archive manifest.json RepoTags and Config bytes sha256; local docker image inspect optional",
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
