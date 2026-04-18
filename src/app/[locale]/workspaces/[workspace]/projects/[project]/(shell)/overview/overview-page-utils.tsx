import type { ComponentProps } from 'react';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { ProjectRoutePolicy } from '@/lib/routes/project-route-policy';
import type { useTranslations } from 'next-intl';

export interface OverviewSurfaceSummary {
  useLabels: Array<OverviewSurfaceSummaryEntry>;
  developLabels: Array<OverviewSurfaceSummaryEntry>;
  governLabels: Array<OverviewSurfaceSummaryEntry>;
}

export interface OverviewSurfaceSummaryEntry {
  href: ProjectRoutePolicy['href'];
  label: string;
}

export interface OverviewNextStepEntry {
  href: ProjectRoutePolicy['href'];
  label: string;
  description: string;
  testId: string;
}

export interface OverviewPrimaryStepSplit {
  primaryStep: OverviewNextStepEntry | null;
  secondarySteps: OverviewNextStepEntry[];
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
  hiddenHrefs: readonly ProjectRoutePolicy['href'][] = [],
): OverviewSurfaceSummary {
  const hiddenHrefSet = new Set(hiddenHrefs);
  const labelFor = (policy: ProjectRoutePolicy) =>
    policy.navLabelNamespace === 'context_store'
      ? tContext(policy.navLabelKey)
      : tNav(policy.navLabelKey);
  const itemFor = (policy: ProjectRoutePolicy) => ({
    href: policy.href,
    label: labelFor(policy),
  });

  return {
    useLabels: policies
      .filter((policy) => policy.navSection === 'use' && !hiddenHrefSet.has(policy.href))
      .map(itemFor),
    developLabels: policies
      .filter((policy) => policy.navSection === 'develop' && !hiddenHrefSet.has(policy.href))
      .map(itemFor),
    governLabels: policies
      .filter(
        (policy) =>
          (policy.navSection === 'govern' || policy.navSection === 'operate')
          && !hiddenHrefSet.has(policy.href),
      )
      .map(itemFor),
  };
}

const OVERVIEW_NEXT_STEP_PRIORITY: Array<{
  href: ProjectRoutePolicy['href'];
  descriptionKey: string;
  testId: string;
}> = [
  { href: 'chat', descriptionKey: 'next_steps.chat_description', testId: 'project-hub__next-step--chat' },
  { href: 'notebook', descriptionKey: 'next_steps.notebook_description', testId: 'project-hub__next-step--notebook' },
  { href: 'files', descriptionKey: 'next_steps.files_description', testId: 'project-hub__next-step--files' },
  { href: 'context', descriptionKey: 'next_steps.context_description', testId: 'project-hub__next-step--context' },
  { href: 'members', descriptionKey: 'next_steps.members_description', testId: 'project-hub__next-step--members' },
  { href: 'settings', descriptionKey: 'next_steps.settings_description', testId: 'project-hub__next-step--settings' },
  { href: 'audit', descriptionKey: 'next_steps.audit_description', testId: 'project-hub__next-step--audit' },
  { href: 'endpoints', descriptionKey: 'next_steps.endpoints_description', testId: 'project-hub__next-step--endpoints' },
  { href: 'agents', descriptionKey: 'next_steps.agents_description', testId: 'project-hub__next-step--agents' },
];

export function buildOverviewNextStepEntries(
  policies: readonly ProjectRoutePolicy[],
  tNav: ReturnType<typeof useTranslations<'nav'>>,
  tContext: ReturnType<typeof useTranslations<'context_store'>>,
  tOverview: ReturnType<typeof useTranslations<'overview'>>,
): OverviewNextStepEntry[] {
  const policyByHref = new Map(policies.map((policy) => [policy.href, policy]));
  return OVERVIEW_NEXT_STEP_PRIORITY.flatMap((item) => {
    const policy = policyByHref.get(item.href);
    if (!policy) return [];
    const label =
      policy.navLabelNamespace === 'context_store'
        ? tContext(policy.navLabelKey)
        : tNav(policy.navLabelKey);
    return [{
      href: policy.href,
      label,
      description: tOverview(item.descriptionKey),
      testId: item.testId,
    }];
  }).slice(0, 4);
}

export function splitOverviewPrimaryStep(
  entries: readonly OverviewNextStepEntry[],
): OverviewPrimaryStepSplit {
  const [primaryStep, ...secondarySteps] = entries;
  return {
    primaryStep: primaryStep ?? null,
    secondarySteps,
  };
}

export function createOverviewErrorContent(
  title: string,
  description: string,
  action?: { href: string; label: string },
): ComponentProps<'div'>['children'] {
  return (
    <div className="max-w-md text-center space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-tertiary">{description}</p>
      {action ? (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
