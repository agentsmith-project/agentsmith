#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

forbidden_loopback_matches="$(
  rg -n \
    "http://localhost:[0-9]+|https://localhost:[0-9]+|ws://localhost:[0-9]+|wss://localhost:[0-9]+|127\\.0\\.0\\.1:[0-9]+|host\\.docker\\.internal|172\\.18\\." \
    src \
    --glob '!**/__tests__/**' \
    --glob '!**/*.test.*' \
    --glob '!src/mocks/**' \
    --glob '!src/messages/**' \
    --glob '!src/lib/public-runtime-config.ts' \
    --glob '!src/lib/system-admin/**' \
    --glob '!src/app/api/**' \
    || true
)"

if [[ -n "${forbidden_loopback_matches}" ]]; then
  echo "[client-public-runtime] forbidden runtime loopback/public host literal found:" >&2
  printf '%s\n' "${forbidden_loopback_matches}" >&2
  exit 1
fi

forbidden_public_env_matches="$(
  rg -n \
    "process\\.env\\.NEXT_PUBLIC_" \
    src \
    --glob '!**/__tests__/**' \
    --glob '!**/*.test.*' \
    --glob '!src/mocks/**' \
    --glob '!src/messages/**' \
    --glob '!src/lib/public-runtime-config.ts' \
    --glob '!src/lib/system-admin/**' \
    --glob '!src/app/api/**' \
    || true
)"

if [[ -n "${forbidden_public_env_matches}" ]]; then
  echo "[client-public-runtime] forbidden direct NEXT_PUBLIC env read found outside runtime-config layer:" >&2
  printf '%s\n' "${forbidden_public_env_matches}" >&2
  exit 1
fi

forbidden_system_admin_config_imports="$(
  rg -n \
    "import(?!\\s+type\\b).+(@/lib/system-admin/config|\\./\\.?/.*system-admin/config)" \
    src/components src/app \
    --glob '**/*.tsx' \
    --glob '**/*.ts' \
    -P \
    || true
)"

if [[ -n "${forbidden_system_admin_config_imports}" ]]; then
  echo "[client-public-runtime] forbidden system-admin/config import found in app or component code:" >&2
  printf '%s\n' "${forbidden_system_admin_config_imports}" >&2
  exit 1
fi

echo "[client-public-runtime] ok"
