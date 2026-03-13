import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('../SystemLogoutButton', () => ({
  SystemLogoutButton: () => <button type="button" data-testid="system__logout">logout</button>,
}));

import { SystemInfoPage } from '../SystemInfoPage';

describe('SystemInfoPage', () => {
  it('renders system info snapshot cards', () => {
    render(
      <SystemInfoPage
        snapshot={{
          system_admin_username: 'mbos-admin',
          api_base_url: 'http://localhost:20000',
          workspace_registry_path: 'artifacts/system-workspaces.json',
          workspace_registry_status: 'available',
          substrate_label: 'primary',
          substrate_url: 'mongodb://localhost:27017',
          data_service_status: 'configured',
          database_prefix: 'agentsmith_ws_',
          collection_prefix: 'ws_',
          key_prefix: 'ws:',
          default_workspace_id: 'ws_default',
          default_workspace_name: 'Default Workspace',
          default_idp_url: 'https://login.example.com',
          default_idp_realm: 'mbos',
          default_idp_client_id: 'agentsmith',
          default_idp_status: 'configured',
          workspace_provisioning: {
            total: 4,
            draft: 1,
            provisioning: 1,
            ready: 1,
            failed: 1,
            disabled: 0,
          },
        }}
      />,
    );

    expect(screen.getByTestId('system-info__heading')).toBeInTheDocument();
    expect(screen.getByTestId('system-info__back').closest('a')).toHaveAttribute('href', '/en-US/system/workspaces');
    expect(screen.getByTestId('system-info__notice')).toBeInTheDocument();
    expect(screen.getByText('system_admin_title')).toBeInTheDocument();
    expect(screen.getByText('api_service_title')).toBeInTheDocument();
    expect(screen.getByText('workspace_registry_title')).toBeInTheDocument();
    expect(screen.getByText('default_workspace_title')).toBeInTheDocument();
    expect(screen.getByText('default_idp_title')).toBeInTheDocument();
    expect(screen.getByText('data_service_title')).toBeInTheDocument();
    expect(screen.getByText('workspace_provisioning_title')).toBeInTheDocument();
    expect(screen.getByText('mongodb://localhost:27017')).toBeInTheDocument();
    expect(screen.getByText('artifacts/system-workspaces.json')).toBeInTheDocument();
    expect(screen.getByText('https://login.example.com')).toBeInTheDocument();
    expect(screen.getByText('config_status.available')).toBeInTheDocument();
    expect(screen.getAllByText('config_status.configured')).toHaveLength(2);
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
