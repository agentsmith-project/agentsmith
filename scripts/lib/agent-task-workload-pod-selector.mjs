import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function sanitizeWorkloadId(id) {
  const normalized = String(id || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return normalized || 'workload';
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readLabel(item, key) {
  const metadata = asRecord(asRecord(item)?.metadata);
  const labels = asRecord(metadata?.labels);
  const value = labels?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readPodName(item) {
  const metadata = asRecord(asRecord(item)?.metadata);
  const value = metadata?.name;
  return typeof value === 'string' ? value.trim() : '';
}

function readItems(payload) {
  const parsed = typeof payload === 'string'
    ? (payload.trim() ? JSON.parse(payload) : { items: [] })
    : payload;
  const record = asRecord(parsed);
  return Array.isArray(record?.items) ? record.items : [];
}

function isTaskWorkloadId(workloadId, taskWorkloadId) {
  return workloadId === taskWorkloadId || workloadId.startsWith(`${taskWorkloadId}-`);
}

function isDerivedLabelId(labelId, sourceId) {
  if (!sourceId) return true;
  const sanitized = sanitizeWorkloadId(sourceId);
  return labelId === sanitized || labelId.startsWith(`${sanitized}-`);
}

export function selectManagedWorkloadPodForTask(input) {
  const taskWorkloadId = sanitizeWorkloadId(input?.taskId);
  const expectedPodName = `workload-${taskWorkloadId}`;
  const workspaceId = String(input?.workspaceId || '').trim();
  const projectId = String(input?.projectId || '').trim();
  const candidates = readItems(input?.payload)
    .map((item) => ({
      podName: readPodName(item),
      app: readLabel(item, 'app'),
      workspaceId: readLabel(item, 'workspace_id'),
      projectId: readLabel(item, 'project_id'),
      workloadId: readLabel(item, 'workload_id'),
    }))
    .filter((item) => item.app === 'managed-workload')
    .filter((item) => isDerivedLabelId(item.workspaceId, workspaceId))
    .filter((item) => isDerivedLabelId(item.projectId, projectId))
    .filter((item) => item.podName === expectedPodName)
    .filter((item) => isTaskWorkloadId(item.workloadId, taskWorkloadId));

  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length > 1) {
    const error = new Error('ambiguous_managed_workload_pod');
    error.candidates = candidates;
    throw error;
  }
  return {
    podName: candidates[0].podName,
    workloadId: candidates[0].workloadId,
  };
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function isCliEntrypoint() {
  const scriptPath = process.argv[1];
  return Boolean(scriptPath) && import.meta.url === pathToFileURL(scriptPath).href;
}

if (isCliEntrypoint()) {
  const [firstArg, ...restArgs] = process.argv.slice(2);
  if (firstArg === '--sanitize') {
    process.stdout.write(sanitizeWorkloadId(restArgs[0] || ''));
    process.exit(0);
  }

  const [taskId, workspaceId, projectId] = [firstArg, ...restArgs];
  if (!taskId) {
    console.error('task_id_required');
    process.exit(2);
  }

  try {
    const selected = selectManagedWorkloadPodForTask({
      taskId,
      workspaceId,
      projectId,
      payload: readStdin(),
    });
    if (selected?.podName) {
      process.stdout.write(selected.podName);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error?.candidates) {
      console.error(JSON.stringify({ candidates: error.candidates }));
    }
    process.exit(2);
  }
}
