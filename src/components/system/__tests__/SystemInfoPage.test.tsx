import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/components/providers/ThemeProvider';

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
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';
  });

  function renderPage(snapshot: Parameters<typeof SystemInfoPage>[0]['snapshot']) {
    return render(
      <ThemeProvider>
        <SystemInfoPage snapshot={snapshot} />
      </ThemeProvider>,
    );
  }

  it('renders system info snapshot cards', () => {
    renderPage({
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
    });

    expect(screen.getByTestId('system-info__theme-toggle')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('system-info__theme-toggle')).getByTestId('system-info__theme-light').compareDocumentPosition(
        within(screen.getByTestId('system-info__theme-toggle')).getByTestId('system-info__theme-dark'),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId('system-info__theme-toggle')).toHaveTextContent('appearance');

    expect(screen.getByRole('heading', { name: 'info_title' })).toBeInTheDocument();
    expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
    expect(screen.getByTestId('page-layout__toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('system-info__shell')).not.toHaveClass('shadow-card');
    expect(screen.getByTestId('system-info__back').closest('a')).toHaveAttribute('href', '/en-US/system/workspaces');
    expect(screen.getByTestId('system-info__notice')).toBeInTheDocument();
    expect(screen.queryByText('workspace_total_label')).not.toBeInTheDocument();
    expect(screen.getByTestId('system-info__next-steps')).toBeInTheDocument();
    const nextSteps = screen.getByTestId('system-info__next-steps');
    expect(within(nextSteps).getByText('system_info_next_steps_directory_title').closest('a')).toHaveAttribute('href', '/en-US/system/workspaces');
    expect(within(nextSteps).getByText('back_to_workspaces')).not.toHaveClass('text-accent');
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
    expect(screen.getAllByText('tenant_configuration_incomplete').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps a workspace navigation CTA visible when everything is healthy', () => {
    renderPage({
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
    });

    expect(screen.getByTestId('system-info__attention')).toBeInTheDocument();
    expect(screen.getByText('system_info_all_clear_title')).toBeInTheDocument();
    expect(screen.getByText('system_info_all_clear_body')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'info_title' })).toBeInTheDocument();
    expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
    expect(screen.getByTestId('page-layout__toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('system-info__back')).toHaveAttribute('href', '/en-US/system/workspaces');
    expect(screen.queryByText('workspace_total_label')).not.toBeInTheDocument();
    const nextSteps = screen.getByTestId('system-info__next-steps');
    expect(within(nextSteps).getByText('system_info_next_steps_directory_title').closest('a')).toHaveAttribute(
      'href',
      '/en-US/system/workspaces',
    );
    expect(within(nextSteps).getByText('back_to_workspaces')).not.toHaveClass('text-accent');
  });

  it('switches theme directly from the system toolbar surface', async () => {
    renderPage({
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
    });

    const toggle = screen.getByTestId('system-info__theme-toggle');
    const light = within(toggle).getByTestId('system-info__theme-light');
    const dark = within(toggle).getByTestId('system-info__theme-dark');

    await waitFor(() => expect(light).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.click(dark);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('mbos.theme')).toBe('dark');
  });
});
