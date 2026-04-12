import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectAdminGroupSection } from '../ProjectAdminGroupSection';

describe('ProjectAdminGroupSection', () => {
  it('renders as a divider-led section without framed card chrome', () => {
    render(
      <ProjectAdminGroupSection
        canAssignProjectAdmins={false}
        savingProjectAdmins={false}
        selectedProjectAdmins={[]}
        settingsT={(key) => key}
        workspaceMembers={[]}
        membersHref="/en/workspaces/ws_1/projects/proj_1/members"
        onCheckedChange={() => undefined}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByTestId('settings__project-admins-section').className).not.toMatch(/rounded-|shadow-|border-t/);
    expect(screen.getByText('admin_group_title')).toBeInTheDocument();
  });
});
