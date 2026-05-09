/**
 * Unit tests for FilesPage (object browser).
 *
 * This intentionally tests only stable, high-value behavior:
 * - renders libraries list
 * - renders objects table and navigates into a prefix
 */

import * as React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FileObjectsListItem, FileObjectsListResponse } from '@/lib/api/types';
import { APIError } from '@/lib/api/errors';

import { FilesPage } from '../FilesPage';
import {
  createFileLibrary,
  createObjectItem,
  createPrefixItem,
  renderWithQueryClient,
} from './filesPageTestUtils';

import { afterEach, vi } from 'vitest';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: mockToast,
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string>) => {
    const translations: Record<string, Record<string, string>> = {
      files: {
        title: 'Files',
        subtitle: 'Browse the shared project library, folders, and objects with a single file operations view.',
        project_library_label: 'Project library',
        upload: 'Upload',
        upload_files: 'Upload Files',
        search_placeholder: 'Search files...',
        open_chat: 'Open Chat',
        open_agent_tasks: 'Open Agent tasks',
        open_endpoints: 'Open Endpoints',
        'file_manager.root': 'Root',
        'file_manager.items': 'items',
        'file_manager.libraries': 'Libraries',
        'file_manager.no_libraries': 'No libraries yet',
        'file_manager.library_create': 'Create library',
        'file_manager.library_create_description': 'Create a shared file library for this project.',
        'file_manager.library_status_ready': 'Ready',
        'file_manager.library_status_failed': 'Failed',
        'file_manager.library_status_reason_failed': 'Library provisioning failed.',
        'file_manager.library_binding_unbound': 'Unbound',
        'file_manager.library_binding_bound': 'Bound',
        'file_manager.library_binding_bound_visible': `Bound to ${values?.title ?? 'task'} (${values?.status ?? 'unknown'})`,
        'file_manager.library_binding_bound_redacted': 'Bound to a task you cannot view',
        'file_manager.library_bound_home_banner': 'This library is an Agent task HOME. Files changes affect that task HOME.',
        'file_manager.library_bound_home_banner_visible': `This library is the HOME for ${values?.title ?? 'task'} (${values?.status ?? 'unknown'}). Files changes affect that task HOME.`,
        'file_manager.library_delete_bound_blocked': 'Delete the bound task before deleting this library.',
      },
      errors: {
        validation_error: 'Validation error',
        permission_denied_title: 'Permission denied',
        permission_denied_hint: 'Permission denied hint',
        badRequest: 'Bad request',
        'file_library_deleting.description': 'This library is being deleted. Refresh the library status before trying again.',
      },
      common: {},
    };
    return translations[namespace]?.[key] ?? key;
  },
}));

const {
  mockUseFileObjectsInfinite,
  mockUseFileObjects,
  mockUploadFileObjectMutateAsync,
  mockDeleteFileObjectsMutateAsync,
  mockFilesApiListObjects,
  mockDesktopMountAccessMutateAsync,
  mockStorageCredentialExchangeMutateAsync,
} = vi.hoisted(() => ({
  mockUseFileObjectsInfinite: vi.fn(),
  mockUseFileObjects: vi.fn(),
  mockUploadFileObjectMutateAsync: vi.fn(),
  mockDeleteFileObjectsMutateAsync: vi.fn(),
  mockFilesApiListObjects: vi.fn(),
  mockDesktopMountAccessMutateAsync: vi.fn(),
  mockStorageCredentialExchangeMutateAsync: vi.fn(),
}));

let mockLibraries = [createFileLibrary()];
const UPLOAD_SYNC_TEST_TIMEOUT_MS = 6_000;

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

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean; token: string | null }) => unknown) =>
    selector({ isAuthenticated: true, token: 'test-token' }),
  useAuthStoreHydration: () => true,
  selectIsAuthenticated: (state: { isAuthenticated: boolean }) => state.isAuthenticated,
  selectToken: (state: { token: string | null }) => state.token,
}));

vi.mock('@/lib/hooks/use-file-libraries-v2', () => ({
  useFileLibraryDesktopMountAccess: () => ({
    mutateAsync: mockDesktopMountAccessMutateAsync,
    isPending: false,
  }),
  useFileLibraryStorageCredentialExchange: () => ({
    mutateAsync: mockStorageCredentialExchangeMutateAsync,
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
  useUploadFileObject: () => ({ mutateAsync: mockUploadFileObjectMutateAsync, isPending: false }),
  useDeleteFileObjects: () => ({ mutateAsync: mockDeleteFileObjectsMutateAsync, isPending: false }),
  useMoveFileObject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/api/endpoints/files', () => ({
  FilesAPI: vi.fn().mockImplementation(function FilesAPIMock() {
    return {
      listObjects: mockFilesApiListObjects,
    };
  }),
}));

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createListingResult(
  items: FileObjectsListItem[] = [createPrefixItem(), createObjectItem()],
): FileObjectsListResponse {
  return {
    prefix: '',
    items,
    next_continuation_token: null,
  };
}

function createInfiniteListingResult(items = [createPrefixItem(), createObjectItem()]) {
  return {
    pages: [createListingResult(items)],
    pageParams: [undefined],
  };
}

function getLatestActiveFileObjectsCache(queryClient: ReturnType<typeof renderWithQueryClient>['queryClient']) {
  const activeCall = [...mockUseFileObjectsInfinite.mock.calls]
    .reverse()
    .find((call) => call[0] === 'ws_default' && call[1] === 'proj_001' && call[2] === 'lib_1');
  const activeParams = activeCall?.[3];
  return queryClient.getQueryData([
    'file-objects',
    'infinite',
    'ws_default',
    'proj_001',
    'lib_1',
    activeParams,
  ]);
}

function fileObjectsCacheContainsObject(data: unknown, key: string) {
  if (!data || typeof data !== 'object' || !('pages' in data) || !Array.isArray(data.pages)) {
    return false;
  }
  const pages: unknown[] = data.pages;
  return pages.some((page) => {
    if (!page || typeof page !== 'object' || !('items' in page) || !Array.isArray(page.items)) {
      return false;
    }
    const items: unknown[] = page.items;
    return items.some((item) =>
      item
        && typeof item === 'object'
        && 'kind' in item
        && item.kind === 'object'
        && 'key' in item
        && item.key === key,
    );
  });
}

function getFileObjectsCacheObjectKeys(data: unknown) {
  if (!data || typeof data !== 'object' || !('pages' in data) || !Array.isArray(data.pages)) {
    return [];
  }
  return data.pages.flatMap((page: unknown) => {
    if (!page || typeof page !== 'object' || !('items' in page) || !Array.isArray(page.items)) {
      return [];
    }
    return page.items.flatMap((item: unknown) => {
      if (
        item
        && typeof item === 'object'
        && 'kind' in item
        && item.kind === 'object'
        && 'key' in item
        && typeof item.key === 'string'
      ) {
        return [item.key];
      }
      return [];
    });
  });
}

describe('FilesPage (object browser)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    mockUseFileObjectsInfinite.mockReset();
    mockUseFileObjects.mockReset();
    mockUploadFileObjectMutateAsync.mockReset();
    mockDeleteFileObjectsMutateAsync.mockReset();
    mockFilesApiListObjects.mockReset();
    mockDesktopMountAccessMutateAsync.mockReset();
    mockStorageCredentialExchangeMutateAsync.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
    mockDesktopMountAccessMutateAsync.mockResolvedValue({
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
    });
    mockStorageCredentialExchangeMutateAsync.mockResolvedValue({
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
    });
    mockUploadFileObjectMutateAsync.mockResolvedValue({
      key: 'README.txt',
      name: 'README.txt',
    });
    mockDeleteFileObjectsMutateAsync.mockResolvedValue({
      results: [{ key: 'README.txt', status: 'deleted' }],
    });
    mockFilesApiListObjects.mockResolvedValue(createListingResult());
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
    expect(screen.getByTestId('files__workspace-surface')).toBeInTheDocument();
    expect(screen.getByTestId('files__workspace-surface').className).not.toContain('shadow-card');
    expect(screen.queryByTestId('project-workbench')).not.toBeInTheDocument();
    expect(screen.getByText('Libraries')).toBeInTheDocument();
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

    expect(screen.getByTestId('files__library-status--lib_failed')).toHaveTextContent('Failed');
    expect(screen.getByTestId('files__library-status-reason--lib_failed')).toHaveTextContent(
      'Library provisioning failed.',
    );
    expect(screen.getByTestId('files__library-desktop-access--lib_failed')).toBeDisabled();
    expect(screen.getByTestId('files__new-folder')).toBeDisabled();
    expect(screen.getByTestId('files__upload')).toBeDisabled();
    expect(screen.getByTestId('files__refresh')).toBeDisabled();
  });

  it('shows task HOME binding state without leaking redacted task metadata', async () => {
    mockLibraries = [
      createFileLibrary({
        id: 'lib_unbound',
        name: 'Reusable Workspace',
        task_home_binding_status: 'unbound',
        bound_task_visible: false,
      }),
      createFileLibrary({
        id: 'lib_bound_visible',
        name: 'Bound Workspace',
        task_home_binding_status: 'bound',
        bound_task_id: 'task_visible',
        bound_task_title: 'Visible Task',
        bound_task_status: 'archived',
        bound_task_visible: true,
      }),
      createFileLibrary({
        id: 'lib_bound_redacted',
        name: 'Private Bound Workspace',
        task_home_binding_status: 'bound',
        bound_task_title: 'Secret Task',
        bound_task_status: 'active',
        bound_task_visible: false,
      }),
    ];

    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);

    expect(await screen.findByTestId('files__library-binding--lib_unbound')).toHaveTextContent('Unbound');
    expect(screen.getByTestId('files__library-binding--lib_bound_visible')).toHaveTextContent('Bound');
    expect(screen.getByTestId('files__library-binding-detail--lib_bound_visible')).toHaveTextContent(
      'Bound to Visible Task (archived)',
    );
    expect(screen.getByTestId('files__library-binding--lib_bound_redacted')).toHaveTextContent('Bound');
    expect(screen.getByTestId('files__library-binding-detail--lib_bound_redacted')).toHaveTextContent(
      'Bound to a task you cannot view',
    );
    expect(screen.queryByText('Secret Task')).not.toBeInTheDocument();
  });

  it('disables library deletion up front while a task binding exists', async () => {
    mockLibraries = [
      createFileLibrary({
        id: 'lib_bound_visible',
        name: 'Bound Workspace',
        task_home_binding_status: 'bound',
        bound_task_id: 'task_visible',
        bound_task_title: 'Visible Task',
        bound_task_status: 'active',
        bound_task_visible: true,
      }),
    ];

    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);

    expect(await screen.findByTestId('files__library-delete-inline--lib_bound_visible')).toBeDisabled();
    expect(screen.getByTestId('files__library-binding-detail--lib_bound_visible')).toHaveTextContent(
      'Bound to Visible Task (active)',
    );
    expect(screen.getByTestId('files__library-delete-blocked--lib_bound_visible')).toHaveTextContent(
      'Delete the bound task before deleting this library.',
    );
  });

  it('shows a selected bound library banner without disabling browsing or editing actions', async () => {
    mockLibraries = [
      createFileLibrary({
        id: 'lib_bound_visible',
        name: 'Bound Workspace',
        task_home_binding_status: 'bound',
        bound_task_id: 'task_visible',
        bound_task_title: 'Visible Task',
        bound_task_status: 'active',
        bound_task_visible: true,
      }),
    ];

    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);

    expect(await screen.findByTestId('files__bound-home-banner')).toHaveTextContent(
      'This library is the HOME for Visible Task (active). Files changes affect that task HOME.',
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    expect(screen.getByTestId('files__new-folder')).toBeEnabled();
    expect(screen.getByTestId('files__upload')).toBeEnabled();
  });

  it('shows a canonical no-library surface instead of folder-empty actions when no library exists', async () => {
    mockLibraries = [];
    mockUseFileObjectsInfinite.mockReturnValue({
      data: {
        pages: [
          {
            prefix: '',
            items: [],
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

    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);

    expect(await screen.findByTestId('files__no-library-empty-state')).toBeInTheDocument();
    expect(screen.getByText('No libraries yet')).toBeInTheDocument();
    expect(screen.getByText('Create a shared file library for this project.')).toBeInTheDocument();
    expect(screen.getByTestId('files__empty-create-library')).toBeInTheDocument();
    expect(screen.queryByTestId('files__search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('files__new-folder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('files__upload')).not.toBeInTheDocument();
    expect(screen.queryByTestId('files__empty-new-folder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('files__empty-upload')).not.toBeInTheDocument();
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

  it('keeps object delete race conflicts inline in the confirm dialog', async () => {
    mockDeleteFileObjectsMutateAsync.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_DELETING',
      'file_library_deleting',
      undefined,
      409,
      { file_library_id: 'lib_1', file_library_status: 'deleting' },
    ));
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    const table = await screen.findByTestId('files__objects-table');
    const row = within(table).getAllByTestId('files__object-row').find((el) => el.textContent?.includes('README.txt'));
    expect(row).toBeDefined();
    await user.click(within(row as HTMLElement).getByRole('button', { name: /README\.txt/i }));
    await user.click(screen.getByTestId('files__delete'));
    const dialog = await screen.findByTestId('files__dialog__delete');
    await user.click(within(dialog).getByRole('button', { name: 'file_manager.delete' }));

    expect(await screen.findByTestId('files__delete__error')).toHaveTextContent(
      'This library is being deleted. Refresh the library status before trying again.',
    );
    expect(screen.getByTestId('files__dialog__delete')).toBeInTheDocument();
    expect(mockToast.error).not.toHaveBeenCalledWith(expect.stringContaining('file_library_deleting'));
  });

  it('shows dropzone overlay on drag enter', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const dropzone = await screen.findByTestId('files__dropzone');

    fireEvent.dragEnter(dropzone);
    expect(screen.getByTestId('files__dropzone-overlay')).toBeInTheDocument();

    fireEvent.dragLeave(dropzone);
    expect(screen.queryByTestId('files__dropzone-overlay')).not.toBeInTheDocument();
  });

  it('refreshes the active unfiltered upload target until the uploaded object is visible', async () => {
    const user = userEvent.setup();
    mockFilesApiListObjects
      .mockResolvedValueOnce(createListingResult())
      .mockResolvedValueOnce(createListingResult([
        createPrefixItem(),
        createObjectItem(),
        createObjectItem({ key: 'sync-note.txt', name: 'sync-note.txt' }),
      ]));
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult(),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: 'sync-note.txt', name: 'sync-note.txt' };
      },
    );

    const { container, queryClient } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    mockToast.success.mockImplementation(() => {
      expect(fileObjectsCacheContainsObject(
        getLatestActiveFileObjectsCache(queryClient),
        'sync-note.txt',
      )).toBe(true);
    });
    await screen.findByTestId('files__objects-table');
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    await user.upload(input as HTMLInputElement, new File(['hello'], 'sync-note.txt', { type: 'text/plain' }));

    await waitFor(() => expect(mockUploadFileObjectMutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockFilesApiListObjects).toHaveBeenCalledTimes(2));
    expect(mockFilesApiListObjects).toHaveBeenNthCalledWith(
      1,
      'ws_default',
      'proj_001',
      'lib_1',
      expect.objectContaining({ delimiter: '/', page_size: 200 }),
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(mockUploadFileObjectMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mockFilesApiListObjects.mock.invocationCallOrder[0],
    );

    await waitFor(() => expect(screen.queryByTestId('files__upload-progress')).not.toBeInTheDocument());
    expect(screen.getByText('sync-note.txt')).toBeInTheDocument();
    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success');
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('fails default-visible upload sync when canonical listing never returns the uploaded object even if upload response includes an item', async () => {
    vi.useFakeTimers();
    mockFilesApiListObjects.mockResolvedValue(createListingResult());
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return {
          kind: 'object',
          key: 'canonical-miss.txt',
          name: 'canonical-miss.txt',
          size_bytes: 12,
          content_type: 'text/plain',
          last_modified: '2026-04-02T10:00:00.000Z',
        };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult(),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container, queryClient } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'canonical-miss.txt', { type: 'text/plain' })] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFilesApiListObjects).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS);
    });

    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('upload_sync_missing'));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(fileObjectsCacheContainsObject(
      getLatestActiveFileObjectsCache(queryClient),
      'canonical-miss.txt',
    )).toBe(false);
  });

  it('reports upload_sync_missing only after canonical continuation pages miss the uploaded identity', async () => {
    vi.useFakeTimers();
    const firstCanonicalPage = createListingResult([
      createObjectItem({ key: 'README.txt', name: 'README.txt' }),
    ]);
    firstCanonicalPage.next_continuation_token = 'missing-page-2';
    const secondCanonicalPage = createListingResult([
      createObjectItem({ key: 'notes/other.txt', name: 'other.txt' }),
    ]);
    mockFilesApiListObjects.mockImplementation(async (
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      params?: { continuation_token?: string },
    ) => (params?.continuation_token === 'missing-page-2' ? secondCanonicalPage : firstCanonicalPage));
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return {
          kind: 'object',
          key: 'canonical-multi-page-miss.txt',
          name: 'canonical-multi-page-miss.txt',
          size_bytes: 12,
          content_type: 'text/plain',
          last_modified: '2026-04-02T10:00:00.000Z',
        };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult(),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container, queryClient } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'canonical-multi-page-miss.txt', { type: 'text/plain' })] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFilesApiListObjects).toHaveBeenCalledWith(
      'ws_default',
      'proj_001',
      'lib_1',
      expect.objectContaining({
        continuation_token: 'missing-page-2',
        delimiter: '/',
        page_size: 200,
      }),
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS);
    });

    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('upload_sync_missing'));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(fileObjectsCacheContainsObject(
      getLatestActiveFileObjectsCache(queryClient),
      'canonical-multi-page-miss.txt',
    )).toBe(false);
  });

  it('keeps canonical listing confirmation within 25 calls while advancing the continuation scan', async () => {
    vi.useFakeTimers();
    mockFilesApiListObjects.mockImplementation(async (
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      params?: { continuation_token?: string },
    ) => {
      const sequence = params?.continuation_token
        ? Number(params.continuation_token.replace('endless-page-', ''))
        : 1;
      const page = createListingResult([
        createObjectItem({ key: `unrelated-${sequence}.txt`, name: `unrelated-${sequence}.txt` }),
      ]);
      page.next_continuation_token = `endless-page-${sequence + 1}`;
      return page;
    });
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return {
          kind: 'object',
          key: 'canonical-budget-miss.txt',
          name: 'canonical-budget-miss.txt',
          size_bytes: 12,
          content_type: 'text/plain',
          last_modified: '2026-04-02T10:00:00.000Z',
        };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult(),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container } = renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'canonical-budget-miss.txt', { type: 'text/plain' })] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS);
    });

    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('upload_sync_missing'));
    expect(mockFilesApiListObjects).toHaveBeenCalledTimes(25);
    const firstPageCalls = mockFilesApiListObjects.mock.calls.filter((call) => {
      const params = call[3] as { continuation_token?: string } | undefined;
      return !params?.continuation_token;
    });
    expect(firstPageCalls).toHaveLength(1);
    expect(mockFilesApiListObjects).toHaveBeenNthCalledWith(
      25,
      'ws_default',
      'proj_001',
      'lib_1',
      expect.objectContaining({
        continuation_token: 'endless-page-25',
        delimiter: '/',
        page_size: 200,
      }),
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
  });

  it('retries page one after bounded canonical misses so eventual consistency can confirm the upload', async () => {
    vi.useFakeTimers();
    let firstPageScans = 0;
    mockFilesApiListObjects.mockImplementation(async (
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      params?: { continuation_token?: string },
    ) => {
      if (!params?.continuation_token) {
        firstPageScans += 1;
        if (firstPageScans >= 2) {
          return createListingResult([
            createObjectItem({ key: 'eventual-page-one.txt', name: 'eventual-page-one.txt' }),
          ]);
        }
        const page = createListingResult([
          createObjectItem({ key: 'large-miss-page-1.txt', name: 'large-miss-page-1.txt' }),
        ]);
        page.next_continuation_token = 'large-page-2';
        return page;
      }

      const pageNumber = Number(params.continuation_token.replace('large-page-', ''));
      const page = createListingResult([
        createObjectItem({ key: `large-miss-page-${pageNumber}.txt`, name: `large-miss-page-${pageNumber}.txt` }),
      ]);
      page.next_continuation_token = pageNumber < 3 ? `large-page-${pageNumber + 1}` : null;
      return page;
    });
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return {
          kind: 'object',
          key: 'eventual-page-one.txt',
          name: 'eventual-page-one.txt',
          size_bytes: 12,
          content_type: 'text/plain',
          last_modified: '2026-04-02T10:00:00.000Z',
        };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult(),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container, queryClient } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'eventual-page-one.txt', { type: 'text/plain' })] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(firstPageScans).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS);
    });

    expect(firstPageScans).toBeGreaterThanOrEqual(2);
    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success');
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(fileObjectsCacheContainsObject(
      getLatestActiveFileObjectsCache(queryClient),
      'eventual-page-one.txt',
    )).toBe(true);
  });

  it('confirms an uploaded object that appears during a later poll while canonical page budget remains', async () => {
    vi.useFakeTimers();
    mockFilesApiListObjects.mockImplementation(async (
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      params?: { continuation_token?: string },
    ) => {
      const callNumber = mockFilesApiListObjects.mock.calls.length;
      if (callNumber <= 2) {
        const page = createListingResult([
          createObjectItem({ key: `eventual-miss-${callNumber}.txt`, name: `eventual-miss-${callNumber}.txt` }),
        ]);
        page.next_continuation_token = callNumber === 1 ? 'eventual-page-2' : null;
        return page;
      }
      if (!params?.continuation_token) {
        const page = createListingResult([
          createObjectItem({ key: 'eventual-still-first-page.txt', name: 'eventual-still-first-page.txt' }),
        ]);
        page.next_continuation_token = 'eventual-page-2';
        return page;
      }
      return createListingResult([
        createObjectItem({ key: 'eventual-visible.txt', name: 'eventual-visible.txt' }),
      ]);
    });
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return {
          kind: 'object',
          key: 'eventual-visible.txt',
          name: 'eventual-visible.txt',
          size_bytes: 12,
          content_type: 'text/plain',
          last_modified: '2026-04-02T10:00:00.000Z',
        };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult(),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container, queryClient } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'eventual-visible.txt', { type: 'text/plain' })] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFilesApiListObjects).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
    });

    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success');
    expect(mockFilesApiListObjects).toHaveBeenCalledTimes(4);
    expect(fileObjectsCacheContainsObject(
      getLatestActiveFileObjectsCache(queryClient),
      'eventual-visible.txt',
    )).toBe(true);
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('does not confirm a wrong same-name canonical object when the uploaded stable identity differs', async () => {
    vi.useFakeTimers();
    mockFilesApiListObjects.mockResolvedValue(createListingResult([
      createPrefixItem(),
      createObjectItem(),
      createObjectItem({ key: 'archive/same-name.txt', name: 'same-name.txt' }),
    ]));
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return {
          kind: 'object',
          key: 'docs/same-name.txt',
          path: 'docs/same-name.txt',
          name: 'same-name.txt',
          size_bytes: 12,
          content_type: 'text/plain',
          last_modified: '2026-04-02T10:00:00.000Z',
        };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult(),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container, queryClient } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'same-name.txt', { type: 'text/plain' })] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFilesApiListObjects).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS);
    });

    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('upload_sync_missing'));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(fileObjectsCacheContainsObject(
      getLatestActiveFileObjectsCache(queryClient),
      'docs/same-name.txt',
    )).toBe(false);
  });

  it('fails default-visible upload sync when canonical listing rejects', async () => {
    const listingError = new Error('canonical listing 500');
    mockFilesApiListObjects.mockRejectedValue(listingError);
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return {
          kind: 'object',
          key: 'canonical-error.txt',
          name: 'canonical-error.txt',
          size_bytes: 12,
          content_type: 'text/plain',
          last_modified: '2026-04-02T10:00:00.000Z',
        };
      },
    );

    const { container } = renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'canonical-error.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => expect(mockFilesApiListObjects).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('canonical listing 500')));
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('aborts a slow canonical listObjects request at the upload sync deadline', async () => {
    vi.useFakeTimers();
    const listingDeferred = createDeferred<ReturnType<typeof createListingResult>>();
    let listingSignal: AbortSignal | undefined;
    mockFilesApiListObjects.mockImplementation((
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      _params: object,
      options?: { signal?: AbortSignal },
    ) => {
      listingSignal = options?.signal;
      return listingDeferred.promise;
    });
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return {
          kind: 'object',
          key: 'slow-visible.txt',
          name: 'slow-visible.txt',
          size_bytes: 12,
          content_type: 'text/plain',
          last_modified: '2026-04-02T10:00:00.000Z',
        };
      },
    );

    const { container } = renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'slow-visible.txt', { type: 'text/plain' })] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFilesApiListObjects).toHaveBeenCalledTimes(1);
    expect(listingSignal?.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS + 1);
      await Promise.resolve();
    });

    expect(listingSignal?.aborted).toBe(true);
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('upload_sync_missing'));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.queryByTestId('files__upload-progress')).not.toBeInTheDocument();

    await act(async () => {
      listingDeferred.resolve(createListingResult([
        createObjectItem({ key: 'slow-visible.txt', name: 'slow-visible.txt' }),
      ]));
      await Promise.resolve();
    });

    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('keeps active upload cache shaped like the canonical listing page instead of appending into the old first page', async () => {
    const canonicalPage = createListingResult([
      createObjectItem({ key: 'aaa-uploaded.txt', name: 'aaa-uploaded.txt' }),
      createObjectItem({ key: 'README.txt', name: 'README.txt' }),
    ]);
    canonicalPage.next_continuation_token = 'canonical-next';
    mockFilesApiListObjects.mockResolvedValue(canonicalPage);
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: 'aaa-uploaded.txt', name: 'aaa-uploaded.txt' };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult([
          createObjectItem({ key: 'README.txt', name: 'README.txt' }),
        ]),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: {
          pages: [
            {
              prefix: '',
              items: [createObjectItem({ key: 'README.txt', name: 'README.txt' })],
              next_continuation_token: 'old-next',
            },
          ],
          pageParams: ['old-page-param'],
        },
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container, queryClient } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'aaa-uploaded.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success'));

    const activeCache = getLatestActiveFileObjectsCache(queryClient);
    expect(activeCache).toEqual({
      pages: [canonicalPage],
      pageParams: [undefined],
    });
    expect(getFileObjectsCacheObjectKeys(activeCache)).toEqual(['aaa-uploaded.txt', 'README.txt']);
  });

  it('syncs default-visible upload from a canonical continuation page and preserves active cache shape', async () => {
    const firstCanonicalPage = createListingResult([
      createObjectItem({ key: 'README.txt', name: 'README.txt' }),
    ]);
    firstCanonicalPage.next_continuation_token = 'canonical-page-2';
    const secondCanonicalPage = createListingResult([
      createObjectItem({ key: 'bbb-uploaded.txt', name: 'bbb-uploaded.txt' }),
    ]);
    mockFilesApiListObjects.mockImplementation(async (
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      params?: { continuation_token?: string },
    ) => (params?.continuation_token === 'canonical-page-2' ? secondCanonicalPage : firstCanonicalPage));
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: 'bbb-uploaded.txt', name: 'bbb-uploaded.txt' };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult([
          createObjectItem({ key: 'README.txt', name: 'README.txt' }),
        ]),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult([
          createObjectItem({ key: 'README.txt', name: 'README.txt' }),
        ]),
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container, queryClient } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'bbb-uploaded.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success'));

    expect(mockFilesApiListObjects).toHaveBeenCalledTimes(2);
    const firstCallParams = mockFilesApiListObjects.mock.calls[0]?.[3];
    expect(firstCallParams).toEqual(expect.objectContaining({ delimiter: '/', page_size: 200 }));
    expect(firstCallParams).not.toHaveProperty('continuation_token');
    expect(mockFilesApiListObjects).toHaveBeenNthCalledWith(
      2,
      'ws_default',
      'proj_001',
      'lib_1',
      expect.objectContaining({
        continuation_token: 'canonical-page-2',
        delimiter: '/',
        page_size: 200,
      }),
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );

    const activeCache = getLatestActiveFileObjectsCache(queryClient);
    expect(activeCache).toEqual({
      pages: [firstCanonicalPage, secondCanonicalPage],
      pageParams: [undefined, 'canonical-page-2'],
    });
    expect(getFileObjectsCacheObjectKeys(activeCache)).toEqual(['README.txt', 'bbb-uploaded.txt']);
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('confirms a default-visible upload from canonical page 6 without restarting at page 1', async () => {
    vi.useFakeTimers();
    const uploadedKey = 'canonical-page-6-upload.txt';
    mockFilesApiListObjects.mockImplementation(async (
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      params?: { continuation_token?: string },
    ) => {
      const pageNumber = params?.continuation_token
        ? Number(params.continuation_token.replace('canonical-page-', ''))
        : 1;
      const page = createListingResult([
        createObjectItem({
          key: pageNumber === 6 ? uploadedKey : `canonical-page-${pageNumber}-other.txt`,
          name: pageNumber === 6 ? uploadedKey : `canonical-page-${pageNumber}-other.txt`,
        }),
      ]);
      page.next_continuation_token = pageNumber < 6 ? `canonical-page-${pageNumber + 1}` : null;
      return page;
    });
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: uploadedKey, name: uploadedKey };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult(),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult([
          createObjectItem({ key: 'canonical-page-1-other.txt', name: 'canonical-page-1-other.txt' }),
        ]),
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container, queryClient } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], uploadedKey, { type: 'text/plain' })] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS);
    });

    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success');
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockFilesApiListObjects).toHaveBeenCalledTimes(6);
    expect(mockFilesApiListObjects).toHaveBeenNthCalledWith(
      6,
      'ws_default',
      'proj_001',
      'lib_1',
      expect.objectContaining({
        continuation_token: 'canonical-page-6',
        delimiter: '/',
        page_size: 200,
      }),
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(fileObjectsCacheContainsObject(
      getLatestActiveFileObjectsCache(queryClient),
      uploadedKey,
    )).toBe(true);
  });

  it('confirms a default-visible upload from canonical page 25 within the scan budget', async () => {
    vi.useFakeTimers();
    const uploadedKey = 'canonical-page-25-upload.txt';
    mockFilesApiListObjects.mockImplementation(async (
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      params?: { continuation_token?: string },
    ) => {
      const pageNumber = params?.continuation_token
        ? Number(params.continuation_token.replace('canonical-page-', ''))
        : 1;
      const page = createListingResult([
        createObjectItem({
          key: pageNumber === 25 ? uploadedKey : `canonical-page-${pageNumber}-other.txt`,
          name: pageNumber === 25 ? uploadedKey : `canonical-page-${pageNumber}-other.txt`,
        }),
      ]);
      page.next_continuation_token = pageNumber < 25 ? `canonical-page-${pageNumber + 1}` : null;
      return page;
    });
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: uploadedKey, name: uploadedKey };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: async () => createListingResult(),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult([
          createObjectItem({ key: 'canonical-page-1-other.txt', name: 'canonical-page-1-other.txt' }),
        ]),
        enabled: false,
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container, queryClient } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], uploadedKey, { type: 'text/plain' })] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS);
    });

    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success');
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockFilesApiListObjects).toHaveBeenCalledTimes(25);
    expect(mockFilesApiListObjects).toHaveBeenNthCalledWith(
      25,
      'ws_default',
      'proj_001',
      'lib_1',
      expect.objectContaining({
        continuation_token: 'canonical-page-25',
        delimiter: '/',
        page_size: 200,
      }),
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(fileObjectsCacheContainsObject(
      getLatestActiveFileObjectsCache(queryClient),
      uploadedKey,
    )).toBe(true);
  });

  it('times out upload sync when the active listing refresh never settles', async () => {
    const activeQueryFn = vi.fn().mockResolvedValue(createListingResult());
    mockFilesApiListObjects.mockResolvedValue(createListingResult([
      createObjectItem({ key: 'refresh-hang-upload.txt', name: 'refresh-hang-upload.txt' }),
    ]));
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: 'refresh-hang-upload.txt', name: 'refresh-hang-upload.txt' };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: activeQueryFn,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container } = renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    await waitFor(() => expect(activeQueryFn).toHaveBeenCalled());
    const callsBeforeUpload = activeQueryFn.mock.calls.length;
    activeQueryFn.mockImplementationOnce(() => new Promise(() => undefined));
    vi.useFakeTimers();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'refresh-hang-upload.txt', { type: 'text/plain' })] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(activeQueryFn).toHaveBeenCalledTimes(callsBeforeUpload + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS + 1);
      await Promise.resolve();
    });

    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('upload_sync_missing'));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.queryByTestId('files__upload-progress')).not.toBeInTheDocument();
  });

  it('fails visible upload sync when the active listing refresh rejects', async () => {
    const activeRefreshError = new Error('active refresh failed');
    const activeQueryFn = vi.fn().mockResolvedValue(createListingResult());
    mockFilesApiListObjects.mockResolvedValue(createListingResult([
      createPrefixItem(),
      createObjectItem(),
      createObjectItem({ key: 'active-refresh.txt', name: 'active-refresh.txt' }),
    ]));
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: 'active-refresh.txt', name: 'active-refresh.txt' };
      },
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: activeQueryFn,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });

    const { container } = renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    await waitFor(() => expect(activeQueryFn).toHaveBeenCalled());
    const callsBeforeUpload = activeQueryFn.mock.calls.length;
    activeQueryFn.mockRejectedValueOnce(activeRefreshError);
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'active-refresh.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => expect(activeQueryFn).toHaveBeenCalledTimes(callsBeforeUpload + 1));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('active refresh failed')));
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('keeps inactive target polling from reusing a fresh cached miss under production staleTime', async () => {
    const observerRefetch = vi.fn();
    mockFilesApiListObjects
      .mockResolvedValueOnce(createListingResult())
      .mockResolvedValueOnce(createListingResult([
        createPrefixItem(),
        createObjectItem(),
        createObjectItem({ key: 'stale-visible.txt', name: 'stale-visible.txt' }),
      ]));
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: 'stale-visible.txt', name: 'stale-visible.txt' };
      },
    );
    mockUseFileObjectsInfinite.mockReturnValue({
      data: createInfiniteListingResult(),
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: observerRefetch,
    });

    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />, {
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });
    const input = document.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'stale-visible.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => expect(mockFilesApiListObjects).toHaveBeenCalledTimes(2));
    expect(mockFilesApiListObjects).toHaveBeenNthCalledWith(
      1,
      'ws_default',
      'proj_001',
      'lib_1',
      expect.objectContaining({ delimiter: '/', page_size: 200 }),
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(mockFilesApiListObjects).toHaveBeenNthCalledWith(
      2,
      'ws_default',
      'proj_001',
      'lib_1',
      expect.objectContaining({ delimiter: '/', page_size: 200 }),
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    await waitFor(() => expect(screen.queryByTestId('files__upload-progress')).not.toBeInTheDocument());
    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success');
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(observerRefetch).not.toHaveBeenCalled();
  });

  it('uses the original plain upload target after a view change before the upload body resolves', async () => {
    const user = userEvent.setup();
    mockLibraries = [
      createFileLibrary({ id: 'lib_1', name: 'Library A' }),
      createFileLibrary({ id: 'lib_b', name: 'Library B', filesystem_name: 'flib-ws-default-proj-001-library-b' }),
    ];
    const uploadDeferred = createDeferred<{ key: string; name: string }>();
    const observerRefetch = vi.fn().mockRejectedValue(new Error('wrong observer refetch'));
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return uploadDeferred.promise;
      },
    );
    mockFilesApiListObjects.mockResolvedValue(createListingResult());
    mockUseFileObjectsInfinite.mockReturnValue({
      data: createInfiniteListingResult(),
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: observerRefetch,
    });

    const { container } = renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    await screen.findByTestId('files__objects-table');
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    await user.upload(input as HTMLInputElement, new File(['hello'], 'original-target.txt', { type: 'text/plain' }));
    await waitFor(() => expect(mockUploadFileObjectMutateAsync).toHaveBeenCalledTimes(1));

    await user.click(screen.getByTestId('files__library-item--lib_b'));

    await act(async () => {
      uploadDeferred.resolve({ key: 'original-target.txt', name: 'original-target.txt' });
    });

    await waitFor(
      () => expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success'),
      { timeout: 1_500 },
    );
    expect(mockFilesApiListObjects).toHaveBeenCalledTimes(1);
    expect(mockFilesApiListObjects).toHaveBeenCalledWith(
      'ws_default',
      'proj_001',
      'lib_1',
      expect.objectContaining({ delimiter: '/', page_size: 200 }),
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    await waitFor(() => expect(screen.queryByTestId('files__upload-progress')).not.toBeInTheDocument());
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(observerRefetch).not.toHaveBeenCalled();
  });

  it('does not fail upload sync when active search hides the uploaded file', async () => {
    const observerRefetch = vi.fn().mockResolvedValue({
      status: 'success',
      data: createInfiniteListingResult(),
    });
    mockUseFileObjectsInfinite.mockReturnValue({
      data: createInfiniteListingResult(),
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: observerRefetch,
    });
    mockFilesApiListObjects.mockResolvedValue(createListingResult());
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: 'hidden-by-search.txt', name: 'hidden-by-search.txt' };
      },
    );

    const { container } = renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(screen.getByTestId('files__search'), {
      target: { value: 'does-not-match-upload' },
    });
    await waitFor(() => {
      expect(mockUseFileObjectsInfinite).toHaveBeenLastCalledWith(
        'ws_default',
        'proj_001',
        'lib_1',
        expect.objectContaining({ search: 'does-not-match-upload' }),
        expect.any(Object),
      );
    });

    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(['hello'], 'hidden-by-search.txt', { type: 'text/plain' })],
      },
    });

    await waitFor(
      () => expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success'),
      { timeout: 1_500 },
    );
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(observerRefetch).not.toHaveBeenCalled();
  });

  it('does not fail upload sync when active search hides the uploaded file and best-effort refresh hits the deadline', async () => {
    let shouldHangActiveRefresh = false;
    const activeQueryFn = vi.fn(() =>
      shouldHangActiveRefresh
        ? new Promise(() => undefined)
        : Promise.resolve(createListingResult()),
    );
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: activeQueryFn,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });
    mockFilesApiListObjects.mockResolvedValue(createListingResult());
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: 'hidden-by-search-refresh-timeout.txt', name: 'hidden-by-search-refresh-timeout.txt' };
      },
    );

    const { container } = renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    await waitFor(() => expect(activeQueryFn).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('files__search'), {
      target: { value: 'does-not-match-upload' },
    });
    await waitFor(() => {
      expect(mockUseFileObjectsInfinite).toHaveBeenLastCalledWith(
        'ws_default',
        'proj_001',
        'lib_1',
        expect.objectContaining({ search: 'does-not-match-upload' }),
        expect.any(Object),
      );
    });
    await waitFor(() => expect(activeQueryFn.mock.calls.length).toBeGreaterThanOrEqual(2));

    const callsBeforeUpload = activeQueryFn.mock.calls.length;
    shouldHangActiveRefresh = true;
    vi.useFakeTimers();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(['hello'], 'hidden-by-search-refresh-timeout.txt', { type: 'text/plain' })],
      },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(activeQueryFn).toHaveBeenCalledTimes(callsBeforeUpload + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS + 1);
      await Promise.resolve();
    });

    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success');
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalledWith(expect.stringContaining('upload_sync_missing'));
    expect(screen.queryByTestId('files__upload-progress')).not.toBeInTheDocument();
    expect(mockFilesApiListObjects).not.toHaveBeenCalled();
  });

  it('does not fail upload sync when active sort can keep the uploaded file outside the visible first page', async () => {
    const user = userEvent.setup();
    const observerRefetch = vi.fn().mockResolvedValue({
      status: 'success',
      data: createInfiniteListingResult(),
    });
    mockUseFileObjectsInfinite.mockReturnValue({
      data: createInfiniteListingResult(),
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: observerRefetch,
    });
    mockFilesApiListObjects.mockResolvedValue(createListingResult());
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: 'hidden-by-sort.txt', name: 'hidden-by-sort.txt' };
      },
    );

    const { container } = renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    await user.click(screen.getByTestId('files__sort-header--size_bytes'));
    await waitFor(() => {
      expect(mockUseFileObjectsInfinite).toHaveBeenLastCalledWith(
        'ws_default',
        'proj_001',
        'lib_1',
        expect.objectContaining({ sort_by: 'size_bytes', sort_order: 'asc' }),
        expect.any(Object),
      );
    });

    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(['hello'], 'hidden-by-sort.txt', { type: 'text/plain' })],
      },
    });

    await waitFor(
      () => expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success'),
      { timeout: 1_500 },
    );
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(observerRefetch).not.toHaveBeenCalled();
    expect(mockFilesApiListObjects).toHaveBeenCalledTimes(1);
  });

  it('does not fail upload sync when active sort hides the uploaded file and best-effort listing hits the deadline', async () => {
    const user = userEvent.setup();
    const activeQueryFn = vi.fn().mockResolvedValue(createListingResult());
    let listingSignal: AbortSignal | undefined;
    mockUseFileObjectsInfinite.mockImplementation((workspaceId, projectId, libraryId, params) => {
      const query = useInfiniteQuery({
        queryKey: ['file-objects', 'infinite', workspaceId, projectId, libraryId, params],
        queryFn: activeQueryFn,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
        initialData: createInfiniteListingResult(),
      });
      return {
        ...query,
        isLoading: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage: vi.fn(),
        refetch: vi.fn(),
      };
    });
    mockFilesApiListObjects.mockImplementation((
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      _params: object,
      options?: { signal?: AbortSignal },
    ) => {
      listingSignal = options?.signal;
      return new Promise(() => undefined);
    });
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return { key: 'hidden-by-sort-listing-timeout.txt', name: 'hidden-by-sort-listing-timeout.txt' };
      },
    );

    const { container } = renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    await user.click(screen.getByTestId('files__sort-header--size_bytes'));
    await waitFor(() => {
      expect(mockUseFileObjectsInfinite).toHaveBeenLastCalledWith(
        'ws_default',
        'proj_001',
        'lib_1',
        expect.objectContaining({ sort_by: 'size_bytes', sort_order: 'asc' }),
        expect.any(Object),
      );
    });

    vi.useFakeTimers();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(input as HTMLInputElement, {
      target: {
        files: [new File(['hello'], 'hidden-by-sort-listing-timeout.txt', { type: 'text/plain' })],
      },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFilesApiListObjects).toHaveBeenCalledTimes(1);
    expect(listingSignal?.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPLOAD_SYNC_TEST_TIMEOUT_MS + 1);
      await Promise.resolve();
    });

    expect(listingSignal?.aborted).toBe(true);
    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success');
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalledWith(expect.stringContaining('upload_sync_missing'));
    expect(screen.queryByTestId('files__upload-progress')).not.toBeInTheDocument();
  });

  it('aborts the in-flight canonical listing request on unmount and does not show success', async () => {
    const listingDeferred = createDeferred<ReturnType<typeof createListingResult>>();
    let listingSignal: AbortSignal | undefined;
    mockFilesApiListObjects.mockImplementation((
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      _params: object,
      options?: { signal?: AbortSignal },
    ) => {
      listingSignal = options?.signal;
      return listingDeferred.promise;
    });
    mockUploadFileObjectMutateAsync.mockImplementation(
      async (input: { onProgress?: (progress: number) => void }) => {
        input.onProgress?.(100);
        return {
          kind: 'object',
          key: 'abort-visible.txt',
          name: 'abort-visible.txt',
          size_bytes: 12,
          content_type: 'text/plain',
          last_modified: '2026-04-02T10:00:00.000Z',
        };
      },
    );

    const { container, unmount } = renderWithQueryClient(
      <FilesPage workspaceId="ws_default" projectId="proj_001" />,
    );
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['hello'], 'abort-visible.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => expect(mockFilesApiListObjects).toHaveBeenCalledTimes(1));
    unmount();
    expect(listingSignal?.aborted).toBe(true);

    await act(async () => {
      listingDeferred.resolve(createListingResult([
        createPrefixItem(),
        createObjectItem(),
        createObjectItem({ key: 'abort-visible.txt', name: 'abort-visible.txt' }),
      ]));
      await Promise.resolve();
    });

    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
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

  it('keeps typed desktop mount conflicts inline in the desktop access dialog', async () => {
    mockDesktopMountAccessMutateAsync.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_DELETING',
      'file_library_deleting',
      undefined,
      409,
      { file_library_id: 'lib_1', file_library_status: 'deleting' },
    ));
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('files__library-desktop-access--lib_1'));

    const dialog = await screen.findByTestId('files__dialog__desktop-mount-access');
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByTestId('files__desktop-mount__error')).toHaveTextContent(
      'This library is being deleted. Refresh the library status before trying again.',
    );
    expect(mockToast.error).not.toHaveBeenCalled();
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

  it('keeps typed manual mount credential conflicts inline in the debug panel', async () => {
    mockStorageCredentialExchangeMutateAsync.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_DELETING',
      'file_library_deleting',
      undefined,
      409,
      { file_library_id: 'lib_1', file_library_status: 'deleting' },
    ));
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('files__library-desktop-access--lib_1'));
    await user.click(await screen.findByTestId('files__desktop-setup__debug-toggle'));

    expect(await screen.findByTestId('files__desktop-setup__debug-panel')).toBeInTheDocument();
    expect(await screen.findByTestId('files__library-mount__error')).toHaveTextContent(
      'This library is being deleted. Refresh the library status before trying again.',
    );
    expect(mockToast.error).not.toHaveBeenCalled();
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

    expect(mockUseFileObjectsInfinite).toHaveBeenLastCalledWith(
      'ws_default',
      'proj_001',
      'lib_1',
      expect.any(Object),
      {
        enabled: true,
        refetchInterval: 5_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
      },
    );
  });
});
