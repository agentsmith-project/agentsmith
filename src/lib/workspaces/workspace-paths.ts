export function buildWorkspaceOverviewPath(): string {
  return '/workspaces/overview';
}

export function buildWorkspaceOverviewHref(locale: string | null | undefined): string {
  const localePrefix = locale ? `/${locale}` : '';
  return `${localePrefix}/workspaces/overview`;
}
