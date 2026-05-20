#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/internal-common.sh"

ensure_local_manual_ready
ensure_agent_task_diagnostics_ready
bash "${ROOT_DIR}/scripts/local-manual/internal-up.sh"

TOKEN="$(cat "$(backend_real_token_file)")"
PROJECT_ID="$(state_get project.id)"

TASK_ID="$(
  node - <<'NODE' "${TOKEN}" "${WORKSPACE_ID}" "${PROJECT_ID}" "${PORT_API}" "${ROOT_DIR}"
import { pathToFileURL } from 'node:url';

const [token, workspaceId, projectId, port, rootDir] = process.argv.slice(2);
const selectorUrl = new URL('scripts/lib/file-library-reuse-selector.mjs', pathToFileURL(`${rootDir}/`));
const { selectReusableTaskWorkspaceFileLibraryId } = await import(selectorUrl.href);
const base = `http://localhost:${port}/api/v1/workspaces/${workspaceId}/projects/${projectId}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const request = async (url, init) => {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}:${text}`);
  return text ? JSON.parse(text) : null;
};
const libraries = await request(`${base}/file-libraries`, { headers: { Authorization: `Bearer ${token}` } });
const workspaceLibraryId = selectReusableTaskWorkspaceFileLibraryId(libraries);
const task = await request(`${base}/tasks`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    title: `Internal Smoke ${Date.now()}`,
    ...(workspaceLibraryId
      ? { workspace_mode: 'use_existing', workspace_file_library_id: workspaceLibraryId }
      : { workspace_mode: 'create_new' }),
  }),
});
const taskId = task?.id;
if (!taskId) throw new Error('task_id_missing');
await request(`${base}/tasks/${taskId}/runs`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    intent: 'Reply exactly: internal smoke ok',
  }),
});
process.stdout.write(taskId);
NODE
)"

WORKLOAD_ID="$(node "${ROOT_DIR}/scripts/lib/agent-task-workload-pod-selector.mjs" --sanitize "${TASK_ID}")"

POD_NAME=""
for _ in $(seq 1 60); do
  POD_LIST_JSON="$(kubectl get pods -n "${K8S_NAMESPACE}" -l "app=managed-workload" -o json 2>/dev/null || true)"
  if [[ -n "${POD_LIST_JSON}" ]]; then
    if ! POD_NAME="$(printf '%s' "${POD_LIST_JSON}" | node "${ROOT_DIR}/scripts/lib/agent-task-workload-pod-selector.mjs" "${TASK_ID}" "${WORKSPACE_ID}" "${PROJECT_ID}")"; then
      internal_err "internal smoke failed: workload_pod_selector_error task=${TASK_ID} expected_pod=workload-${WORKLOAD_ID} workload_id_prefix=${WORKLOAD_ID}"
      exit 1
    fi
  fi
  if [[ -n "${POD_NAME}" ]]; then
    internal_info "internal smoke passed"
    internal_info "Task: ${TASK_ID}"
    internal_info "Workload pod: ${POD_NAME}"
    exit 0
  fi
  sleep 2
done

internal_err "internal smoke failed: workload pod not observed for task ${TASK_ID} expected_pod=workload-${WORKLOAD_ID} workload_id_prefix=${WORKLOAD_ID}"
exit 1
