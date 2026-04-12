import { render, screen, within } from '@testing-library/react';
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
            last_initialized_at: '2026-03-13T01:00:00.000Z',
            last_ready_at: '2026-03-13T01:00:00.000Z',
            last_failed_at: '2026-03-13T02:00:00.000Z',
            last_init_error: 'tenant_configuration_incomplete',
          },
        }}
      />,
    );

    expect(screen.getByTestId('system-info__heading')).toBeInTheDocument();
    expect(screen.getByTestId('system-info__back').closest('a')).toHaveAttribute('href', '/en-US/system/workspaces');
    expect(screen.getByTestId('system-info__notice')).toBeInTheDocument();
    expect(screen.getByTestId('system-info__next-steps')).toBeInTheDocument();
    expect(screen.getByTestId('system-info__workspaces-cta').closest('a')).toHaveAttribute('href', '/en-US/system/workspaces');
    expect(screen.getByTestId('system-info__health')).toBeInTheDocument();
    expect(screen.getByTestId('system-info__attention')).toBeInTheDocument();
    expect(screen.getByText('system_admin_title')).toBeInTheDocument();
    expect(screen.getByText('api_service_title')).toBeInTheDocument();
    expect(screen.getAllByText('workspace_registry_title').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('default_workspace_title')).toBeInTheDocument();
    expect(screen.getAllByText('default_idp_title').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('data_service_title').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('workspace_provisioning_title').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('workspace_last_initialized_label')).toBeInTheDocument();
    expect(screen.getByText('workspace_last_init_error_label')).toBeInTheDocument();
    expect(screen.getByText('mongodb://localhost:27017')).toBeInTheDocument();
    expect(screen.getByText('https://login.example.com')).toBeInTheDocument();
    expect(screen.getAllByText('config_status.available').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('config_status.configured').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('tenant_configuration_incomplete').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps a workspace navigation CTA visible when everything is healthy', () => {
    render(
      <SystemInfoPage
        snapshot={{
          system_admin_username: 'mbos-admin',
          api_base_url: 'http://localhost:20000',
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
            draft: 0,
            provisioning: 0,
            ready: 4,
            failed: 0,
            disabled: 0,
            last_initialized_at: '2026-03-13T01:00:00.000Z',
            last_ready_at: '2026-03-13T01:00:00.000Z',
            last_failed_at: null,
            last_init_error: null,
          },
        }}
      />,
    );

    expect(screen.getByTestId('system-info__attention')).toBeInTheDocument();
    expect(screen.getByText('system_info_all_clear_title')).toBeInTheDocument();
    expect(screen.getByText('system_info_all_clear_body')).toBeInTheDocument();
    expect(screen.getByTestId('system-info__workspaces-cta')).toBeInTheDocument();
  });
});
