export function buildTaskPath(
  locale: string,
  workspaceId: string,
  projectId: string,
  taskId: string,
) {
  return `/${locale}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks/${taskId}`;
}
