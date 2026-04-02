/**
 * Unit tests for FilesPage (object browser).
 *
 * This intentionally tests only stable, high-value behavior:
 * - renders libraries list
 * - renders objects table and navigates into a prefix
 */

import * as React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FilesPage } from '../FilesPage';
import {
  createFileLibrary,
  createObjectItem,
  createPrefixItem,
  renderWithQueryClient,
} from './filesPageTestUtils';

import { vi } from 'vitest';

const {
  mockUseFileObjectsInfinite,
  mockUseFileObjects,
} = vi.hoisted(() => ({
  mockUseFileObjectsInfinite: vi.fn(),
  mockUseFileObjects: vi.fn(),
}));

let mockLibraries = [createFileLibrary()];

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, components }: {
    data: Array<unknown>;
    itemContent: (index: number, item: unknown) => React.ReactNode;
    components?: { Footer?: React.ComponentType };
  }) => (
    <div data-testid="files__virtuoso">
      {data.map((item, index) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
      {components?.Footer ? <components.Footer /> : null}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useFilesPageCapabilities: () => ({ canRead: true, canManage: true, canExchangeCredentials: true }),
}));

vi.mock('@/lib/hooks/use-file-libraries-v2', () => ({
  useFileLibraryDesktopMountAccess: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      desktop_mount_access: {
        filesystem_name: 'flib-ws-default-proj-001-shared-docs',
        metadata_url: 'postgres://user:password@files.example.com:5432/jfs_lib_1',
        storage_bucket_url: 'https://files.example.com:19000/jfs-lib-1',
        deployment_base_url: 'https://mbos.imotion.ai:3001',
        default_mount_roots: {
          linux: '~/AgentSmith',
          macos: '~/AgentSmith',
          windows: '%USERPROFILE%\\AgentSmith',
        },
        windows_requires_drive_letter: true,
        created_at: '2026-03-16T08:00:00.000Z',
      },
    }),
    isPending: false,
  }),
  useFileLibraryStorageCredentialExchange: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      client_mount_access: {
        filesystem_name: 'flib-ws-default-proj-001-shared-docs',
        metadata_url: 'postgres://user:password@files.example.com:5432/jfs_lib_1',
        storage_bucket_url: 'https://files.example.com:19000/jfs-lib-1',
        recommended_mount_path: '~/JuiceFS/shared-docs',
        platform_notes: ['Install JuiceFS before mounting.'],
        recommended_mount_commands: {
          linux: 'juicefs mount postgres://user:password@files.example.com:5432/jfs_lib_1 ~/JuiceFS/shared-docs --bucket https://files.example.com:19000/jfs-lib-1',
          macos: 'juicefs mount postgres://user:password@files.example.com:5432/jfs_lib_1 ~/JuiceFS/shared-docs --bucket https://files.example.com:19000/jfs-lib-1',
          windows: 'juicefs mount postgres://user:password@files.example.com:5432/jfs_lib_1 X: --bucket https://files.example.com:19000/jfs-lib-1',
        },
        created_at: '2026-03-16T08:00:00.000Z',
      },
    }),
    isPending: false,
  }),
}));

vi.mock('@/lib/hooks/use-files', () => ({
  useFileLibraries: () => ({
    data: {
      items: mockLibraries,
    },
    isLoading: false,
  }),
  useCreateFileLibrary: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateFileLibrary: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFileLibrary: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/hooks/use-file-objects', () => ({
  useFileObjectsInfinite: (...args: unknown[]) => mockUseFileObjectsInfinite(...args),
  useFileObjects: (...args: unknown[]) => mockUseFileObjects(...args),
  useCreateFileFolder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadFileObject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFileObjects: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMoveFileObject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe('FilesPage (object browser)', () => {
  beforeEach(() => {
    mockUseFileObjectsInfinite.mockReset();
    mockUseFileObjects.mockReset();
    mockLibraries = [createFileLibrary()];
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    mockUseFileObjectsInfinite.mockReturnValue({
      data: {
        pages: [
          {
            prefix: '',
            items: [createPrefixItem(), createObjectItem()],
            next_continuation_token: null,
          },
        ],
      },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    });

    mockUseFileObjects.mockReturnValue({
      data: {
        prefix: '',
        items: [createPrefixItem(), createObjectItem()],
        next_continuation_token: null,
      },
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  it('renders libraries pane and objects table', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);

    expect(await screen.findByTestId('files__library-list')).toBeInTheDocument();
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
  });

  it('selects the first library by default and only shows active-library actions', async () => {
    mockLibraries = [
      createFileLibrary({ id: 'lib_a', name: 'Library A' }),
      createFileLibrary({ id: 'lib_b', name: 'Library B', filesystem_name: 'flib-ws-default-proj-001-library-b' }),
    ];

    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    expect(await screen.findByTestId('files__library-desktop-access--lib_a')).toBeInTheDocument();
    expect(screen.queryByTestId('files__library-desktop-access--lib_b')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('files__library-item--lib_b'));

    await waitFor(() => {
      expect(screen.getByTestId('files__library-desktop-access--lib_b')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('files__library-desktop-access--lib_a')).not.toBeInTheDocument();
  });

  it('shows failed library status and disables mount actions for non-ready libraries', async () => {
    mockLibraries = [
      createFileLibrary({ id: 'lib_ready', name: 'Ready Library', status: 'ready' }),
      createFileLibrary({ id: 'lib_failed', name: 'Failed Library', status: 'failed' }),
    ];

    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('files__library-item--lib_failed'));

    expect(screen.getByTestId('files__library-status--lib_failed')).toHaveTextContent('file_manager.library_status_failed');
    expect(screen.getByTestId('files__library-status-reason--lib_failed')).toHaveTextContent(
      'file_manager.library_status_reason_failed',
    );
    expect(screen.getByTestId('files__library-desktop-access--lib_failed')).toBeDisabled();
  });

  it('shows a governance empty state instead of normal loading for degraded libraries', async () => {
    mockLibraries = [
      createFileLibrary({ id: 'lib_degraded', name: 'Degraded Library', status: 'degraded' }),
    ];

    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('files__library-item--lib_degraded'));

    expect(await screen.findByTestId('files__library-unavailable-empty-state')).toBeInTheDocument();
    expect(screen.getByText('file_manager.library_unavailable_title')).toBeInTheDocument();
    expect(screen.getByText('file_manager.library_unavailable_description')).toBeInTheDocument();
    expect(screen.queryByText('file_manager.loading')).not.toBeInTheDocument();
  });

  it('shows a recovery-focused delete warning for failed libraries', async () => {
    mockLibraries = [
      createFileLibrary({ id: 'lib_failed', name: 'Failed Library', status: 'failed' }),
    ];

    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('files__library-item--lib_failed'));
    await user.click(screen.getByTestId('files__library-delete-inline--lib_failed'));

    expect(await screen.findByTestId('files__dialog__library-delete')).toBeInTheDocument();
    expect(screen.getByText('file_manager.library_delete_failed_recovery_description')).toBeInTheDocument();
    expect(screen.getByTestId('files__library-delete__warning')).toHaveTextContent(
      'file_manager.library_delete_failed_recovery_warning',
    );
  });

  it('navigates into a folder prefix row on double click', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);

    const user = userEvent.setup();
    const table = await screen.findByTestId('files__objects-table');
    const rows = within(table).getAllByTestId('files__object-row');
    expect(rows.length).toBeGreaterThan(0);

    // Double-click the first row's name button (folder rows open on double click).
    const firstRow = rows[0];
    const nameButton = within(firstRow).getByRole('button');
    await user.dblClick(nameButton);

    // Breadcrumb should still render, and the table should remain present.
    expect(screen.getByTestId('files__breadcrumb-root')).toBeInTheDocument();
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
  });

  it('shows shortcut hint in single-select and summary in multi-select', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    const table = await screen.findByTestId('files__objects-table');
    const row = within(table).getAllByTestId('files__object-row').find((el) => el.textContent?.includes('README.txt'));
    expect(row).toBeDefined();
    await user.keyboard('{Control>}');
    await user.click(within(row as HTMLElement).getByRole('button', { name: /README\.txt/i }));
    await user.keyboard('{/Control}');

    expect(screen.getByTestId('files__selection-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('files__selection-shortcuts')).not.toBeInTheDocument();
    expect(screen.getByTestId('files__clear-selection')).toBeInTheDocument();
    await user.click(screen.getByTestId('files__clear-selection'));
    expect(screen.getByTestId('files__selection-summary')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('files__selection-shortcuts')).toBeInTheDocument();
  });

  it('shows dropzone overlay on drag enter', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const dropzone = await screen.findByTestId('files__dropzone');

    fireEvent.dragEnter(dropzone);
    expect(screen.getByTestId('files__dropzone-overlay')).toBeInTheDocument();

    fireEvent.dragLeave(dropzone);
    expect(screen.queryByTestId('files__dropzone-overlay')).not.toBeInTheDocument();
  });

  it('opens desktop access dialog for a library', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('files__library-desktop-access--lib_1'));

    expect(await screen.findByTestId('files__dialog__desktop-mount-access')).toBeInTheDocument();
    expect(screen.getByTestId('files__desktop-mount__deployment-url')).toHaveValue('https://mbos.imotion.ai:3001');
    expect(screen.getByText('file_manager.desktop_app_name')).toBeInTheDocument();
    expect(screen.getByTestId('files__desktop-setup__platform-macos')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('files__desktop-setup__download')).toBeInTheDocument();
    expect(screen.queryByTestId('files__library-mount__filesystem-name')).not.toBeInTheDocument();
  });

  it('keeps manual mount details inside the desktop dialog debug section', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    expect(screen.queryByTestId('files__library-manual-mount-access--lib_1')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('files__library-desktop-access--lib_1'));
    await user.click(await screen.findByTestId('files__desktop-setup__debug-toggle'));

    expect(await screen.findByTestId('files__desktop-setup__debug-panel')).toBeInTheDocument();
    expect(screen.getByTestId('files__library-mount__filesystem-name')).toHaveValue('flib-ws-default-proj-001-shared-docs');
    expect(screen.getByTestId('files__library-mount__tab-macos')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('files__library-mount__command-macos')).toHaveValue(
      'juicefs mount postgres://user:password@files.example.com:5432/jfs_lib_1 ~/JuiceFS/shared-docs --bucket https://files.example.com:19000/jfs-lib-1',
    );
  });

  it('switches mount command tabs and shows the active platform command', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('files__library-desktop-access--lib_1'));
    await user.click(await screen.findByTestId('files__desktop-setup__debug-toggle'));
    await user.click(await screen.findByTestId('files__library-mount__tab-windows'));
    await waitFor(() =>
      expect(screen.getByTestId('files__library-mount__tab-windows')).toHaveAttribute('data-state', 'active'),
    );
    expect(screen.getByTestId('files__library-mount__copy-command')).toBeInTheDocument();
    expect(screen.getByTestId('files__library-mount__command-windows')).toHaveValue(
      'juicefs mount postgres://user:password@files.example.com:5432/jfs_lib_1 X: --bucket https://files.example.com:19000/jfs-lib-1',
    );
  });

  it('configures auto refresh for the active file library listing', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);

    await screen.findByTestId('files__objects-table');

    expect(mockUseFileObjectsInfinite).toHaveBeenCalledWith(
      'ws_default',
      'proj_001',
      'lib_1',
      expect.any(Object),
      {
        refetchInterval: 5_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
      },
    );
  });
});
