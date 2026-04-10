import { describe, expect, it } from 'vitest';

import { getWorkspaceSettingsProjectActions } from '../project-view';

describe('getWorkspaceSettingsProjectActions', () => {
  it('shows overview only when project:endpoint:use is present', () => {
    expect(getWorkspaceSettingsProjectActions({ permissions: ['project:endpoint:use'] })).toEqual({
      canOpenOverview: true,
      canOpenMembers: false,
      canOpenSettings: false,
    });
  });

  it('shows members without overview for membership-only admins', () => {
    expect(getWorkspaceSettingsProjectActions({ permissions: ['project:membership:update'] })).toEqual({
      canOpenOverview: false,
      canOpenMembers: true,
      canOpenSettings: false,
    });
  });

  it('shows settings for governance readers without endpoint use', () => {
    expect(getWorkspaceSettingsProjectActions({ permissions: ['project:governance:update'] })).toEqual({
      canOpenOverview: false,
      canOpenMembers: false,
      canOpenSettings: true,
    });
    expect(getWorkspaceSettingsProjectActions({ permissions: ['project:admins:update'] })).toEqual({
      canOpenOverview: false,
      canOpenMembers: false,
      canOpenSettings: true,
    });
    expect(getWorkspaceSettingsProjectActions({ permissions: ['project:lifecycle:update'] })).toEqual({
      canOpenOverview: false,
      canOpenMembers: false,
      canOpenSettings: true,
    });
  });

  it('combines multiple reachable actions', () => {
    expect(
      getWorkspaceSettingsProjectActions({
        permissions: ['project:endpoint:use', 'project:membership:update', 'project:lifecycle:update'],
      }),
    ).toEqual({
      canOpenOverview: true,
      canOpenMembers: true,
      canOpenSettings: true,
    });
  });
});
