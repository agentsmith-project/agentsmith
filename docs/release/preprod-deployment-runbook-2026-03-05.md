# Preprod Deployment Runbook (2026-03-05)

## Scope

This runbook records the real preprod deployment work executed for `agentsmith` and the key lessons learned during rollout.

Hard constraints followed:

- Do not modify existing old server deployment directory.
- Use isolated new directory only: `/home/mbos/agentsmith_deploy_20260305`.
- Build dependency image on local machine and copy to server.

## Deployment Topology

- API: `http://mbos.imotion.ai:20000`
- Web: `http://mbos.imotion.ai:3001`
- Keycloak: `http://mbos.imotion.ai:8080/realms/mbos`
- Workspace: `ws_default` (`imotion`)
- Project: `Demos`

## New Deployment Directory

- `/home/mbos/agentsmith_deploy_20260305/agentsmith`
- Runtime containers:
  - `agentsmith-preprod-api`
  - `agentsmith-preprod-web`
  - `agentsmith-preprod-agent-codex`

## Core Environment Decisions

### API env

- `KEYCLOAK_ISSUER_URL=http://mbos.imotion.ai:8080/realms/mbos`
- `KEYCLOAK_BASE_URL=http://mbos.imotion.ai:8080`
- `MBOS_PUBLIC_BASE_URL=http://mbos.imotion.ai:20000`
- `MBOS_WEB_BASE_URL=http://mbos.imotion.ai:3001`

Storage endpoints were aligned to server-real credentials:

- Postgres: `postgresql://postgres:<pwd>@127.0.0.1:5432/postgres`
- Redis: `redis://:<pwd>@127.0.0.1:6379`
- Mongo: `mongodb://root:<pwd>@127.0.0.1:27017/admin`
- MinIO: `minioadmin/<pwd>`

### Web env

- `NEXT_PUBLIC_API_BASE=http://mbos.imotion.ai:20000/api/v1`
- `NEXT_PUBLIC_KEYCLOAK_URL=http://mbos.imotion.ai:8080/realms`
- `NEXT_PUBLIC_KEYCLOAK_REALM=mbos`
- `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=agentsmith`

## Keycloak Adjustments

Required for preprod HTTP demo line:

- Realm `sslRequired` set to `none`.
- Created/ensured client `agentsmith` in realm `mbos`.
- Fixed PKCE mismatch: set client attribute `pkce.code.challenge.method=plain` to match current web login flow.

## Data Initialization

Initialized under `ws_default`:

- Project `Demos`
- Credential `glm-key-prod`
- Endpoint `GLM-5`:
  - protocol: `anthropic_compatible`
  - base URL: `https://open.bigmodel.cn/api/anthropic`
  - model: `GLM-5`

## Real Runner Image Upgrade

Built locally and copied to server:

- image tag: `agentsmith-codex-runner:cnpy312-v1`
- tar: `/tmp/agentsmith-codex-runner-cnpy312-v1.tar`

Image includes:

- `codex-cli 0.110.0`
- Node `v22.22.0` / npm `10.9.4`
- Python `3.12.8`
- data libs: `numpy`, `pandas`, `scipy`, `matplotlib`, `scikit-learn`, `seaborn`, `jupyterlab`
- Chinese fonts: Noto CJK + WenQuanYi

Build-time proxy:

- `http://192.168.0.220:8889`

Post-build verification:

- No proxy env left in image config.

## Real Runner Runtime Notes

To avoid skill path resolution issues, runner starts with:

- `MBOS_AGENT_BUILTIN_SKILLS_DIR=/app/packages/agent-codex-runner/builtin-skills`

Runner container uses:

- image: `agentsmith-codex-runner:cnpy312-v1`
- command: `npm run agent:codex-runner`

## Incidents and Fixes

1. Login failed with `HTTPS required`
- Root cause: Keycloak realm ssl policy.
- Fix: `sslRequired=none` in preprod.

2. Login callback `invalid_request` (PKCE challenge method mismatch)
- Root cause: Keycloak client PKCE method and frontend mismatch.
- Fix: set client `pkce.code.challenge.method=plain`.

3. Workspace page shows session invalid
- Root cause: issuer mismatch (`127.0.0.1` vs `mbos.imotion.ai`) during token validation.
- Fix: set API `KEYCLOAK_ISSUER_URL` to public host realm URL.

4. API reachable but project routes fail
- Root cause: DB credentials/table initialization mismatch.
- Fix: align DB creds; initialize required project schema.

5. Runner online but task fails fast `builtin_skills_missing`
- Root cause: built-in skill directory resolution in runtime context.
- Fix: mount skills directory and set explicit `MBOS_AGENT_BUILTIN_SKILLS_DIR`.

## Acceptance Checklist

- `GET http://mbos.imotion.ai:20000/api/v1/openapi.json` -> `200`
- `GET http://mbos.imotion.ai:3001/zh-CN` -> `307` -> login flow works
- Keycloak login round-trip succeeds
- `Demos` project exists and `GLM-5` endpoint exists
- `agentsmith-preprod-agent-codex` is online in diagnostics

## Operational Guidance

- For browser/API checks from local machine, disable local proxy first if needed:
  - `unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY`
- Keep all preprod deployment artifacts inside:
  - `/home/mbos/agentsmith_deploy_20260305`
- Do not touch legacy deployment directory during preprod validation.
