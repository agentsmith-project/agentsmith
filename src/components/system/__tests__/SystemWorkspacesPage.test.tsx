import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeWorkspace, mockWorkspaceListResponse } from './systemWorkspacesTestUtils';

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
  usePathname: () => '/en-US/system/workspaces',
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (key === 'updated_at' && values?.value) {
      return `updated_at:${values.value}`;
    }
    if (key === 'workspaces_summary_total_inline' || key === 'workspaces_attention_summary_inline' || key === 'workspaces_ready_summary_inline') {
      return `${key}:${values?.count ?? ''}`;
    }
    return key;
  },
}));

vi.mock('../SystemLogoutButton', () => ({
  SystemLogoutButton: () => <button type="button" data-testid="system__logout">logout</button>,
}));

import { SystemWorkspacesPage } from '../SystemWorkspacesPage';

describe('SystemWorkspacesPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    replaceMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      mockWorkspaceListResponse([
        makeWorkspace({
          id: 'ws_alpha',
          name: 'Alpha Workspace',
          workspace_admin: 'alpha-admin@example.com',
        }),
        makeWorkspace({
          id: 'ws_beta',
          name: 'Beta Workspace',
          provisioning_status: 'draft',
          last_initialized_at: null,
          workspace_admin: 'beta-admin@example.com',
          workspace_admin_user_id: undefined,
          workspace_admin_name: null,
          directory_idp: {
            client_id: 'beta-directory-client',
            has_client_secret: false,
          },
        }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  it('renders a lighter workspace directory and auto-selects the first workspace into settings', async () => {
    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__heading')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__new-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toHaveTextContent('alpha-admin@example.com');
    expect(screen.queryByText('workspace_idp_card_label')).not.toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__editor')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__basics')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__idp')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__admin')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__lifecycle')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alpha Workspace')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__read-only-notice')).toBeInTheDocument();
  });

  it('filters workspaces from the list without exposing tenant implementation details', async () => {
    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__card--ws_alpha')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('system-workspaces__search'), { target: { value: 'beta' } });
    expect(screen.queryByTestId('system-workspaces__card--ws_alpha')).not.toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__card--ws_beta')).toBeInTheDocument();
    expect(screen.queryByText('workspace_tenant_card_label')).not.toBeInTheDocument();
  });

  it('offers recovery actions when the current list view filters every workspace out', async () => {
    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__card--ws_alpha')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('system-workspaces__search'), { target: { value: 'missing' } });

    expect(screen.getByTestId('system-workspaces__empty')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__clear-search')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__reset-list')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('system-workspaces__reset-list'));

    expect(await screen.findByTestId('system-workspaces__card--ws_alpha')).toBeInTheDocument();
  });


  it('shows a filtered empty state with a clear filters recovery action', async () => {
    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__card--ws_alpha')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('system-workspaces__search'), { target: { value: 'gamma' } });

    await waitFor(() => expect(screen.getByTestId('system-workspaces__empty')).toBeInTheDocument());
    expect(screen.getByText('workspace_directory_empty_filtered_title')).toBeInTheDocument();
    expect(screen.getByText('workspace_directory_empty_filtered_description')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__clear-search'));

    await waitFor(() => expect(screen.getByTestId('system-workspaces__card--ws_alpha')).toBeInTheDocument());
  });

  it('updates the workspace query param when selecting another workspace from the list', async () => {
    render(<SystemWorkspacesPage />);

    expect(await screen.findByDisplayValue('Alpha Workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__card--ws_beta'));

    expect(replaceMock).toHaveBeenCalledWith('/en-US/system/workspaces?workspace=ws_beta', { scroll: false });
    expect(await screen.findByDisplayValue('Beta Workspace')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__read-only-notice')).toBeInTheDocument();
  });

  it('shows retry state when loading fails', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false });

    render(<SystemWorkspacesPage />);

    expect(await screen.findByTestId('system-workspaces__error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__retry'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('loads an existing workspace into structured settings and saves updates', async () => {
    fetchMock
      .mockResolvedValueOnce(mockWorkspaceListResponse([makeWorkspace({
        id: 'ws_alpha',
        provisioning_status: 'draft',
        last_initialized_at: null,
        workspace_admin: 'alpha-admin@example.com',
      })]))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          idp_ok: true,
          directory_search_supported: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ user_id: 'kc-ops-admin', email: 'ops-admin@example.com', name: 'Ops Admin' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ws_alpha' }),
      })
      .mockResolvedValueOnce(mockWorkspaceListResponse([makeWorkspace({
        id: 'ws_alpha',
        provisioning_status: 'draft',
        last_initialized_at: null,
        workspace_admin: 'ops-admin@example.com',
        workspace_admin_user_id: 'kc-ops-admin',
        workspace_admin_name: 'Ops Admin',
        login_idp: {
          kind: 'keycloak',
          url: 'https://login.example.com',
          realm: 'alpha-prod',
          client_id: 'alpha-client-prod',
        },
        directory_idp: {
          client_id: 'alpha-directory-client-prod',
          has_client_secret: true,
        },
      })]));

    render(<SystemWorkspacesPage />);

    expect(await screen.findByDisplayValue('Alpha Workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__enable-edit'));
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-url'), {
      target: { value: 'https://login.example.com' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-realm'), {
      target: { value: 'alpha-prod' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-client-id'), {
      target: { value: 'alpha-client-prod' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-directory-client-id'), {
      target: { value: 'alpha-directory-client-prod' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-client-secret'), {
      target: { value: 'directory-secret-1' },
    });
    fireEvent.click(screen.getByTestId('system-workspaces__verify-idp'));
    await waitFor(() => expect(screen.getByTestId('system-workspaces__idp-status')).toHaveTextContent('idp_status_verified_with_directory'));
    fireEvent.click(screen.getByTestId('system-workspaces__admin-mode--directory'));
    fireEvent.change(screen.getByTestId('system-workspaces__draft-admin'), {
      target: { value: 'ops-admin@example.com' },
    });
    await waitFor(() => expect(screen.getByTestId('system-workspaces__admin-option--kc-ops-admin')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('system-workspaces__admin-option--kc-ops-admin'));
    fireEvent.click(screen.getByTestId('system-workspaces__save'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/system/workspaces/ws_alpha',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    expect(screen.getByTestId('system-workspaces__save-notice')).toBeInTheDocument();
    expect(screen.getByTestId('system-workspaces__publish')).not.toBeDisabled();
  });

  it('shows the pending admin status when a workspace is still bound by email only', async () => {
    fetchMock.mockResolvedValueOnce(mockWorkspaceListResponse([
      makeWorkspace({
        id: 'ws_alpha',
        workspace_admin_user_id: undefined,
        workspace_admin: 'legacy-admin@example.com',
        workspace_admin_name: null,
      }),
    ]));

    render(<SystemWorkspacesPage />);

    expect(await screen.findByDisplayValue('Alpha Workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__enable-edit'));
    fireEvent.click(screen.getByTestId('system-workspaces__admin-mode--email'));
    expect(screen.getByTestId('system-workspaces__admin-binding-warning')).toHaveTextContent('workspace_admin_pending_badge');
  });

  it('publishes and disables a selected workspace from the lifecycle section', async () => {
    fetchMock
      .mockResolvedValueOnce(mockWorkspaceListResponse([
        makeWorkspace({
          id: 'ws_alpha',
          provisioning_status: 'draft',
          last_initialized_at: null,
        }),
      ]))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ws_alpha', provisioning_status: 'ready' }),
      })
      .mockResolvedValueOnce(mockWorkspaceListResponse([
        makeWorkspace({
          id: 'ws_alpha',
          provisioning_status: 'ready',
          last_initialized_at: '2026-03-10T02:00:00.000Z',
        }),
      ]))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ws_alpha', provisioning_status: 'disabled' }),
      })
      .mockResolvedValueOnce(mockWorkspaceListResponse([
        makeWorkspace({
          id: 'ws_alpha',
          provisioning_status: 'disabled',
          last_initialized_at: '2026-03-10T03:00:00.000Z',
        }),
      ]));

    render(<SystemWorkspacesPage />);

    expect(await screen.findByDisplayValue('Alpha Workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__publish'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/system/workspaces/ws_alpha/publish',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    fireEvent.click(screen.getByTestId('system-workspaces__disable'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/system/workspaces/ws_alpha/disable',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('opens a delete confirmation and removes a disabled workspace', async () => {
    fetchMock
      .mockResolvedValueOnce(mockWorkspaceListResponse([
        makeWorkspace({
          id: 'ws_alpha',
          provisioning_status: 'disabled',
          last_initialized_at: '2026-03-10T02:00:00.000Z',
        }),
      ]))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      });

    render(<SystemWorkspacesPage />);

    expect(await screen.findByDisplayValue('Alpha Workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__delete'));
    expect(screen.getByTestId('system-workspaces__delete-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspaces__delete-confirm'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/system/workspaces/ws_alpha',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });
});
