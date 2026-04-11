#!/usr/bin/env bash
set -euo pipefail

kind_write_docker_config_without_proxies() {
  local source_config_path="$1"
  local destination_config_path="$2"
  python3 - "${source_config_path}" "${destination_config_path}" <<'PY'
from pathlib import Path
import json
import sys

source_path = Path(sys.argv[1])
destination_path = Path(sys.argv[2])

payload = {}
if source_path.exists():
    payload = json.loads(source_path.read_text())

payload.pop("proxies", None)
destination_path.parent.mkdir(parents=True, exist_ok=True)
destination_path.write_text(json.dumps(payload, indent=2) + "\n")
PY
}

kind_control_plane_manifest_paths() {
  cat <<'EOF_PATHS'
/etc/kubernetes/manifests/kube-apiserver.yaml
/etc/kubernetes/manifests/kube-controller-manager.yaml
/etc/kubernetes/manifests/kube-scheduler.yaml
EOF_PATHS
}

kind_manifest_strip_proxy_env_file() {
  local manifest_path="$1"
  python3 - "${manifest_path}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
lines = path.read_text().splitlines(keepends=True)
out = []
i = 0

while i < len(lines):
    line = lines[i]
    if line.startswith("    env:"):
        j = i + 1
        while j < len(lines):
            nxt = lines[j]
            if nxt.startswith("    ") and not nxt.startswith("    -") and not nxt.startswith("      "):
                break
            j += 1
        block = "".join(lines[i:j])
        if any(token in block for token in ("HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy")):
            i = j
            continue
    out.append(line)
    i += 1

path.write_text("".join(out))
PY
}

kind_sanitize_control_plane_proxy_env() {
  local control_plane_node="$1"
  local changed=0
  local manifest_path
  while IFS= read -r manifest_path; do
    [[ -n "${manifest_path}" ]] || continue
    local temp_file before_hash after_hash
    temp_file="$(mktemp)"
    docker cp "${control_plane_node}:${manifest_path}" "${temp_file}" >/dev/null
    before_hash="$(sha256sum "${temp_file}" | awk '{print $1}')"
    kind_manifest_strip_proxy_env_file "${temp_file}"
    after_hash="$(sha256sum "${temp_file}" | awk '{print $1}')"
    if [[ "${before_hash}" != "${after_hash}" ]]; then
      docker cp "${temp_file}" "${control_plane_node}:${manifest_path}" >/dev/null
      changed=1
    fi
    rm -f "${temp_file}"
  done < <(kind_control_plane_manifest_paths)

  if [[ "${changed}" == "1" ]]; then
    echo "[kind-bootstrap] removed proxy env from control-plane manifests on ${control_plane_node}" >&2
  fi

  return 0
}
