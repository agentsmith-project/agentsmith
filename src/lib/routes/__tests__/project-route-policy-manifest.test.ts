import { describe, expect, it } from 'vitest';

import {
  findProjectRoutePolicyByHref,
  listProjectGovernanceRoutePolicies,
  listSidebarProjectRoutePolicies,
} from '../project-route-policy-manifest';

describe('project route policy manifest', () => {
  it('keeps shared project context as a first-class governance surface', () => {
    const contextPolicy = findProjectRoutePolicyByHref('context');

    expect(contextPolicy).not.toBeNull();
    expect(contextPolicy?.sidebar).toBe(true);
    expect(contextPolicy?.governanceObject).toBe(true);
    expect(contextPolicy?.navSection).toBe('govern');
    expect(contextPolicy?.navLabelNamespace).toBe('context_store');
    expect(contextPolicy?.navLabelKey).toBe('project_title');
  });

  it('keeps notebook task detail out of sidebar navigation', () => {
    const notebookPolicy = findProjectRoutePolicyByHref('notebook');
    const sidebarPolicies = listSidebarProjectRoutePolicies();

    expect(notebookPolicy).not.toBeNull();
    expect(
      sidebarPolicies.filter((policy) => policy.href === 'notebook'),
    ).toHaveLength(1);
  });

  it('keeps governance surfaces explicit and ordered', () => {
    const governanceHrefs = listProjectGovernanceRoutePolicies().map((policy) => policy.href);

    expect(governanceHrefs).toEqual([
      'endpoints',
      'resource-policy',
      'context',
      'credentials',
      'members',
      'audit',
      'settings',
    ]);
  });
});
