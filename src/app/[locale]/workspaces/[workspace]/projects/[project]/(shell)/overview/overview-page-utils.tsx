import type { ComponentProps } from 'react';

import type { ProjectRoutePolicy } from '@/lib/routes/project-route-policy';
import type { useTranslations } from 'next-intl';

export interface OverviewSurfaceSummary {
  useLabels: string[];
  developLabels: string[];
  governLabels: string[];
}

export function buildOverviewPaths(locale: string, workspaceId: string, projectId: string) {
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  return {
    basePath,
    workspaceBasePath: `/${locale}/workspaces/${workspaceId}`,
  };
}

export function buildOverviewSurfaceSummary(
  policies: readonly ProjectRoutePolicy[],
  tNav: ReturnType<typeof useTranslations<'nav'>>,
  tContext: ReturnType<typeof useTranslations<'context_store'>>,
): OverviewSurfaceSummary {
  const labelFor = (policy: ProjectRoutePolicy) =>
    policy.navLabelNamespace === 'context_store'
      ? tContext(policy.navLabelKey)
      : tNav(policy.navLabelKey);

  return {
    useLabels: policies
      .filter((policy) => policy.navSection === 'use')
      .map(labelFor),
    developLabels: policies
      .filter((policy) => policy.navSection === 'develop')
      .map(labelFor),
    governLabels: policies
      .filter((policy) => policy.navSection === 'govern' || policy.navSection === 'operate')
      .map(labelFor),
  };
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
