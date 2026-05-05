import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectOwnerSection } from '../ProjectOwnerSection';

describe('ProjectOwnerSection', () => {
  it('renders as a divider-led section without framed card chrome', () => {
    render(
      <ProjectOwnerSection
        canTransferProjectOwner={false}
        currentProject={{
          id: 'proj_1',
          workspace_id: 'ws_1',
          name: 'Project One',
          description: 'desc',
          visibility: 'private',
          join_policy: 'approval_required',
          governance_json: {},
          admin_member_ids: ['admin_1'],
          limits_json: {},
          owner_id: 'owner_1',
          status: 'active',
          created_at: '2026-02-01T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
        }}
        savingProjectOwner={false}
        selectedProjectOwner="owner_1"
        settingsT={(key) => key}
        workspaceMembers={[]}
        onOwnerChange={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByTestId('settings__project-owner-section').className).not.toMatch(/rounded-|shadow-|border-t/);
    expect(screen.getByText('project_owner_title')).toBeInTheDocument();
  });
});
