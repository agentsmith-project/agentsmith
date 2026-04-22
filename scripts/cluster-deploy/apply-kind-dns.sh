#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/lib/kind-cluster-bootstrap.sh"

LOCAL_KIND_KUBECTL_BIN="${LOCAL_KIND_KUBECTL_BIN:-$(command -v kubectl)}"

if ! declare -F kind_kubectl >/dev/null 2>&1; then
  kind_kubectl() {
    "${LOCAL_KIND_KUBECTL_BIN}" "$@"
  }
fi

log() {
  printf '[kind-dns] %s\n' "$*"
}

die() {
  printf '[kind-dns] ERROR: %s\n' "$*" >&2
  exit 1
}

current_kube_context() {
  "${LOCAL_KIND_KUBECTL_BIN}" config current-context 2>/dev/null || true
}

current_kubeconfig_path() {
  if [[ -n "${KUBECONFIG:-}" ]]; then
    printf '%s\n' "${KUBECONFIG}"
    return 0
  fi
  printf '%s\n' "${HOME}/.kube/config"
}

main() {
  local current_context
  current_context="$(current_kube_context)"
  if [[ "${FORCE_KIND_CLUSTER_DNS_APPLY:-0}" != "1" && "${current_context}" != kind-* ]]; then
    log "skipping kind cluster DNS apply because current context is ${current_context:-<none>}"
    return 0
  fi

  if [[ -n "${KIND_CLUSTER_DNS_UPSTREAMS:-}" ]]; then
    export LOCAL_KIND_COREDNS_UPSTREAMS="${KIND_CLUSTER_DNS_UPSTREAMS}"
  fi
  if [[ -n "${KIND_CLUSTER_DNS_UPSTREAMS_FILE:-}" ]]; then
    export LOCAL_KIND_COREDNS_UPSTREAMS_FILE="${KIND_CLUSTER_DNS_UPSTREAMS_FILE}"
  fi
  if [[ -n "${KIND_CLUSTER_DNS_HOST_RESOLV_CONF:-}" ]]; then
    export LOCAL_KIND_COREDNS_HOST_RESOLV_CONF="${KIND_CLUSTER_DNS_HOST_RESOLV_CONF}"
  fi

  local kubeconfig_path upstreams
  kubeconfig_path="$(current_kubeconfig_path)"
  upstreams="$(kind_resolve_coredns_upstream_resolvers)"
  [[ -n "${upstreams}" ]] || die "kind cluster DNS upstreams resolved empty"

  kind_reconcile_coredns_upstreams "${kubeconfig_path}"
  log "applied kind cluster DNS config for context ${current_context}: ${upstreams}"
}

main "$@"
