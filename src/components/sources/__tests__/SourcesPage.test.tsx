/**
 * Unit tests for SourcesPage (object browser).
 *
 * This intentionally tests only stable, high-value behavior:
 * - renders libraries list
 * - renders objects table and navigates into a prefix
 */

import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

import { SourcesPage } from '../SourcesPage';

import { vi } from 'vitest';

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, components }: {
    data: Array<unknown>;
    itemContent: (index: number, item: unknown) => React.ReactNode;
    components?: { Footer?: React.ComponentType };
  }) => (
    <div data-testid="sources__virtuoso">
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

vi.mock('@/lib/hooks/use-sources', () => ({
  useSourceLibraries: () => ({
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
  useCreateSourceLibrary: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSourceLibrary: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSourceLibrary: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/hooks/use-source-objects', () => ({
  useSourceObjectsInfinite: () => ({
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
  useSourceObjects: () => ({
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
  useCreateSourceFolder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadSourceObject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSourceObjects: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMoveSourceObject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('SourcesPage (object browser)', () => {
  it('renders libraries pane and objects table', async () => {
    wrap(<SourcesPage workspaceId="ws_default" projectId="proj_001" />);

    expect(await screen.findByTestId('sources__library-list')).toBeInTheDocument();
    expect(screen.getByTestId('sources__objects-table')).toBeInTheDocument();
  });

  it('navigates into a folder prefix row', async () => {
    wrap(<SourcesPage workspaceId="ws_default" projectId="proj_001" />);

    const user = userEvent.setup();
    const table = await screen.findByTestId('sources__objects-table');
    const rows = within(table).getAllByTestId('sources__object-row');
    expect(rows.length).toBeGreaterThan(0);

    // Click the first row's name button (folder rows navigate).
    const firstRow = rows[0];
    const nameButton = within(firstRow).getByRole('button');
    await user.click(nameButton);

    // Breadcrumb should still render, and the table should remain present.
    expect(screen.getByTestId('sources__breadcrumb-root')).toBeInTheDocument();
    expect(screen.getByTestId('sources__objects-table')).toBeInTheDocument();
  });

  it('shows selection summary and can clear selection', async () => {
    wrap(<SourcesPage workspaceId="ws_default" projectId="proj_001" />);
    const user = userEvent.setup();

    const table = await screen.findByTestId('sources__objects-table');
    const row = within(table).getAllByTestId('sources__object-row').find((el) => el.textContent?.includes('README.txt'));
    expect(row).toBeDefined();
    await user.click(within(row as HTMLElement).getByRole('button', { name: /README\.txt/i }));

    expect(screen.getByTestId('sources__selection-summary')).toBeInTheDocument();
    await user.click(screen.getByTestId('sources__clear-selection'));
    expect(screen.queryByTestId('sources__selection-summary')).not.toBeInTheDocument();
  });

  it('shows dropzone overlay on drag enter', async () => {
    wrap(<SourcesPage workspaceId="ws_default" projectId="proj_001" />);
    const dropzone = await screen.findByTestId('sources__dropzone');

    fireEvent.dragEnter(dropzone);
    expect(screen.getByTestId('sources__dropzone-overlay')).toBeInTheDocument();

    fireEvent.dragLeave(dropzone);
    expect(screen.queryByTestId('sources__dropzone-overlay')).not.toBeInTheDocument();
  });
});
