import { describe, expect, it } from 'vitest';

import {
  getWorkspaceAccessGroupLabel,
  WORKSPACE_BUILT_IN_GROUP_IDS,
} from '../member-groups';

describe('member group labels', () => {
  it('derives workspace access groups from explicit group membership only', () => {
    expect(getWorkspaceAccessGroupLabel({ groups: [] })).toBe('member');
    expect(
      getWorkspaceAccessGroupLabel({
        groups: [
          {
            id: WORKSPACE_BUILT_IN_GROUP_IDS.projectCreators,
            name: 'Project Creators',
            permission_template_id: 'tpl_workspace_project_creator',
            built_in: true,
            system_key: 'project_creators',
          },
        ],
      }),
    ).toBe('project_creator');
  });
});
