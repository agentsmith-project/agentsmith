import { describe, expect, it } from 'vitest';

import {
  buildProjectSurfacePath,
  canAccessProjectSurfaceHref,
  hasReachableDefaultProjectSurface,
  listAccessibleSidebarProjectRoutePolicies,
  listSwitchableProjects,
  resolveDefaultProjectSurfaceHref,
  resolveWorkspaceGovernanceProjectActions,
  shouldUseGovernableProjectSwitcher,
} from '../project-surface-access';

describe('project-surface-access', () => {
  it('prefers overview when project use surfaces are reachable', () => {
    expect(resolveDefaultProjectSurfaceHref(['project:endpoint:use'])).toBe('overview');
  });

  it('falls back to the first reachable governance surface when project use surfaces are not reachable', () => {
    expect(resolveDefaultProjectSurfaceHref(['project:governance:update'])).toBe('endpoints');
    expect(resolveDefaultProjectSurfaceHref(['project:membership:update'])).toBe('members');
    expect(resolveDefaultProjectSurfaceHref(['project:audit:read'])).toBe('audit');
  });

  it('keeps sidebar surfaces ordered by section before nav order', () => {
    expect(
      listAccessibleSidebarProjectRoutePolicies([
        'project:endpoint:use',
        'project:agent:manage',
        'project:governance:update',
      ]).map((policy) => policy.href),
    ).toEqual([
      'overview',
      'chat',
      'notebook',
      'files',
      'usage',
      'use-guide',
      'agents',
      'endpoints',
      'resource-policy',
      'context',
      'credentials',
      'settings',
    ]);
  });

  it('derives workspace governance actions from the same route truth', () => {
    expect(resolveWorkspaceGovernanceProjectActions({ permissions: ['project:endpoint:use'] })).toEqual({
      canOpenOverview: true,
      canOpenMembers: false,
      canOpenSettings: false,
    });
    expect(resolveWorkspaceGovernanceProjectActions({ permissions: ['project:membership:update'] })).toEqual({
      canOpenOverview: false,
      canOpenMembers: true,
      canOpenSettings: false,
    });
    expect(resolveWorkspaceGovernanceProjectActions({ permissions: ['project:audit:read'] })).toEqual({
      canOpenOverview: false,
      canOpenMembers: false,
      canOpenSettings: false,
    });
  });

  it('checks route reachability by href', () => {
    expect(canAccessProjectSurfaceHref(['project:governance:update'], 'settings')).toBe(true);
    expect(canAccessProjectSurfaceHref(['project:governance:update'], 'members')).toBe(false);
  });

  it('only enables the governable project switcher for governance-only project contexts', () => {
    expect(
      shouldUseGovernableProjectSwitcher({
        discoverableProjects: [{ id: 'proj_1' }],
        currentProject: { id: 'proj_1' },
        canManageWorkspaceGovernance: true,
      }),
    ).toBe(false);

    expect(
      shouldUseGovernableProjectSwitcher({
        discoverableProjects: [{ id: 'proj_1' }],
        currentProject: { id: 'proj_2' },
        canManageWorkspaceGovernance: true,
      }),
    ).toBe(true);
  });

  it('builds switchable projects from discoverable and governable sets without duplicates', () => {
    expect(
      listSwitchableProjects({
        discoverableProjects: [
          { id: 'proj_1', permissions: ['project:endpoint:use'] },
          { id: 'proj_2', permissions: ['project:membership:update'] },
        ],
        governableProjects: [
          { id: 'proj_2', permissions: ['project:membership:update'] },
          { id: 'proj_3', permissions: [] },
        ],
        currentProject: { id: 'proj_4', permissions: ['project:governance:update'] },
        includeGovernableProjects: true,
      }).map((project) => project.id),
    ).toEqual(['proj_4', 'proj_1', 'proj_2']);
  });

  it('treats projects without any reachable sidebar surface as non-switchable', () => {
    expect(hasReachableDefaultProjectSurface({ permissions: [] })).toBe(false);
    expect(hasReachableDefaultProjectSurface({ permissions: ['project:audit:read'] })).toBe(true);
  });

  it('builds locale-aware project surface paths', () => {
    expect(buildProjectSurfacePath('en-US', 'ws_1', 'proj_1', 'members')).toBe('/en-US/workspaces/ws_1/projects/proj_1/members');
    expect(buildProjectSurfacePath(undefined, 'ws_1', 'proj_1', 'members')).toBe('/workspaces/ws_1/projects/proj_1/members');
  });
});
