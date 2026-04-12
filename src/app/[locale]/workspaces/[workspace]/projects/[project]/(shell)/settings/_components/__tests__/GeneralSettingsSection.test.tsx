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
});
