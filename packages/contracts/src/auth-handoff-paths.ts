function localePrefix(locale: string | null | undefined): string {
  return locale ? `/${locale}` : '';
}

export function buildWorkspaceLoginLandingPath(workspaceId: string, projectId?: string | null): string {
  const targetProjectId = projectId?.trim();
  if (targetProjectId) {
    return `/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(targetProjectId)}/overview`;
  }
  return `/workspaces/${encodeURIComponent(workspaceId)}/projects`;
}

export function buildWorkspaceLoginLandingHref(
  locale: string | null | undefined,
  workspaceId: string,
  projectId?: string | null,
): string {
  return `${localePrefix(locale)}${buildWorkspaceLoginLandingPath(workspaceId, projectId)}`;
}
