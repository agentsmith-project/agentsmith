import { describe, expect, it } from 'vitest';

import {
  buildProjectSurfacePath,
  listAccessibleSidebarProjectRoutePolicies,
  resolveDefaultProjectSurfaceHref,
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

  it('builds locale-aware project surface paths', () => {
    expect(buildProjectSurfacePath('en-US', 'ws_1', 'proj_1', 'members')).toBe('/en-US/workspaces/ws_1/projects/proj_1/members');
    expect(buildProjectSurfacePath(undefined, 'ws_1', 'proj_1', 'members')).toBe('/workspaces/ws_1/projects/proj_1/members');
  });
});
