# Preprod Readiness Checklist (2026-03-06)

## Goal
- Validate preprod deploy based on the current MVP freeze baseline.
- Keep checks focused on real user-critical paths: login, endpoint access, notebook run visibility, cancel current run.

## 1) Automated Baseline Check

Run:

```bash
API_BASE=http://<host>:20000/api/v1 \
WEB_BASE=http://<host>:3001 \
WORKSPACE_ID=ws_default \
PROJECT_ID=<project_id> \
TASK_ID=<existing_task_id_or_placeholder> \
TOKEN=<optional_user_token> \
./scripts/preprod-acceptance-check.sh
```

Expected:
- `openapi` -> HTTP `200`
- `web-login` -> HTTP `200/307/308`
- `task-cancel-route` -> not `404` (route exists and is guarded)
- `/me` -> HTTP `200` when token is provided

## 2) Manual Acceptance (Must Pass)

1. Login round-trip:
- open web login page
- complete Keycloak login
- enter workspace/project shell successfully

2. Endpoint path:
- existing endpoint is visible
- endpoint test request succeeds

3. Notebook run state visibility:
- create/open a task
- send one user message
- verify top-level busy state remains visible during the full run
- verify elapsed duration keeps updating until terminal state

4. Cancel current run:
- while run is active, click "取消当前轮"
- verify UI shows cancel request feedback
- verify run transitions to terminal state and busy badge clears

5. Pending queue behavior:
- while run is active, send a second message
- verify message is queued (not lost)
- verify queued message is sent after current run completes

## 3) Evidence Capture

Record:
- commit SHA deployed
- API/Web/Runner image tag
- command output of `./scripts/preprod-acceptance-check.sh`
- one notebook task URL and screenshot for:
  - run active state
  - cancel action feedback
  - run terminal completion

## 4) Go / No-Go Rule

GO only if:
- automated baseline check passes
- all manual acceptance items pass
- no `404`/contract mismatch on notebook cancel route
- no regression where busy state disappears before run terminal event
