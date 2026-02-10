import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useEndpointsData } from '../use-endpoints-data';

const mockList = vi.fn().mockResolvedValue({
  items: [
    {
      id: 'ep_1',
      project_id: 'prj_1',
      name: 'Endpoint 1',
      openai_model: 'gpt-4o',
      type: 'openai',
      base_url: 'https://api.example.com/v1',
      status: 'active',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
  ],
  total: 1,
  page: 1,
  page_size: 20,
  has_more: false,
});

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  EndpointAPI: vi.fn().mockImplementation(function () {
    return {
      list: mockList,
    };
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useEndpointsData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches endpoints when route params and permission are valid', async () => {
    const { result } = renderHook(
      () => useEndpointsData({ workspaceId: 'ws_1', projectId: 'prj_1', canReadEndpoints: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith('ws_1', 'prj_1');
      expect(result.current.endpoints).toHaveLength(1);
    });
  });

  it('does not fetch endpoints when read permission is missing', async () => {
    const { result } = renderHook(
      () => useEndpointsData({ workspaceId: 'ws_1', projectId: 'prj_1', canReadEndpoints: false }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.endpointsLoading).toBe(false);
      expect(result.current.endpoints).toHaveLength(0);
      expect(mockList).not.toHaveBeenCalled();
    });
  });
});
