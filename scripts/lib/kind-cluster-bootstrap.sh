#!/usr/bin/env bash
set -euo pipefail

kind_cluster_name_from_context_or_override() {
  local cluster_name_override="${1:-}"
  local context_name="${2:-}"

  if [[ -n "${cluster_name_override}" ]]; then
    printf '%s\n' "${cluster_name_override}"
    return 0
  fi

  if [[ "${context_name}" == kind-* ]]; then
    printf '%s\n' "${context_name#kind-}"
  fi
}

kind_control_plane_node_name_from_context_or_override() {
  local context_name="${1:-}"
  local control_plane_node_override="${2:-}"
  local cluster_name_override="${3:-}"

  if [[ -n "${control_plane_node_override}" ]]; then
    printf '%s\n' "${control_plane_node_override}"
    return 0
  fi

  local cluster_name
  cluster_name="$(kind_cluster_name_from_context_or_override "${cluster_name_override}" "${context_name}")"
  if [[ -n "${cluster_name}" ]]; then
    printf '%s-control-plane\n' "${cluster_name}"
  fi
}

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

kind_merge_no_proxy_values_text() {
  python3 - "$@" <<'PY'
import re
import sys

seen = set()
values = []

for raw in sys.argv[1:]:
    for token in re.split(r"[\s,]+", raw):
        value = token.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        values.append(value)

print(",".join(values))
PY
}

kind_systemd_env_value_from_text() {
  local env_text="${1:-}"
  local key="$2"
  python3 - "${env_text}" "${key}" <<'PY'
import sys

env_text = sys.argv[1]
key = sys.argv[2]

for line in env_text.splitlines():
    if line.startswith(f"{key}="):
        print(line.split("=", 1)[1])
        break
PY
}

kind_registry_no_proxy_target_text() {
  local registry_host_arg="${1:-}"
  local registry_port_arg="${2:-}"
  python3 - \
    "${registry_host_arg}" \
    "${registry_port_arg}" \
    "${KIND_REGISTRY_HOST:-}" \
    "${KIND_REGISTRY_PORT:-}" \
    "${K8S_REGISTRY_HOST:-}" \
    "${LOCAL_KIND_REGISTRY_NAME:-}" \
    "${LOCAL_KIND_REGISTRY_CONTAINER_PORT:-}" <<'PY'
import re
import sys


def parse_registry_ref(raw: str):
    value = raw.strip()
    if not value:
        return None, None
    value = re.sub(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", "", value)
    value = value.split("/", 1)[0]
    if value.startswith("["):
        match = re.fullmatch(r"\[([^\]]+)\](?::([0-9]+))?", value)
        return (match.group(1), match.group(2)) if match else (value, None)
    if value.count(":") == 1:
        host, port = value.rsplit(":", 1)
        if host and port.isdigit():
            return host, port
    return value, None


host = None
embedded_port = None
for candidate in [
    sys.argv[1],
    sys.argv[3],
    sys.argv[5],
    sys.argv[6],
]:
    candidate_host, candidate_port = parse_registry_ref(candidate)
    if host is None and candidate_host:
        host = candidate_host
    if embedded_port is None and candidate_port:
        embedded_port = candidate_port

port = (
    sys.argv[2].strip()
    or sys.argv[4].strip()
    or embedded_port
    or sys.argv[7].strip()
    or "5000"
)

print(host or "kind-registry")
print(port)
PY
}

kind_configure_registry_no_proxy_for_containerd() {
  local control_plane_node="${1:-}"
  local registry_target registry_host registry_port

  registry_target="$(kind_registry_no_proxy_target_text "${2:-}" "${3:-}")"
  registry_host="$(printf '%s\n' "${registry_target}" | sed -n '1p')"
  registry_port="$(printf '%s\n' "${registry_target}" | sed -n '2p')"

  [[ -n "${control_plane_node}" ]] || {
    echo "[kind-bootstrap] ERROR: missing kind control-plane node name" >&2
    return 1
  }
  [[ -n "${registry_host}" ]] || {
    echo "[kind-bootstrap] ERROR: missing kind registry host" >&2
    return 1
  }
  [[ -n "${registry_port}" ]] || {
    echo "[kind-bootstrap] ERROR: missing kind registry port" >&2
    return 1
  }

  local manager_env current_no_proxy current_no_proxy_lower merged_no_proxy
  manager_env="$(docker exec "${control_plane_node}" systemctl show-environment 2>/dev/null || true)"
  current_no_proxy="$(kind_systemd_env_value_from_text "${manager_env}" "NO_PROXY")"
  current_no_proxy_lower="$(kind_systemd_env_value_from_text "${manager_env}" "no_proxy")"
  merged_no_proxy="$(kind_merge_no_proxy_values_text "${current_no_proxy}" "${current_no_proxy_lower}" "${registry_host}" "${registry_host}:${registry_port}")"

  docker exec "${control_plane_node}" mkdir -p /etc/systemd/system/containerd.service.d >/dev/null
  docker exec "${control_plane_node}" systemctl set-environment "NO_PROXY=${merged_no_proxy}" "no_proxy=${merged_no_proxy}" >/dev/null

  local dropin encoded_dropin
  dropin="[Service]
Environment=\"NO_PROXY=${merged_no_proxy}\" \"no_proxy=${merged_no_proxy}\"
"
  encoded_dropin="$(printf '%s' "${dropin}" | base64 | tr -d '\n')"
  docker exec "${control_plane_node}" sh -c "printf '%s' '${encoded_dropin}' | base64 -d > /etc/systemd/system/containerd.service.d/20-kind-registry-no-proxy.conf" >/dev/null
  docker exec "${control_plane_node}" systemctl daemon-reload >/dev/null
  docker exec "${control_plane_node}" systemctl restart containerd >/dev/null
  echo "[kind-bootstrap] reconciled ${control_plane_node} containerd NO_PROXY for ${registry_host}:${registry_port}" >&2
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
proxy_names = {
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
}

while i < len(lines):
    line = lines[i]
    if line.startswith("    env:"):
        j = i + 1
        while j < len(lines):
            nxt = lines[j]
            if nxt.startswith("    ") and not nxt.startswith("    -") and not nxt.startswith("      "):
                break
            j += 1
        block_lines = lines[i + 1:j]
        kept_entries = []
        k = 0
        while k < len(block_lines):
            entry_start = block_lines[k]
            if entry_start.startswith("    -"):
                l = k + 1
                while l < len(block_lines) and block_lines[l].startswith("      "):
                    l += 1
                entry = block_lines[k:l]
                entry_text = "".join(entry)
                remove_entry = any(f"name: {token}" in entry_text for token in proxy_names)
                if not remove_entry:
                    kept_entries.extend(entry)
                k = l
                continue
            kept_entries.append(entry_start)
            k += 1
        if kept_entries:
            out.append(line)
            out.extend(kept_entries)
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

kind_normalize_coredns_upstream_resolvers_text() {
  local raw_text="${1:-}"
  python3 - "${raw_text}" <<'PY'
import ipaddress
import re
import sys

raw_text = sys.argv[1]
seen = set()
normalized = []


def split_host_and_port(token: str):
    if token.startswith('['):
        match = re.fullmatch(r'\[(.+)\](?::(\d+))?', token)
        if not match:
            return None, None
        return match.group(1), match.group(2)
    if token.count(':') == 1 and '.' in token.split(':', 1)[0]:
        host, port = token.split(':', 1)
        return host, port
    return token, None


def is_valid_port(port: str | None):
    if port is None:
        return True
    if not port.isdigit():
        return False
    value = int(port)
    return 1 <= value <= 65535


for raw_line in raw_text.splitlines():
    line = raw_line.split('#', 1)[0].replace(',', ' ').strip()
    if not line:
        continue
    for token in line.split():
        candidate = token.strip()
        if not candidate or candidate in {'/etc/resolv.conf', 'localhost'}:
            continue
        host, port = split_host_and_port(candidate)
        if host is None or not is_valid_port(port):
            continue
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            continue
        if address.is_loopback or address.is_unspecified or address.is_link_local:
            continue
        if candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)

for value in normalized:
    print(value)
PY
}

kind_filter_coredns_upstream_resolvers_against_blocklist() {
  local upstream_text="${1:-}"
  local blocklist_text="${2:-}"
  python3 - "${upstream_text}" "${blocklist_text}" <<'PY'
import sys

upstreams = [line.strip() for line in sys.argv[1].splitlines() if line.strip()]
blocked = {line.strip() for line in sys.argv[2].splitlines() if line.strip()}

for upstream in upstreams:
    if upstream not in blocked:
        print(upstream)
PY
}

kind_docker_gateway_resolver_blocklist() {
  if [[ -n "${LOCAL_KIND_COREDNS_BLOCKLIST:-}" ]]; then
    kind_normalize_coredns_upstream_resolvers_text "${LOCAL_KIND_COREDNS_BLOCKLIST}"
    return 0
  fi

  command -v docker >/dev/null 2>&1 || return 0

  local gateway_lines=""
  local network_name
  while IFS= read -r network_name; do
    [[ -n "${network_name}" ]] || continue
    gateway_lines+="$(docker network inspect "${network_name}" --format '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' 2>/dev/null || true)"$'\n'
  done < <(docker network ls --format '{{.Name}}' 2>/dev/null || true)

  kind_normalize_coredns_upstream_resolvers_text "${gateway_lines}"
}

kind_usable_coredns_upstream_resolvers_text() {
  local raw_text="${1:-}"
  local normalized blocked
  normalized="$(kind_normalize_coredns_upstream_resolvers_text "${raw_text}")"
  blocked="$(kind_docker_gateway_resolver_blocklist)"

  if [[ -n "${blocked}" ]]; then
    normalized="$(kind_filter_coredns_upstream_resolvers_against_blocklist "${normalized}" "${blocked}")"
  fi

  printf '%s\n' "${normalized}"
}

kind_repo_owned_coredns_fallback_resolvers_text() {
  printf '%s\n' \
    "1.1.1.1" \
    "8.8.8.8"
}

kind_repo_owned_coredns_fallback_resolvers_source_text() {
  if [[ "${LOCAL_KIND_COREDNS_REPO_FALLBACK_UPSTREAMS+set}" == "set" ]]; then
    printf '%s\n' "${LOCAL_KIND_COREDNS_REPO_FALLBACK_UPSTREAMS}"
  else
    kind_repo_owned_coredns_fallback_resolvers_text
  fi
}

kind_repo_owned_coredns_fallback_resolvers() {
  kind_usable_coredns_upstream_resolvers_text "$(kind_repo_owned_coredns_fallback_resolvers_source_text)"
}

kind_coredns_host_resolver_candidate_paths() {
  local configured_resolv_conf_path="${LOCAL_KIND_COREDNS_HOST_RESOLV_CONF:-}"
  local alternate_resolv_conf_path="${LOCAL_KIND_COREDNS_HOST_RESOLV_CONF_ALT:-}"
  local candidate
  local -a candidates=()
  local -A seen=()

  if [[ -n "${configured_resolv_conf_path}" ]]; then
    candidates+=("${configured_resolv_conf_path}")
    if [[ -n "${alternate_resolv_conf_path}" ]]; then
      candidates+=("${alternate_resolv_conf_path}")
    fi
  else
    candidates+=("/etc/resolv.conf")
    if [[ -n "${alternate_resolv_conf_path}" ]]; then
      candidates+=("${alternate_resolv_conf_path}")
    fi
    candidates+=(
      "/run/systemd/resolve/resolv.conf"
      "/run/NetworkManager/no-stub-resolv.conf"
    )
  fi

  for candidate in "${candidates[@]}"; do
    [[ -n "${candidate}" ]] || continue
    if [[ -n "${seen["${candidate}"]+x}" ]]; then
      continue
    fi
    seen["${candidate}"]=1
    printf '%s\n' "${candidate}"
  done
}

kind_host_coredns_upstream_resolvers() {
  local candidate_path normalized

  while IFS= read -r candidate_path; do
    [[ -n "${candidate_path}" ]] || continue
    [[ -f "${candidate_path}" ]] || continue

    normalized="$(kind_usable_coredns_upstream_resolvers_text "$(cat "${candidate_path}")")"
    if [[ -n "${normalized}" ]]; then
      printf '%s\n' "${normalized}"
      return 0
    fi
  done < <(kind_coredns_host_resolver_candidate_paths)

  return 0
}

kind_resolve_coredns_upstream_resolvers() {
  local normalized=""
  local configured_upstreams="${LOCAL_KIND_COREDNS_UPSTREAMS:-}"
  local configured_upstreams_file="${LOCAL_KIND_COREDNS_UPSTREAMS_FILE:-}"
  local host_resolver_sources=""
  local repo_fallback_sources=""

  if [[ -n "${configured_upstreams}" ]]; then
    normalized="$(kind_usable_coredns_upstream_resolvers_text "${configured_upstreams}")"
    if [[ -z "${normalized}" ]]; then
      echo "[kind-bootstrap] ignoring invalid LOCAL_KIND_COREDNS_UPSTREAMS override; falling back to next resolver source" >&2
    fi
  fi

  if [[ -z "${normalized}" && -n "${configured_upstreams_file}" ]]; then
    if [[ -f "${configured_upstreams_file}" ]]; then
      normalized="$(kind_usable_coredns_upstream_resolvers_text "$(cat "${configured_upstreams_file}")")"
      if [[ -z "${normalized}" ]]; then
        echo "[kind-bootstrap] ignoring invalid LOCAL_KIND_COREDNS_UPSTREAMS_FILE=${configured_upstreams_file}; falling back to host resolver discovery" >&2
      fi
    else
      echo "[kind-bootstrap] LOCAL_KIND_COREDNS_UPSTREAMS_FILE not found: ${configured_upstreams_file}; falling back to host resolver discovery" >&2
    fi
  fi

  if [[ -z "${normalized}" ]]; then
    normalized="$(kind_host_coredns_upstream_resolvers)"
  fi

  if [[ -z "${normalized}" ]]; then
    normalized="$(kind_repo_owned_coredns_fallback_resolvers)"
  fi

  if [[ -z "${normalized}" ]]; then
    host_resolver_sources="$(kind_coredns_host_resolver_candidate_paths | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
    repo_fallback_sources="$(kind_repo_owned_coredns_fallback_resolvers_source_text | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
    echo "[kind-bootstrap] ERROR: no usable CoreDNS upstream resolvers found from LOCAL_KIND_COREDNS_UPSTREAMS, LOCAL_KIND_COREDNS_UPSTREAMS_FILE, host resolver sources (${host_resolver_sources}), or repo-owned fallback resolvers (${repo_fallback_sources})" >&2
    return 1
  fi

  printf '%s\n' "${normalized}" | paste -sd ' ' -
}

kind_rewrite_coredns_corefile_forward_targets() {
  local corefile_path="$1"
  shift
  [[ -n "${corefile_path}" ]] || {
    echo "[kind-bootstrap] ERROR: missing CoreDNS Corefile path" >&2
    return 1
  }
  [[ "$#" -gt 0 ]] || {
    echo "[kind-bootstrap] ERROR: missing CoreDNS upstream resolvers" >&2
    return 1
  }

  python3 - "${corefile_path}" "$@" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
targets = " ".join(sys.argv[2:])
content = path.read_text()
pattern = re.compile(r'(^[ \t]*forward[ \t]+\.[ \t]+)([^\n{]+?)([ \t]*(?:\{)?[ \t]*$)', re.MULTILINE)


def rewrite(match):
    suffix = match.group(3)
    return f"{match.group(1)}{targets}{suffix}"


updated, replaced = pattern.subn(rewrite, content, count=1)
if replaced == 0:
    raise SystemExit("missing_coredns_forward_stanza")
path.write_text(updated)
PY
}

kind_write_coredns_configmap_patch_file() {
  local corefile_path="$1"
  local patch_path="$2"
  python3 - "${corefile_path}" "${patch_path}" <<'PY'
from pathlib import Path
import json
import sys

corefile_path = Path(sys.argv[1])
patch_path = Path(sys.argv[2])
patch_path.write_text(
    json.dumps(
        {
            "data": {
                "Corefile": corefile_path.read_text(),
            },
        }
    )
)
PY
}

kind_wait_for_coredns_resources() {
  local kubeconfig_path="$1"
  local timeout_seconds="${2:-180}"
  local deadline="$((SECONDS + timeout_seconds))"

  while (( SECONDS < deadline )); do
    if KUBECONFIG="${kubeconfig_path}" kind_kubectl -n kube-system get configmap coredns >/dev/null 2>&1 \
      && KUBECONFIG="${kubeconfig_path}" kind_kubectl -n kube-system get deployment coredns >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "[kind-bootstrap] ERROR: CoreDNS resources did not appear in kube-system within ${timeout_seconds}s" >&2
  return 1
}

kind_reconcile_coredns_upstreams() {
  (
    set -euo pipefail

    local kubeconfig_path="$1"
    local upstreams
    upstreams="$(kind_resolve_coredns_upstream_resolvers)"
    [[ -n "${upstreams}" ]] || {
      echo "[kind-bootstrap] ERROR: failed to resolve CoreDNS upstream resolvers" >&2
      exit 1
    }

    kind_wait_for_coredns_resources "${kubeconfig_path}"

    local corefile_path patch_path before_hash after_hash
    local -a upstream_array=()
    read -r -a upstream_array <<< "${upstreams}"
    corefile_path="$(mktemp)"
    patch_path="$(mktemp)"
    trap 'rm -f "${corefile_path}" "${patch_path}"' EXIT

    KUBECONFIG="${kubeconfig_path}" \
      kind_kubectl -n kube-system get configmap coredns -o go-template='{{index .data "Corefile"}}' \
      > "${corefile_path}"

    before_hash="$(sha256sum "${corefile_path}" | awk '{print $1}')"
    # Force CoreDNS to use repo-controlled upstream resolvers instead of the node container resolv.conf.
    kind_rewrite_coredns_corefile_forward_targets "${corefile_path}" "${upstream_array[@]}"
    after_hash="$(sha256sum "${corefile_path}" | awk '{print $1}')"

    if [[ "${before_hash}" != "${after_hash}" ]]; then
      kind_write_coredns_configmap_patch_file "${corefile_path}" "${patch_path}"
      KUBECONFIG="${kubeconfig_path}" \
        kind_kubectl -n kube-system patch configmap coredns --type merge --patch-file "${patch_path}" >/dev/null
      KUBECONFIG="${kubeconfig_path}" \
        kind_kubectl -n kube-system rollout restart deployment/coredns >/dev/null
      echo "[kind-bootstrap] reconciled CoreDNS upstream resolvers: ${upstreams}" >&2
    fi

    KUBECONFIG="${kubeconfig_path}" \
      kind_kubectl -n kube-system rollout status deployment/coredns --timeout=180s >/dev/null
  )
}
