import { describe, expect, it } from 'vitest';
import type { useTranslations } from 'next-intl';

import { createProjectRoutePolicy } from '@/lib/routes/project-route-policy';

import {
  buildOverviewNextStepEntries,
  buildOverviewSurfaceSummary,
  getOverviewSecondaryStepTestId,
  overviewTestIds,
  splitOverviewPrimaryStep,
} from '../overview-page-utils';

const tNav = ((key: string) => key) as ReturnType<typeof useTranslations<'nav'>>;
const tContext = ((key: string) => `context:${key}`) as ReturnType<typeof useTranslations<'context_store'>>;
const tOverview = ((key: string) => key) as ReturnType<typeof useTranslations<'overview'>>;

describe('overview page utils', () => {
  it('keeps only four prominent next steps and moves the rest into linked grouped summaries', () => {
    const policies = [
      createProjectRoutePolicy({
        permissions: ['project:endpoint:use'],
        href: 'chat',
        navLabelKey: 'chat',
        navSection: 'use',
        navOrder: 10,
      }),
      createProjectRoutePolicy({
        permissions: ['project:endpoint:use'],
        href: 'notebook',
        navLabelKey: 'notebook',
        navSection: 'use',
        navOrder: 20,
      }),
      createProjectRoutePolicy({
        permissions: ['project:endpoint:use'],
        href: 'files',
        navLabelKey: 'files',
        navSection: 'use',
        navOrder: 30,
      }),
      createProjectRoutePolicy({
        permissions: ['project:endpoint:use'],
        href: 'usage',
        navLabelKey: 'usage',
        navSection: 'use',
        navOrder: 40,
      }),
      createProjectRoutePolicy({
        permissions: ['project:endpoint:use'],
        href: 'use-guide',
        navLabelKey: 'api_access_guide',
        navSection: 'use',
        navOrder: 50,
      }),
      createProjectRoutePolicy({
        permissions: ['project:agent:use'],
        href: 'agents',
        navLabelKey: 'agents',
        navSection: 'develop',
        navOrder: 10,
      }),
      createProjectRoutePolicy({
        permissions: ['project:governance:update'],
        href: 'context',
        navLabelKey: 'project_title',
        navLabelNamespace: 'context_store',
        navSection: 'govern',
        navOrder: 30,
      }),
      createProjectRoutePolicy({
        permissions: ['project:governance:update'],
        href: 'resource-policy',
        navLabelKey: 'resource_policy',
        navSection: 'govern',
        navOrder: 20,
      }),
    ];

    const featuredEntries = buildOverviewNextStepEntries(policies, tNav, tContext, tOverview);

    expect(featuredEntries).toEqual([
      {
        href: 'chat',
        label: 'chat',
        description: 'next_steps.chat_description',
      },
      {
        href: 'notebook',
        label: 'notebook',
        description: 'next_steps.notebook_description',
      },
      {
        href: 'files',
        label: 'files',
        description: 'next_steps.files_description',
      },
      {
        href: 'context',
        label: 'context:project_title',
        description: 'next_steps.context_description',
      },
    ]);

    const { primaryStep, secondarySteps } = splitOverviewPrimaryStep(featuredEntries);

    expect(primaryStep?.href).toBe('chat');
    expect(secondarySteps.map((entry) => entry.href)).toEqual(['notebook', 'files', 'context']);

    const summary = buildOverviewSurfaceSummary(
      policies,
      tNav,
      tContext,
      featuredEntries.map((entry) => entry.href),
    );

    expect(summary.useLabels).toEqual([
      { href: 'usage', label: 'usage' },
      { href: 'use-guide', label: 'api_access_guide' },
    ]);
    expect(summary.developLabels).toEqual([
      { href: 'agents', label: 'agents' },
    ]);
    expect(summary.governLabels).toEqual([
      { href: 'resource-policy', label: 'resource_policy' },
    ]);
  });

  it('keeps overview selectors in the project-overview namespace', () => {
    expect(overviewTestIds.page).toBe('project-overview__page');
    expect(overviewTestIds.primaryCta).toBe('project-overview__primary-cta');
    expect(overviewTestIds.surfaceGroup('govern')).toBe('project-overview__surface-group--govern');
    expect(getOverviewSecondaryStepTestId('notebook')).toBe('project-overview__secondary-step--notebook');
  });
});
