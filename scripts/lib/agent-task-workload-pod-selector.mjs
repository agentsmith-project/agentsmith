import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import selector from './agent-task-workload-pod-selector.cjs';

export const sanitizeWorkloadId = selector.sanitizeWorkloadId;
export const selectManagedWorkloadPodForTask = selector.selectManagedWorkloadPodForTask;

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
