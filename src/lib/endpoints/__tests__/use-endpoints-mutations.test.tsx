import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useEndpointsMutations } from '../use-endpoints-mutations';

const mockDelete = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue({});
const mockImport = vi.fn().mockResolvedValue({ items: [] });

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  EndpointAPI: vi.fn().mockImplementation(function () {
    return {
      delete: mockDelete,
      update: mockUpdate,
      importBulk: mockImport,
    };
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useEndpointsMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls delete endpoint mutation with workspace/project scoped ids', async () => {
    const { result } = renderHook(
      () => useEndpointsMutations({ workspaceId: 'ws_1', projectId: 'prj_1' }),
      { wrapper: createWrapper() },
    );

    result.current.deleteEndpointMutation.mutate('ep_1');

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('ws_1', 'prj_1', 'ep_1');
    });
  });

  it('runs import callbacks for success and failure paths', async () => {
    const onImportSuccess = vi.fn();
    const onImportError = vi.fn();

    const { result, rerender } = renderHook(
      () => useEndpointsMutations({ workspaceId: 'ws_1', projectId: 'prj_1', onImportSuccess, onImportError }),
      { wrapper: createWrapper() },
    );

    result.current.importBulkMutation.mutate({
      completion: { model: 'm', api_base: 'https://x', api_key: 'k' },
    });

    await waitFor(() => {
      expect(onImportSuccess).toHaveBeenCalledTimes(1);
    });

    mockImport.mockRejectedValueOnce(new Error('import failed'));
    rerender();

    result.current.importBulkMutation.mutate({
      completion: { model: 'm2', api_base: 'https://y', api_key: 'k2' },
    });

    await waitFor(() => {
      expect(onImportError).toHaveBeenCalled();
    });
  });

  it('calls update endpoint mutation with scoped ids and payload', async () => {
    const { result } = renderHook(
      () => useEndpointsMutations({ workspaceId: 'ws_2', projectId: 'prj_2' }),
      { wrapper: createWrapper() },
    );

    result.current.updateEndpointMutation.mutate({
      endpointId: 'ep_9',
      data: { status: 'disabled' },
    });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('ws_2', 'prj_2', 'ep_9', { status: 'disabled' });
    });
  });
});
