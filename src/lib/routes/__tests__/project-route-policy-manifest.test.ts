import { describe, expect, it } from 'vitest';

import { PROJECT_SETTINGS_READ_PERMISSIONS } from '@/lib/projects/project-settings-access';
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

  it('keeps personal project context available as a non-sidebar member surface', () => {
    const personalContextPolicy = findProjectRoutePolicyByHref('my-context');

    expect(personalContextPolicy).not.toBeNull();
    expect(personalContextPolicy?.permissions).toEqual(['project:endpoint:use']);
    expect(personalContextPolicy?.sidebar).toBe(false);
    expect(personalContextPolicy?.governanceObject).toBe(false);
    expect(personalContextPolicy?.navSection).toBe('govern');
    expect(personalContextPolicy?.navLabelNamespace).toBe('context_store');
    expect(personalContextPolicy?.navLabelKey).toBe('member_project_title');
  });

  it('keeps agent task detail out of sidebar navigation', () => {
    const agentTasksPolicy = findProjectRoutePolicyByHref('agent-tasks');
    const sidebarPolicies = listSidebarProjectRoutePolicies();

    expect(agentTasksPolicy).not.toBeNull();
    expect(agentTasksPolicy?.permissions).toEqual(['project:agent_task:use']);
    expect(agentTasksPolicy?.navLabelKey).toBe('agent_tasks');
    expect(
      sidebarPolicies.filter((policy) => policy.href === 'agent-tasks'),
    ).toHaveLength(1);
    expect(findProjectRoutePolicyByHref('notebook')).toBeNull();
  });

  it('uses the target Agent Runners route and permissions', () => {
    const agentRunnersPolicy = findProjectRoutePolicyByHref('agent-runners');

    expect(agentRunnersPolicy).not.toBeNull();
    expect(agentRunnersPolicy?.permissions).toEqual(['project:agent_runner:read', 'project:agent_runner:manage']);
    expect(agentRunnersPolicy?.navLabelKey).toBe('agent_runners');
    expect(agentRunnersPolicy?.navSection).toBe('develop');
    expect(findProjectRoutePolicyByHref('agents')).toBeNull();
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

  it('keeps overview aligned with the project use surface permission', () => {
    const overviewPolicy = findProjectRoutePolicyByHref('overview');

    expect(overviewPolicy?.permissions).toEqual(['project:endpoint:use']);
  });

  it('keeps settings aligned with the shared settings-read permission contract', () => {
    const settingsPolicy = findProjectRoutePolicyByHref('settings');

    expect(settingsPolicy?.permissions).toEqual([...PROJECT_SETTINGS_READ_PERMISSIONS]);
  });
});
