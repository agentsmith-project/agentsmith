import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileObjectDetailsPanel } from '../../FileObjectDetailsPanel';

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn((options?: { queryKey?: unknown[] }) => {
      const key = options?.queryKey?.[0];
      if (key === 'source-object-preview') {
        return {
          data: {
            text: async () => 'hello',
          },
          isLoading: false,
          isError: false,
        };
      }
      return {
        data: {
          key: 'lib_shared_default/README.txt',
          content_type: 'text/plain',
          size_bytes: 12,
          last_modified: '2026-02-27T14:30:00Z',
          etag: 'etag_1',
          user_metadata: {},
        },
        isLoading: false,
        isError: false,
      };
    }),
  };
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean; token: string | null }) => unknown) =>
    selector({ isAuthenticated: true, token: 'token_1' }),
  useAuthStoreHydration: () => true,
  selectIsAuthenticated: (state: { isAuthenticated: boolean }) => state.isAuthenticated,
  selectToken: (state: { token: string | null }) => state.token,
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({
    setToken: vi.fn(),
    clearToken: vi.fn(),
  })),
  FilesAPI: vi.fn().mockImplementation(function () {
    return {
      getObjectMeta: vi.fn(),
      downloadObject: vi.fn(),
    };
  }),
}));

vi.mock('@/components/files/FileItemIcon', () => ({
  FileItemIcon: () => <div data-testid="file-item-icon" />,
}));

vi.mock('../file-object-details-panel/PreviewSection', () => ({
  PreviewSection: () => <div data-testid="files__details-preview" />,
}));

vi.mock('../file-object-details-panel/PreviewDialog', () => ({
  PreviewDialog: () => null,
}));

describe('FileObjectDetailsPanel', () => {
  it('keeps the details inspector inline without a local hero panel', async () => {
    render(
      <FileObjectDetailsPanel
        workspaceId="ws_1"
        projectId="proj_1"
        selectedLibraryId="lib_shared_default"
        selected={[{ kind: 'object', key: 'lib_shared_default/README.txt' } as never]}
        onDownload={vi.fn()}
      />
    );

    expect(screen.getByTestId('files__details-panel')).toBeInTheDocument();
    await expect(screen.findByTestId('files__details-inspector')).resolves.toBeInTheDocument();
    expect(screen.queryByTestId('files__details-hero')).not.toBeInTheDocument();
  });
});
