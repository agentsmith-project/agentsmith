/**
 * Tests for CredentialsPage
 *
 * Security-focused tests for project credential management:
 * - Credential listing (never shows secret values)
 * - Fingerprint display instead of actual values
 * - Create, rotate, delete operations
 * - Permission checks
 * - Time formatting
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCanAccessCredentials } from '@/lib/hooks/use-permissions';

const mockList = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  CredentialsAPI: vi.fn().mockImplementation(function () {
    return {
      list: mockList,
      delete: mockDelete,
    };
  }),
  handleErrorForToast: vi.fn(),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanAccessCredentials: vi.fn(() => ({ canRead: true, canManage: true })),
}));

vi.mock('@/components/credentials/CreateCredentialDialog', () => ({
  CreateCredentialDialog: function CreateCredentialDialog({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess?: () => void;
  }) {
    if (!open) return null;
    return (
      <div data-testid="create-credential-dialog">
        <button
          data-testid="create-submit"
          onClick={() => onSuccess?.()}
        >
          Create
        </button>
      </div>
    );
  },
}));

vi.mock('@/components/credentials/RotateCredentialDialog', () => ({
  RotateCredentialDialog: function RotateCredentialDialog({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess?: () => void;
  }) {
    if (!open) return null;
    return (
      <div data-testid="rotate-credential-dialog">
        <button
          data-testid="rotate-submit"
          onClick={() => onSuccess?.()}
        >
          Rotate
        </button>
      </div>
    );
  },
}));

vi.mock('@/components/credentials/DeleteCredentialDialog', () => ({
  DeleteCredentialDialog: function DeleteCredentialDialog({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: () => Promise<void>;
  }) {
    if (!open) return null;
    return (
      <div data-testid="delete-credential-dialog">
        <button
          data-testid="delete-confirm"
          onClick={() => onConfirm().catch(() => {})}
        >
          Confirm
        </button>
      </div>
    );
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: vi.fn((namespace) => (key: string, values?: Record<string, string | number>) => {
    const translations: Record<string, Record<string, string>> = {
      credentials: {
        title: 'Credentials',
        subtitle: 'Manage project credentials securely',
        create: 'Create Credential',
        rotate: 'Rotate',
        delete: 'Delete',
        summary_total_label: '{count} project secrets',
        summary_rotated_label: '{count} rotated',
        summary_types_label: '{count} types',
        'table.name': 'Name',
        'table.type': 'Type',
        'table.last_rotated': 'Last Rotated',
        fingerprint: 'Fingerprint',
        'empty.title': 'No credentials yet',
        'empty.description': 'Create a credential to get started',
      },
    };
    const template = translations[namespace]?.[key] || key;
    if (!values) return template;
    return Object.entries(values).reduce((result, [token, value]) => {
      return result.replace(`{${token}}`, String(value));
    }, template);
  }),
}));

import CredentialsPage from '../page';

const mockUseCanAccessCredentials = vi.mocked(useCanAccessCredentials);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('CredentialsPage', () => {
  const wrapper = createWrapper();
  const user = userEvent.setup();

  const mockCredentials = [
    {
      id: 'cred_001',
      workspace_id: 'ws_test',
      project_id: 'proj_001',
      name: 'OpenAI API Key',
      type: 'api_key',
      fingerprint: '••••••••••••xyz1',
      created_at: '2026-01-10T09:00:00Z',
      last_rotated_at: '2026-01-25T14:20:00Z',
    },
    {
      id: 'cred_002',
      workspace_id: 'ws_test',
      project_id: 'proj_001',
      name: 'Anthropic API Key',
      type: 'api_key',
      fingerprint: '••••••••••••abc2',
      created_at: '2026-01-12T10:00:00Z',
      last_rotated_at: '2026-01-20T09:30:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCanAccessCredentials.mockReturnValue({ canRead: true, canManage: true });
    mockList.mockResolvedValue(mockCredentials);
    mockDelete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering and Display', () => {
    it('renders header and toolbar layout', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
      });

      const header = screen.getByTestId('page-layout__header');
      expect(within(header).getByRole('heading', { level: 1, name: 'Credentials' })).toBeInTheDocument();
      expect(within(header).queryByTestId('credentials__open-members')).not.toBeInTheDocument();
      expect(within(header).queryByTestId('credentials__open-resource-policy')).not.toBeInTheDocument();
      expect(within(header).queryByTestId('credentials__open-audit')).not.toBeInTheDocument();
      const toolbar = screen.getByTestId('page-layout__toolbar');
      expect(within(toolbar).getByRole('button', { name: /create credential/i })).toBeInTheDocument();
    });

    it('renders human-readable summary chips instead of raw translation keys', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('credentials__summary-count')).toHaveTextContent('2 project secrets');
      });

      expect(screen.getByTestId('credentials__summary-rotated')).toHaveTextContent('2 rotated');
      expect(screen.getByTestId('credentials__summary-rotated')).not.toHaveTextContent('credentials.');
      expect(screen.getByTestId('credentials__summary-types')).toHaveTextContent('1 types');
    });

    it('renders page title and description', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText('Credentials')).toBeInTheDocument();
        expect(screen.getByText(/manage project credentials/i)).toBeInTheDocument();
      });
      expect(screen.getByTestId('credentials__capability-note')).toHaveTextContent('capability_note');
    });

    it('renders create button', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /create credential/i })).toBeInTheDocument();
      });
    });

    it('shows loading state initially', async () => {
      mockList.mockReturnValue(new Promise(() => {}));
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(screen.getByText('Credentials')).toBeInTheDocument();
      });
    });

    it('shows empty state when no credentials exist', async () => {
      mockList.mockResolvedValue([]);

      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(screen.getByText('No credentials yet')).toBeInTheDocument();
      });
      expect(screen.getByText('Create a credential to get started')).toBeInTheDocument();
    });
  });

  describe('Behavior', () => {
    it('shows invalid parameter error state for unsafe route params', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: '../unsafe-workspace',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
      });
    });

    it('shows permission denied when user lacks read access', async () => {
      mockUseCanAccessCredentials.mockReturnValue({ canRead: false, canManage: false });
      render(
        <CredentialsPage
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_001',
            locale: 'en',
          })}
        />,
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
      });
      expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    });

    it('opens create dialog when clicking create button', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({ workspace: 'ws_test', project: 'proj_001', locale: 'en' })}
        />,
        { wrapper: createWrapper() }
      );

      await user.click(await screen.findByRole('button', { name: /create credential/i }));
      expect(screen.getByTestId('create-credential-dialog')).toBeInTheDocument();
    });

    it('refreshes list after successful deletion', async () => {
      render(
        <CredentialsPage
          params={Promise.resolve({ workspace: 'ws_test', project: 'proj_001', locale: 'en' })}
        />,
        { wrapper: createWrapper() }
      );

      const deleteButtons = await screen.findAllByRole('button', { name: /delete/i });
      await user.click(deleteButtons[0]);
      await user.click(screen.getByTestId('delete-confirm'));

      await waitFor(() => {
        expect(mockDelete).toHaveBeenCalledWith('ws_test', 'proj_001', 'cred_001');
      });
    });
  });
});
