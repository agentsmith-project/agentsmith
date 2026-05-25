import { describe, expect, it, vi } from 'vitest';
import { ChatAPI } from '@/lib/api/endpoints/chat';
import type { ApiClient } from '@/lib/api/client';

function createMockClient(): ApiClient {
  return {
    setToken: vi.fn(),
    getToken: vi.fn(() => null),
    clearToken: vi.fn(),
    get: vi.fn(),
    getBlob: vi.fn(),
    post: vi.fn(),
    postMultipart: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    connectSSE: vi.fn(),
  };
}

describe('ChatAPI stop surface', () => {
  it('stops message streams with mode only', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({
      success: true,
      stream_id: 'stream_1',
      state: 'terminating',
      mode: 'terminate',
      can_escalate: false,
    });
    const api = new ChatAPI(client);

    await api.stopStream('ws_default', 'proj_1', 'session_1', 'stream_1', { mode: 'terminate' });

    expect(client.post).toHaveBeenCalledWith(
      '/workspaces/ws_default/projects/proj_1/chat/sessions/session_1/messages/streams/stream_1/stop',
      { mode: 'terminate' },
    );
    const postedBody = vi.mocked(client.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(postedBody).not.toHaveProperty('stop_mode');
  });

  it('stops sessions with mode only', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({
      success: true,
      session_id: 'session_1',
      state: 'stopping',
      mode: 'cancel',
      can_escalate: true,
    });
    const api = new ChatAPI(client);

    await api.stopSessionStream('ws_default', 'proj_1', 'session_1');

    expect(client.post).toHaveBeenCalledWith(
      '/workspaces/ws_default/projects/proj_1/chat/sessions/session_1/stop',
      { mode: 'cancel' },
    );
    const postedBody = vi.mocked(client.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(postedBody).not.toHaveProperty('stop_mode');
  });
});
