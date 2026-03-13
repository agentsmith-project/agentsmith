import type { ComponentProps } from 'react';

import type { useTranslations } from 'next-intl';

export interface OverviewLinkItem {
  href: string;
  label: string;
}

export interface OverviewPermissions {
  canManageAgents: boolean;
  canManageGovernance: boolean;
  canManageMembership: boolean;
  canReadAudit: boolean;
  canReadProjectSettings: boolean;
  canUseProject: boolean;
}

export function buildOverviewPaths(locale: string, workspaceId: string, projectId: string) {
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  return {
    basePath,
    workspaceBasePath: `/${locale}/workspaces/${workspaceId}`,
  };
}

export function buildWorkLinks(
  tNav: ReturnType<typeof useTranslations<'nav'>>,
  basePath: string,
): OverviewLinkItem[] {
  return [
    { label: tNav('chat'), href: `${basePath}/chat` },
    { label: tNav('notebook'), href: `${basePath}/notebook` },
    { label: tNav('files'), href: `${basePath}/files` },
    { label: tNav('endpoints'), href: `${basePath}/endpoints` },
    { label: tNav('usage'), href: `${basePath}/usage` },
    { label: tNav('api_access_guide'), href: `${basePath}/use-guide` },
  ];
}

export function buildGovernanceLinks(
  tNav: ReturnType<typeof useTranslations<'nav'>>,
  basePath: string,
  permissions: OverviewPermissions,
): OverviewLinkItem[] {
  return [
    ...(permissions.canManageAgents ? [{ label: tNav('agents'), href: `${basePath}/agents` }] : []),
    ...(permissions.canReadAudit ? [{ label: tNav('audit'), href: `${basePath}/audit` }] : []),
    ...(permissions.canManageGovernance
      ? [
          { label: tNav('resource_policy'), href: `${basePath}/resource-policy` },
          { label: tNav('credentials'), href: `${basePath}/credentials` },
        ]
      : []),
    ...(permissions.canManageMembership ? [{ label: tNav('members'), href: `${basePath}/members` }] : []),
    ...(permissions.canReadProjectSettings ? [{ label: tNav('settings'), href: `${basePath}/settings` }] : []),
  ];
}

export function createOverviewErrorContent(
  title: string,
  description: string,
): ComponentProps<'div'>['children'] {
  return (
    <div className="max-w-md text-center space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-tertiary">{description}</p>
    </div>
  );
}
