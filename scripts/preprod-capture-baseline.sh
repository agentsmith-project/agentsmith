#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${SSH_HOST:-mbos@mbos.imotion.ai}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/mbos/agentsmith_deploy_20260306}"
APP_DIR="${APP_DIR:-${DEPLOY_DIR}/agentsmith}"
OUT_BASENAME="${OUT_BASENAME:-BASELINE_$(date +%Y%m%d)}"

API_CONTAINER="${API_CONTAINER:-agentsmith-preprod-api}"
WEB_CONTAINER="${WEB_CONTAINER:-agentsmith-preprod-web}"
RUNNER_CONTAINER="${RUNNER_CONTAINER:-agentsmith-preprod-agent-codex}"

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
AGENT_KEY=\$(printf '%s\n' "\$RUNNER_ENV" | awk -F= '/^MBOS_AGENT_KEY=/{sub(/^MBOS_AGENT_KEY=/,""); print; exit}')
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
runner_key_prefix=\${AGENT_KEY:0:8}
runner_builtin_skills_dir=\$SKILLS_DIR
EOT

cat > "\$DEPLOY_DIR/rollback-to-\${OUT_BASENAME}.sh" <<'EOT'
#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/home/mbos/agentsmith_deploy_20260306}"
APP_DIR="${APP_DIR:-$DEPLOY_DIR/agentsmith}"
API_ENV="${API_ENV:-$DEPLOY_DIR/api.env}"
WEB_ENV="${WEB_ENV:-$DEPLOY_DIR/web.env}"

API_CONTAINER="${API_CONTAINER:-agentsmith-preprod-api}"
WEB_CONTAINER="${WEB_CONTAINER:-agentsmith-preprod-web}"
RUNNER_CONTAINER="${RUNNER_CONTAINER:-agentsmith-preprod-agent-codex}"

API_IMAGE="${API_IMAGE:-agentsmith-deploy:d0a7aae}"
WEB_IMAGE="${WEB_IMAGE:-agentsmith-deploy:d0a7aae}"
RUNNER_IMAGE="${RUNNER_IMAGE:-agentsmith-codex-runner:cnpy312-v1}"

MBOS_AGENT_WS_URL="${MBOS_AGENT_WS_URL:-ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_1772685779403_6631}"
MBOS_AGENT_KEY="${MBOS_AGENT_KEY:-ask_9650f58723ad6abdd86b3c66e82886e22741a41992526e44}"
MBOS_AGENT_BUILTIN_SKILLS_DIR="${MBOS_AGENT_BUILTIN_SKILLS_DIR:-}"

docker rm -f "$RUNNER_CONTAINER" "$WEB_CONTAINER" "$API_CONTAINER" >/dev/null 2>&1 || true

docker run -d --name "$API_CONTAINER" --restart unless-stopped --network host \
  --env-file "$API_ENV" \
  -v "$APP_DIR:/app" \
  "$API_IMAGE" \
  bash -lc 'npm run api:node:dev'

docker run -d --name "$WEB_CONTAINER" --restart unless-stopped --network host \
  --env-file "$WEB_ENV" \
  -v "$APP_DIR:/app" \
  "$WEB_IMAGE" \
  bash -lc 'npm run dev -- --port 3001 --hostname 0.0.0.0'

sleep 6

docker run -d --name "$RUNNER_CONTAINER" --restart unless-stopped --network host \
  -e MBOS_AGENT_RUNNER_DEBUG=1 \
  -e MBOS_AGENT_CODEX_YOLO=1 \
  -e MBOS_AGENT_BUILTIN_SKILLS_DIR="$MBOS_AGENT_BUILTIN_SKILLS_DIR" \
  -e MBOS_AGENT_WS_URL="$MBOS_AGENT_WS_URL" \
  -e MBOS_AGENT_KEY="$MBOS_AGENT_KEY" \
  -v "$APP_DIR:/app" \
  "$RUNNER_IMAGE" \
  bash -lc 'python3.12 --version && node -v && codex --version && npm run agent:codex-runner'

sleep 6
curl -sS -o /dev/null -w "[rollback] API openapi HTTP %{http_code}\n" http://localhost:20000/api/v1/openapi.json
curl -sS -o /dev/null -w "[rollback] Web login HTTP %{http_code}\n" http://localhost:3001/zh-CN/login
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | grep -E "agentsmith-preprod-(api|web|agent-codex)"
EOT
chmod +x "\$DEPLOY_DIR/rollback-to-\${OUT_BASENAME}.sh"

echo "[preprod-baseline] wrote \$DEPLOY_DIR/\${OUT_BASENAME}.txt"
echo "[preprod-baseline] wrote \$DEPLOY_DIR/rollback-to-\${OUT_BASENAME}.sh"
EOF

info "done"
