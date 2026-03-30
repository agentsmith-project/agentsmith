#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
source "${ROOT_DIR}/scripts/scenarios/common.sh"

DEMO_REHEARSAL_NAME="demo-rehearsal"
DEMO_REHEARSAL_ROOT_DEFAULT="${ROOT_DIR}/artifacts/runtime/scenario/${DEMO_REHEARSAL_NAME}"
DEMO_REHEARSAL_ROOT="${DEMO_REHEARSAL_ROOT:-${DEMO_REHEARSAL_ROOT_DEFAULT}}"

init_demo_rehearsal_env() {
  mkdir -p "${DEMO_REHEARSAL_ROOT}"
  export ROOT_DIR
  export DEMO_DEPLOY_ROOT="${DEMO_REHEARSAL_ROOT}"
  export RELEASE_ROOT="${ROOT_DIR}"
}

demo_state_file() {
  printf '%s/state/deploy-state.json\n' "${DEMO_REHEARSAL_ROOT}"
}

demo_state_value() {
  local key="$1"
  local file
  file="$(demo_state_file)"
  [[ -f "${file}" ]] || return 0
  python3 - <<'PY' "${file}" "${key}"
import json
import pathlib
import sys

file_path = pathlib.Path(sys.argv[1])
path = [part for part in sys.argv[2].split('.') if part]
data = json.loads(file_path.read_text(encoding='utf-8'))
value = data
for part in path:
    if not isinstance(value, dict) or part not in value:
        raise SystemExit(0)
    value = value[part]
if isinstance(value, (dict, list)):
    print(json.dumps(value))
elif value is not None:
    print(value)
PY
}

demo_site_env_path() {
  if [[ -f "${DEMO_REHEARSAL_ROOT}/config/site.env" ]]; then
    printf '%s\n' "${DEMO_REHEARSAL_ROOT}/config/site.env"
  else
    printf '%s\n' "${ROOT_DIR}/env/site.env.example"
  fi
}

demo_env_value() {
  local key="$1"
  local path
  path="$(demo_site_env_path)"
  python3 - <<'PY' "${path}" "${key}"
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
if not path.exists():
    raise SystemExit(0)
for raw_line in path.read_text(encoding='utf-8').splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    name, value = line.split('=', 1)
    if name.strip() == key:
        print(value.strip().strip('"').strip("'"))
        break
PY
}

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' "${url}" 2>/dev/null || true
}
