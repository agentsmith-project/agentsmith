# Preprod Deployment Delta (2026-03-06)

## Context
- Previous deploy directory: `/home/mbos/agentsmith_deploy_20260305`
- New isolated deploy directory: `/home/mbos/agentsmith_deploy_20260306`
- Deployed git SHA: `dbeef9e`

## What Changed
1. API / Web / Runner containers were recreated and switched to mount:
   - `/home/mbos/agentsmith_deploy_20260306/agentsmith`
2. Runner was restarted and bound to latest enabled external agent in preprod project.
3. Preprod acceptance check script passed against `mbos.imotion.ai`:
   - openapi reachable
   - web login page reachable
   - notebook task cancel route exists and is auth-guarded

## Infrastructure Fix Applied
- `pgvector` extension was missing on preprod Postgres runtime image.
- Immediate fix applied on running container:
  - install `postgresql-17-pgvector`
  - run `CREATE EXTENSION IF NOT EXISTS vector;`

### Important Caveat
- This fix is runtime-container local.
- If `agentsmith-postgres` container is recreated from base image, package/extension state may be lost.
- Follow-up (recommended): bake pgvector into infra image or init path as immutable provisioning step.

## New Operational Tooling (in repo)
1. `scripts/preprod-ensure-pgvector.sh`
   - Ensures pgvector package + extension on remote preprod host.
2. `scripts/preprod-capture-baseline.sh`
   - Captures deploy baseline and writes rollback script to deploy directory.
3. Make targets:
   - `make preprod-ensure-pgvector`
   - `make preprod-capture-baseline`
   - `make preprod-acceptance-check`

## Suggested Routine Before Preprod Demo
1. `make preprod-ensure-pgvector`
2. `make preprod-capture-baseline`
3. `make preprod-acceptance-check`
