import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GeneralSettingsSection } from '../GeneralSettingsSection';

describe('GeneralSettingsSection', () => {
  it('renders as a quiet divider-led section without framed card chrome', () => {
    render(
      <GeneralSettingsSection
        canManageProjectLifecycle={false}
        commonT={(key) => key}
        description="Description"
        joinPolicy="approval_required"
        name="Project One"
        projectT={(key) => key}
        savingGeneral={false}
        settingsT={(key) => key}
        visibility="private"
        onDescriptionChange={() => undefined}
        onJoinPolicyChange={() => undefined}
        onNameChange={() => undefined}
        onSave={() => undefined}
        onVisibilityChange={() => undefined}
      />,
    );

    expect(screen.getByTestId('settings__general-section').className).not.toMatch(/rounded-|shadow-|border-t/);
    expect(screen.getByText('general_access_title')).toBeInTheDocument();
  });

  it('keeps the general save action in the section header so editable settings are not a hidden form', () => {
    render(
      <GeneralSettingsSection
        canManageProjectLifecycle
        commonT={(key) => key}
        description="Description"
        joinPolicy="approval_required"
        name="Project One"
        projectT={(key) => key}
        savingGeneral={false}
        settingsT={(key) => key}
        visibility="private"
        onDescriptionChange={() => undefined}
        onJoinPolicyChange={() => undefined}
        onNameChange={() => undefined}
        onSave={() => undefined}
        onVisibilityChange={() => undefined}
      />,
    );

    const saveButton = screen.getByTestId('settings__save-btn');
    expect(screen.getByTestId('settings__general-header')).toContainElement(saveButton);
    expect(saveButton).toHaveAttribute('data-visual-prominence', 'primary');
  });

  it('uses translated saving copy and translated description placeholder', () => {
    render(
      <GeneralSettingsSection
        canManageProjectLifecycle
        commonT={(key) => ({
          save: 'Save',
          saving: 'Saving from common namespace',
        }[key] ?? key)}
        description=""
        joinPolicy="approval_required"
        name="Project One"
        projectT={(key) => key}
        savingGeneral
        settingsT={(key) => ({
          general_access_title: 'General & Access',
          general_help: 'General help',
          project_name: 'Project Name',
          visibility: 'Visibility',
          description: 'Description',
          description_placeholder: 'Translated project description placeholder',
          join_policy: 'Join Policy',
        }[key] ?? key)}
        visibility="private"
        onDescriptionChange={() => undefined}
        onJoinPolicyChange={() => undefined}
        onNameChange={() => undefined}
        onSave={() => undefined}
        onVisibilityChange={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: /Saving from common namespace/i })).toBeDisabled();
    expect(screen.queryByText('Saving...')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Translated project description placeholder')).toBeInTheDocument();
  });
});
