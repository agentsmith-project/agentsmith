#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/universal-proxy-runtime.sh"

info() { echo "[api-key-endpoint-access-gate] $*"; }
die() { echo "[api-key-endpoint-access-gate] $*" >&2; exit 1; }

if [[ -z "${MBOS_UNIVERSAL_PROXY_BASE_URL:-}" ]]; then
  if universal_proxy_runtime_probe_url "http://127.0.0.1:39080"; then
    export MBOS_UNIVERSAL_PROXY_BASE_URL="http://127.0.0.1:39080"
  fi
fi

[[ -n "${MBOS_UNIVERSAL_PROXY_BASE_URL:-}" ]] || die "missing MBOS_UNIVERSAL_PROXY_BASE_URL; start substrate or export the universal proxy base url first"
universal_proxy_runtime_probe_url "${MBOS_UNIVERSAL_PROXY_BASE_URL}" \
  || die "universal proxy is not reachable at ${MBOS_UNIVERSAL_PROXY_BASE_URL}"

info "running backend-real API key + endpoint access spec"
(cd "${ROOT_DIR}" && bash scripts/run-integration-e2e-full.sh e2e/integration-api-key-gateway.spec.ts)

info "api key endpoint access gate passed"
