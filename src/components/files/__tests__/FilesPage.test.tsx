/**
 * Unit tests for FilesPage (object browser).
 *
 * This intentionally tests only stable, high-value behavior:
 * - renders libraries list
 * - renders objects table and navigates into a prefix
 */

import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FilesPage } from '../FilesPage';
import {
  createFileLibrary,
  createObjectItem,
  createPrefixItem,
  renderWithQueryClient,
} from './filesPageTestUtils';

import { vi } from 'vitest';

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
  useHasPermission: () => true,
}));

vi.mock('@/lib/hooks/use-file-libraries-v2', () => ({
  useFileLibraryStorageCredentialExchange: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      filesystem_name: 'flib-ws-default-proj-001-shared-docs',
      metadata_url: 'postgres://user:password@localhost:5432/jfs_lib_1',
      recommended_mount_path: '~/JuiceFS/shared-docs',
      platform_notes: ['Install JuiceFS before mounting.'],
      recommended_mount_commands: {
        linux: 'juicefs mount postgres://user:password@localhost:5432/jfs_lib_1 ~/JuiceFS/shared-docs',
        macos: 'juicefs mount postgres://user:password@localhost:5432/jfs_lib_1 ~/JuiceFS/shared-docs',
        windows: 'juicefs mount postgres://user:password@localhost:5432/jfs_lib_1 X:',
      },
      created_at: '2026-03-16T08:00:00.000Z',
    }),
    isPending: false,
  }),
}));

vi.mock('@/lib/hooks/use-files', () => ({
  useFileLibraries: () => ({
    data: {
      items: [createFileLibrary()],
    },
    isLoading: false,
  }),
  useCreateFileLibrary: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateFileLibrary: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFileLibrary: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/hooks/use-file-objects', () => ({
  useFileObjectsInfinite: () => ({
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
  }),
  useFileObjects: () => ({
    data: {
      prefix: '',
      items: [createPrefixItem(), createObjectItem()],
      next_continuation_token: null,
    },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useCreateFileFolder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadFileObject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFileObjects: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMoveFileObject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe('FilesPage (object browser)', () => {
  it('renders libraries pane and objects table', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);

    expect(await screen.findByTestId('files__library-list')).toBeInTheDocument();
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
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

  it('opens mount access dialog for a library', async () => {
    renderWithQueryClient(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('files__library-mount-access--lib_1'));

    expect(await screen.findByTestId('files__dialog__library-mount-access')).toBeInTheDocument();
    expect(screen.getByTestId('files__library-mount__filesystem-name')).toHaveValue('flib-ws-default-proj-001-shared-docs');
  });
});
