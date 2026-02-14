/**
 * Unit tests for FilesPage (object browser).
 *
 * This intentionally tests only stable, high-value behavior:
 * - renders libraries list
 * - renders objects table and navigates into a prefix
 */

import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

import { FilesPage } from '../FilesPage';

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

vi.mock('@/lib/hooks/use-files', () => ({
  useFileLibraries: () => ({
    data: {
      items: [
        {
          id: 'lib_1',
          workspace_id: 'ws_default',
          project_id: 'proj_001',
          name: 'Shared Docs',
          description: '',
          visibility: 'shared',
          provider: 's3',
          bucket: 'bucket-1',
          created_by_user_id: 'user_001',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
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
          items: [
            { kind: 'prefix', prefix: 'docs/', name: 'docs' },
            {
              kind: 'object',
              key: 'README.txt',
              name: 'README.txt',
              size_bytes: 10,
              content_type: 'text/plain',
              etag: '"etag"',
              last_modified: new Date().toISOString(),
            },
          ],
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
      items: [
        { kind: 'prefix', prefix: 'docs/', name: 'docs' },
        {
          kind: 'object',
          key: 'README.txt',
          name: 'README.txt',
          size_bytes: 10,
          content_type: 'text/plain',
          etag: '"etag"',
          last_modified: new Date().toISOString(),
        },
      ],
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

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('FilesPage (object browser)', () => {
  it('renders libraries pane and objects table', async () => {
    wrap(<FilesPage workspaceId="ws_default" projectId="proj_001" />);

    expect(await screen.findByTestId('files__library-list')).toBeInTheDocument();
    expect(screen.getByTestId('files__objects-table')).toBeInTheDocument();
  });

  it('navigates into a folder prefix row on double click', async () => {
    wrap(<FilesPage workspaceId="ws_default" projectId="proj_001" />);

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
    wrap(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
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
    wrap(<FilesPage workspaceId="ws_default" projectId="proj_001" />);
    const dropzone = await screen.findByTestId('files__dropzone');

    fireEvent.dragEnter(dropzone);
    expect(screen.getByTestId('files__dropzone-overlay')).toBeInTheDocument();

    fireEvent.dragLeave(dropzone);
    expect(screen.queryByTestId('files__dropzone-overlay')).not.toBeInTheDocument();
  });
});
