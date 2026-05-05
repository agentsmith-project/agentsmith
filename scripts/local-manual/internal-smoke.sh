#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/internal-common.sh"

ensure_local_manual_ready
ensure_agent_task_demo_seeded
bash "${ROOT_DIR}/scripts/local-manual/internal-up.sh"

TOKEN="$(cat "$(backend_real_token_file)")"
PROJECT_ID="$(state_get project.id)"

TASK_ID="$(
  node - <<'NODE' "${TOKEN}" "${WORKSPACE_ID}" "${PROJECT_ID}" "${PORT_API}"
const [token, workspaceId, projectId, port] = process.argv.slice(2);
const base = `http://localhost:${port}/api/v1/workspaces/${workspaceId}/projects/${projectId}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const request = async (url, init) => {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}:${text}`);
  return text ? JSON.parse(text) : null;
};
const libraries = await request(`${base}/file-libraries`, { headers: { Authorization: `Bearer ${token}` } });
const workspaceLibraryId = Array.isArray(libraries?.items)
  ? libraries.items.find((item) => item?.status === 'ready')?.id
  : null;
const task = await request(`${base}/tasks`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    title: `Internal Smoke ${Date.now()}`,
    ...(workspaceLibraryId
      ? { workspace_file_library_id: workspaceLibraryId }
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

WORKLOAD_ID="$(node - <<'NODE' "${TASK_ID}"
const id = process.argv[2];
const normalized = id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
process.stdout.write(normalized || 'workload');
NODE
)"

for _ in $(seq 1 60); do
  POD_NAME="$(kubectl get pods -n "${K8S_NAMESPACE}" -l "workload_id=${WORKLOAD_ID}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -n "${POD_NAME}" ]]; then
    internal_info "internal smoke passed"
    internal_info "Task: ${TASK_ID}"
    internal_info "Workload pod: ${POD_NAME}"
    exit 0
  fi
  sleep 2
done

internal_err "internal smoke failed: workload pod not observed for task ${TASK_ID}"
exit 1
