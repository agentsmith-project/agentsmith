export function buildWorkspaceOverviewHref(locale: string | null | undefined): string {
  const localePrefix = locale ? `/${locale}` : '';
  return `${localePrefix}/workspaces/overview`;
}
