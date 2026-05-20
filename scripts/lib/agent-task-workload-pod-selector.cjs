function sanitizeWorkloadId(id) {
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

function readAnnotation(item, key) {
  const metadata = asRecord(asRecord(item)?.metadata);
  const annotations = asRecord(metadata?.annotations);
  const value = annotations?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readPodName(item) {
  const metadata = asRecord(asRecord(item)?.metadata);
  const value = metadata?.name;
  return typeof value === 'string' ? value.trim() : '';
}

function readDeletionTimestamp(item) {
  const metadata = asRecord(asRecord(item)?.metadata);
  const value = metadata?.deletionTimestamp;
  return typeof value === 'string' ? value.trim() : '';
}

function readStatusPhase(item) {
  const status = asRecord(asRecord(item)?.status);
  const value = status?.phase;
  return typeof value === 'string' ? value.trim() : '';
}

function readItems(payload) {
  const parsed = typeof payload === 'string'
    ? (payload.trim() ? JSON.parse(payload) : { items: [] })
    : payload;
  const record = asRecord(parsed);
  return Array.isArray(record?.items) ? record.items : [];
}

function matchesOptionalRawId(rawId, expectedId) {
  if (!rawId) return false;
  return expectedId ? rawId === expectedId : true;
}

function selectManagedWorkloadPodForTask(input) {
  const taskWorkloadId = sanitizeWorkloadId(input?.taskId);
  const workspaceId = String(input?.workspaceId || '').trim();
  const projectId = String(input?.projectId || '').trim();
  const candidates = readItems(input?.payload)
    .map((item) => ({
      podName: readPodName(item),
      app: readLabel(item, 'app'),
      workspaceId: readAnnotation(item, 'mbos.io/workspace-id'),
      projectId: readAnnotation(item, 'mbos.io/project-id'),
      workloadId: readAnnotation(item, 'mbos.io/workload-id'),
      labelWorkloadId: readLabel(item, 'workload_id'),
      expiresAt: readAnnotation(item, 'expires_at'),
      phase: readStatusPhase(item),
      deletionTimestamp: readDeletionTimestamp(item),
    }))
    .filter((item) => item.podName.length > 0)
    .filter((item) => !item.deletionTimestamp)
    .filter((item) => item.app === 'managed-workload')
    .filter((item) => matchesOptionalRawId(item.workspaceId, workspaceId))
    .filter((item) => matchesOptionalRawId(item.projectId, projectId))
    .filter((item) => item.workloadId === taskWorkloadId);

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

module.exports = {
  sanitizeWorkloadId,
  selectManagedWorkloadPodForTask,
};
