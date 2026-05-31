#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${SSH_HOST:-mbos@mbos.imotion.ai}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/mbos/agentsmith_deploy_20260306}"
APP_DIR="${APP_DIR:-${DEPLOY_DIR}/agentsmith}"
OUT_BASENAME="${OUT_BASENAME:-BASELINE_$(date +%Y%m%d)}"

API_CONTAINER="${API_CONTAINER:-agentsmith-preprod-api}"
WEB_CONTAINER="${WEB_CONTAINER:-agentsmith-preprod-web}"
RUNNER_CONTAINER="${RUNNER_CONTAINER:-agentsmith-preprod-agent-task-runner}"

info() { echo "[preprod-baseline] $*"; }
err() { echo "[preprod-baseline] ERROR: $*" >&2; }

info "host=${SSH_HOST}"
info "deploy_dir=${DEPLOY_DIR}"

ssh "${SSH_HOST}" "bash -s" <<EOF
set -euo pipefail

DEPLOY_DIR='${DEPLOY_DIR}'
APP_DIR='${APP_DIR}'
API_CONTAINER='${API_CONTAINER}'
WEB_CONTAINER='${WEB_CONTAINER}'
RUNNER_CONTAINER='${RUNNER_CONTAINER}'
OUT_BASENAME='${OUT_BASENAME}'

for c in "\$API_CONTAINER" "\$WEB_CONTAINER" "\$RUNNER_CONTAINER"; do
  if ! docker ps --format '{{.Names}}' | grep -qx "\$c"; then
    echo "[preprod-baseline] ERROR: container not running: \$c" >&2
    exit 1
  fi
done

if [ ! -d "\$APP_DIR/.git" ]; then
  echo "[preprod-baseline] ERROR: app git dir missing: \$APP_DIR" >&2
  exit 1
fi

SHA=\$(cd "\$APP_DIR" && git rev-parse --short HEAD)
NOW=\$(date -u +%Y-%m-%dT%H:%M:%SZ)
API_IMAGE=\$(docker inspect "\$API_CONTAINER" --format '{{.Config.Image}}')
WEB_IMAGE=\$(docker inspect "\$WEB_CONTAINER" --format '{{.Config.Image}}')
RUNNER_IMAGE=\$(docker inspect "\$RUNNER_CONTAINER" --format '{{.Config.Image}}')

RUNNER_ENV=\$(docker inspect "\$RUNNER_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}')
AGENT_WS=\$(printf '%s\n' "\$RUNNER_ENV" | awk -F= '/^MBOS_AGENT_WS_URL=/{sub(/^MBOS_AGENT_WS_URL=/,""); print; exit}')
AGENT_KEY_PRESENT=no
if printf '%s\n' "\$RUNNER_ENV" | grep -q '^MBOS_AGENT_KEY='; then
  AGENT_KEY_PRESENT=yes
fi
SKILLS_DIR=\$(printf '%s\n' "\$RUNNER_ENV" | awk -F= '/^MBOS_AGENT_BUILTIN_SKILLS_DIR=/{sub(/^MBOS_AGENT_BUILTIN_SKILLS_DIR=/,""); print; exit}')

API_ENV="\$DEPLOY_DIR/api.env"
WEB_ENV="\$DEPLOY_DIR/web.env"

cat > "\$DEPLOY_DIR/\${OUT_BASENAME}.txt" <<EOT
timestamp_utc=\$NOW
deploy_dir=\$DEPLOY_DIR
app_dir=\$APP_DIR
git_sha=\$SHA
api_container=\$API_CONTAINER
web_container=\$WEB_CONTAINER
runner_container=\$RUNNER_CONTAINER
api_image=\$API_IMAGE
web_image=\$WEB_IMAGE
runner_image=\$RUNNER_IMAGE
api_env_sha256=\$(sha256sum "\$API_ENV" | awk '{print \$1}')
web_env_sha256=\$(sha256sum "\$WEB_ENV" | awk '{print \$1}')
runner_agent_ws=\$AGENT_WS
runner_key_present=\$AGENT_KEY_PRESENT
runner_builtin_skills_dir=\$SKILLS_DIR
EOT

echo "[preprod-baseline] wrote \$DEPLOY_DIR/\${OUT_BASENAME}.txt"
echo "[preprod-baseline] runner rollback script intentionally not generated; use release-kit/operator rollback evidence instead"
EOF

info "done"
