import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GovernanceSection } from '../GovernanceSection';

describe('GovernanceSection', () => {
  it('renders as a quiet detail section without a floating card shell', () => {
    render(
      <GovernanceSection
        canManageGovernance={true}
        canManageMembership={true}
        canReadAudit={true}
        locale="en"
        projectId="proj_1"
        settingsT={(key) => key}
        workspaceId="ws_1"
      />,
    );

    expect(screen.getByTestId('settings__governance-section').className).not.toMatch(/rounded-|shadow-|border-t/);
    expect(screen.getByText('governance_title')).toBeInTheDocument();
  });
});
