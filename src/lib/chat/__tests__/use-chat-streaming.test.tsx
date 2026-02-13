import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { ChatAPI } from '@/lib/api/endpoints/chat';
import type { ChatMessage, ChatSession } from '@/lib/api/types';
import { useChatStreaming } from '@/lib/chat/use-chat-streaming';
import { toast } from '@/components/ui/toast';

vi.mock('@/lib/chat/stream', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat/stream')>('@/lib/chat/stream');
  return {
    ...actual,
    getChatStreamAttach: vi.fn(),
  };
});

vi.mock('@/components/ui/toast', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const streamMessages = {
  streamError: 'stream error',
  streamingFailed: 'streaming failed',
  stopRequiredBeforeReplaceFailed: 'stop required',
  stopFailedRetry: 'stop failed',
  streamErrorAgentOffline: 'agent offline',
  streamErrorAgentTimeout: 'agent timeout',
  streamErrorAgentProtocol: 'agent protocol error',
  streamErrorAgentUpstream: 'agent upstream error',
};

function createSseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder();
  const payload = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('useChatStreaming attach recovery', () => {
  it('does not call session-stop preflight for append stream', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      createSseResponse([
        { event: 'meta', data: { stream_id: 'st_append', assistant_message_id: 'm_asst' } },
        { event: 'done', data: { message_id: 'm_asst' } },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'not_found_or_finished' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_append', state: 'stopping' }),
    };

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const sessions: ChatSession[] = [
      {
        id: 's_1',
        project_id: 'p_1',
        title: 't',
        model: 'm',
        endpoint_id: 'ep_1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 0,
        total_tokens: 0,
      },
    ];

    const upsertStreamAssistantToCache = vi.fn((_sessionId: string, _message: ChatMessage) => {});
    const patchStreamAssistantInCache = vi.fn((_sessionId: string, _messageId: string, _patch: unknown) => {});

    const { result } = renderHook(
      () =>
        useChatStreaming({
          token: 'tkn',
          workspaceId: 'ws_1',
          projectId: 'p_1',
          sessions,
          currentSessionId: 's_1',
          chatAPI: chatAPI as unknown as ChatAPI,
          queryClient: qc,
          messages: streamMessages,
          upsertStreamAssistantToCache,
          patchStreamAssistantInCache,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.runStream({
        sessionId: 's_1',
        model: 'm',
        endpointId: 'ep_1',
        input: { role: 'user', content: 'hello' },
        mode: 'append',
      });
    });

    expect(chatAPI.stopSessionStream).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();

    await waitFor(() => {
      expect(result.current.streamStateBySession['s_1']?.status ?? 'idle').toBe('idle');
    });

    vi.stubGlobal('fetch', originalFetch);
  });

  it('attaches to recovered stream id and streams deltas', async () => {
    const { getChatStreamAttach } = await import('@/lib/chat/stream');
    vi.mocked(getChatStreamAttach).mockResolvedValue(
      createSseResponse([
        { event: 'meta', data: { stream_id: 'st_1', assistant_message_id: 'm_asst' } },
        { event: 'delta', data: { message_id: 'm_asst', delta: 'Hello' } },
        { event: 'delta', data: { message_id: 'm_asst', delta: ' world' } },
        { event: 'done', data: { message_id: 'm_asst' } },
      ]),
    );

    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({
        items: [{ stream_id: 'st_1', status: 'running', started_at: new Date().toISOString() }],
        total: 1,
      }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'stopping' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_1', state: 'stopping' }),
    };

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const sessions: ChatSession[] = [
      {
        id: 's_1',
        project_id: 'p_1',
        title: 't',
        model: 'm',
        endpoint_id: 'ep_1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 0,
        total_tokens: 0,
        runtime_status: 'running',
      },
    ];

    const upsertStreamAssistantToCache = vi.fn((_sessionId: string, _message: ChatMessage) => {});
    const patchStreamAssistantInCache = vi.fn((_sessionId: string, _messageId: string, _patch: unknown) => {});

    const { result } = renderHook(
      () =>
        useChatStreaming({
          token: 'tkn',
          workspaceId: 'ws_1',
          projectId: 'p_1',
          sessions,
          currentSessionId: 's_1',
          chatAPI: chatAPI as unknown as ChatAPI,
          queryClient: qc,
          messages: streamMessages,
          upsertStreamAssistantToCache,
          patchStreamAssistantInCache,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(getChatStreamAttach).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      // After done, hook should settle back to idle.
      expect(result.current.streamStateBySession['s_1']?.status ?? 'idle').toBe('idle');
    });
  });

  it('silently falls back when attach returns RESOURCE_NOT_FOUND', async () => {
    const { getChatStreamAttach } = await import('@/lib/chat/stream');
    vi.mocked(getChatStreamAttach).mockResolvedValue(
      new Response(JSON.stringify({ code: 'RESOURCE_NOT_FOUND', message: 'chat_stream_not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({
        items: [{ stream_id: 'st_1', status: 'running', started_at: new Date().toISOString() }],
        total: 1,
      }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'stopping' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_1', state: 'stopping' }),
    };

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const sessions: ChatSession[] = [
      {
        id: 's_1',
        project_id: 'p_1',
        title: 't',
        model: 'm',
        endpoint_id: 'ep_1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 0,
        total_tokens: 0,
        runtime_status: 'running',
      },
    ];

    const upsertStreamAssistantToCache = vi.fn((_sessionId: string, _message: ChatMessage) => {});
    const patchStreamAssistantInCache = vi.fn((_sessionId: string, _messageId: string, _patch: unknown) => {});

    const { result } = renderHook(
      () =>
        useChatStreaming({
          token: 'tkn',
          workspaceId: 'ws_1',
          projectId: 'p_1',
          sessions,
          currentSessionId: 's_1',
          chatAPI: chatAPI as unknown as ChatAPI,
          queryClient: qc,
          messages: streamMessages,
          upsertStreamAssistantToCache,
          patchStreamAssistantInCache,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(getChatStreamAttach).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(result.current.streamStateBySession['s_1']?.status ?? 'idle').toBe('idle');
    });

    expect(toast.error).not.toHaveBeenCalled();
  });

  it('maps agent protocol stream error to dedicated user message', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      createSseResponse([
        { event: 'meta', data: { stream_id: 'st_protocol', assistant_message_id: 'm_asst' } },
        { event: 'error', data: { error_code: 'AGENT_PROTOCOL_ERROR', message: 'agent_response_delta_invalid' } },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'not_found_or_finished' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_protocol', state: 'stopping' }),
    };

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const sessions: ChatSession[] = [
      {
        id: 's_1',
        project_id: 'p_1',
        title: 't',
        model: 'm',
        endpoint_id: 'ep_1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 0,
        total_tokens: 0,
      },
    ];

    const upsertStreamAssistantToCache = vi.fn((_sessionId: string, _message: ChatMessage) => {});
    const patchStreamAssistantInCache = vi.fn((_sessionId: string, _messageId: string, _patch: unknown) => {});

    const { result } = renderHook(
      () =>
        useChatStreaming({
          token: 'tkn',
          workspaceId: 'ws_1',
          projectId: 'p_1',
          sessions,
          currentSessionId: 's_1',
          chatAPI: chatAPI as unknown as ChatAPI,
          queryClient: qc,
          messages: streamMessages,
          upsertStreamAssistantToCache,
          patchStreamAssistantInCache,
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.runStream({
        sessionId: 's_1',
        model: 'm',
        endpointId: 'ep_1',
        input: { role: 'user', content: 'hello' },
        mode: 'append',
      });
    });

    await waitFor(() => {
      expect(result.current.streamStateBySession['s_1']?.status ?? 'idle').toBe('error');
    });
    expect(toast.error).toHaveBeenCalledWith('agent protocol error');

    vi.stubGlobal('fetch', originalFetch);
  });
});
