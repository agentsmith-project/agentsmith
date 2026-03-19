import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US' }),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (key === 'workspace_create_step_label') {
      return `workspace_create_step_label:${values?.step ?? ''}`;
    }
    return key;
  },
}));

import { SystemWorkspaceCreatePage } from '../SystemWorkspaceCreatePage';

describe('SystemWorkspaceCreatePage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('walks through the wizard with directory-backed admin binding', async () => {
    fetchMock
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
          items: [{ user_id: 'kc-ops-admin', email: 'ops@example.com', name: 'Ops Admin' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ws_new' }),
      });

    render(<SystemWorkspaceCreatePage />);

    expect(screen.getByTestId('system-workspace-create__heading')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('system-workspaces__draft-name'), {
      target: { value: 'Ops Workspace' },
    });
    fireEvent.click(screen.getByTestId('system-workspace-create__next'));

    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-url'), {
      target: { value: 'https://login.example.com' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-realm'), {
      target: { value: 'ops' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-client-id'), {
      target: { value: 'ops-client' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-client-secret'), {
      target: { value: 'ops-secret' },
    });
    fireEvent.click(screen.getByTestId('system-workspaces__verify-idp'));
    await waitFor(() => expect(screen.getByTestId('system-workspaces__idp-status')).toHaveTextContent('idp_status_verified_with_directory'));
    fireEvent.click(screen.getByTestId('system-workspace-create__next'));

    fireEvent.change(screen.getByTestId('system-workspaces__draft-admin'), {
      target: { value: 'ops@example.com' },
    });
    await waitFor(() => expect(screen.getByTestId('system-workspaces__admin-option--kc-ops-admin')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('system-workspaces__admin-option--kc-ops-admin'));
    fireEvent.click(screen.getByTestId('system-workspace-create__next'));

    expect(screen.getByText('Ops Workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('system-workspace-create__create'));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en-US/system/workspaces?workspace=ws_new'));
  });

  it('falls back to pending email binding when directory search is unavailable', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          idp_ok: true,
          directory_search_supported: false,
          advice_code: 'DIRECTORY_PERMISSION_RECOMMENDED',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'ws_pending' }),
      });

    render(<SystemWorkspaceCreatePage />);

    fireEvent.change(screen.getByTestId('system-workspaces__draft-name'), {
      target: { value: 'Email Pending Workspace' },
    });
    fireEvent.click(screen.getByTestId('system-workspace-create__next'));
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-url'), {
      target: { value: 'https://login.example.com' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-realm'), {
      target: { value: 'ops' },
    });
    fireEvent.change(screen.getByTestId('system-workspaces__draft-idp-client-id'), {
      target: { value: 'ops-client' },
    });
    fireEvent.click(screen.getByTestId('system-workspaces__verify-idp'));
    await waitFor(() => expect(screen.getByTestId('system-workspaces__idp-status')).toHaveTextContent('idp_status_verified_without_directory'));
    fireEvent.click(screen.getByTestId('system-workspace-create__next'));

    expect(screen.getByTestId('system-workspaces__admin-mode--directory')).toBeDisabled();
    fireEvent.change(screen.getByTestId('system-workspaces__draft-admin-email'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.click(screen.getByTestId('system-workspace-create__next'));
    fireEvent.click(screen.getByTestId('system-workspace-create__create'));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/en-US/system/workspaces?workspace=ws_pending'));
  });
});
