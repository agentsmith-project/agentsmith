import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { ChatAPI } from '@/lib/api/endpoints/chat';
import type { ChatMessage, ChatSession } from '@/lib/api/types';
import { useChatStreaming } from '@/lib/chat/use-chat-streaming';
import {
  CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT,
  CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT,
  type ChatStreamEscalationConfirmationRequestDetail,
} from '@/lib/chat/stream-state';
import { useChatStreamStore } from '@/lib/chat/stream-store';
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
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

const streamMessages = {
  streamError: 'stream error',
  streamErrorEmptyResponse: 'empty response',
  streamingFailed: 'streaming failed',
  stopRequiredBeforeReplaceFailed: 'stop required',
  stopFailedRetry: 'stop failed',
  streamErrorAgentOffline: 'agent offline',
  streamErrorAgentTimeout: 'agent timeout',
  streamErrorAgentProtocol: 'agent protocol error',
  streamErrorAgentUpstream: 'agent upstream error',
  streamWarningSessionWorkspaceRecreated: 'workspace reclaimed',
  streamStopEscalationUnavailable: 'Forced stop is not available.',
};

beforeEach(() => {
  vi.clearAllMocks();
  useChatStreamStore.setState({ streamIdBySession: {}, streamStateBySession: {} });
});

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
  it('uses session-stop authority while a stream is still bootstrapping without a stream id', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      }
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
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
        execution_status: 'running',
      },
    ];

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
          upsertStreamAssistantToCache: vi.fn(),
          patchStreamAssistantInCache: vi.fn(),
        }),
      { wrapper },
    );

    await act(async () => {
      void result.current.runStream({
        sessionId: 's_1',
        model: 'm',
        endpointId: 'ep_1',
        input: { role: 'user', content: 'hello' },
        mode: 'append',
      });
    });

    await waitFor(() => {
      expect(result.current.streamStateBySession['s_1']?.status).toBe('connecting');
    });

    await act(async () => {
      await result.current.stopStreamingSession('s_1', 'user');
    });

    expect(chatAPI.stopSessionStream).toHaveBeenCalledWith('ws_1', 'p_1', 's_1');
    expect(chatAPI.stopStream).not.toHaveBeenCalled();
    expect(result.current.streamStateBySession['s_1']?.status).toBe('stopping');

    vi.stubGlobal('fetch', originalFetch);
  });

  it('keeps a user stop request in stopping while authoritative backend state catches up', async () => {
    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'stopping' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_1', state: 'stopping' }),
    };

    useChatStreamStore.setState({
      streamIdBySession: { s_1: 'st_1' },
      streamStateBySession: {
        s_1: {
          status: 'streaming',
          assistant: {
            messageId: 'm_asst',
            content: 'partial',
            mode: 'append',
            startedAt: Date.now(),
            lastTokenAt: Date.now(),
          },
        },
      },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
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
          upsertStreamAssistantToCache: vi.fn(),
          patchStreamAssistantInCache: vi.fn(),
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.stopStreamingSession('s_1', 'user');
    });

    expect(chatAPI.stopStream).toHaveBeenCalledWith('ws_1', 'p_1', 's_1', 'st_1');
    expect(result.current.streamStateBySession['s_1']).toMatchObject({
      status: 'stopping',
      assistant: expect.objectContaining({
        content: 'partial',
      }),
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it('refetches session truth after stop timeout and sends terminate only after confirmation', async () => {
    vi.useFakeTimers();
    const chatAPI: Pick<ChatAPI, 'getSession' | 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSession: vi.fn().mockResolvedValue({
        id: 's_1',
        project_id: 'p_1',
        title: 't',
        model: 'm',
        endpoint_id: 'ep_1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 0,
        total_tokens: 0,
        execution_status: 'stopping',
        can_escalate: true,
        escalation_reason: 'agent did not acknowledge stop',
      }),
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'stopping' }),
      stopStream: vi.fn()
        .mockResolvedValueOnce({ success: true, stream_id: 'st_1', state: 'stopping', stop_mode: 'cancel', can_escalate: true })
        .mockResolvedValueOnce({ success: true, stream_id: 'st_1', state: 'terminating', status: 'terminating', stop_mode: 'terminate', can_escalate: false }),
    };
    const requests: ChatStreamEscalationConfirmationRequestDetail[] = [];
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<ChatStreamEscalationConfirmationRequestDetail>).detail;
      requests.push(detail);
      window.dispatchEvent(
        new CustomEvent(CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT, {
          detail: { requestId: detail.requestId, confirmed: true },
        }),
      );
    };
    window.addEventListener(CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT, onRequest);

    useChatStreamStore.setState({
      streamIdBySession: { s_1: 'st_1' },
      streamStateBySession: {
        s_1: {
          status: 'streaming',
          assistant: {
            messageId: 'm_asst',
            content: 'partial',
            mode: 'append',
            startedAt: Date.now(),
            lastTokenAt: Date.now(),
          },
        },
      },
    });

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
        execution_status: 'running',
      },
    ];

    try {
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
            upsertStreamAssistantToCache: vi.fn(),
            patchStreamAssistantInCache: vi.fn(),
          }),
        { wrapper },
      );

      await act(async () => {
        await result.current.stopStreamingSession('s_1', 'user');
      });

      expect(chatAPI.stopStream).toHaveBeenCalledTimes(1);
      expect(chatAPI.stopStream).toHaveBeenNthCalledWith(1, 'ws_1', 'p_1', 's_1', 'st_1');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
        await Promise.resolve();
      });

      expect(chatAPI.getSession).toHaveBeenCalledWith('ws_1', 'p_1', 's_1');
      expect(requests).toHaveLength(1);
      expect(chatAPI.stopStream).toHaveBeenCalledTimes(2);
      expect(chatAPI.stopStream).toHaveBeenNthCalledWith(
        2,
        'ws_1',
        'p_1',
        's_1',
        'st_1',
        { mode: 'terminate' },
      );
      expect(result.current.streamStateBySession['s_1']?.status).toBe('terminating');
    } finally {
      window.removeEventListener(CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT, onRequest);
      vi.useRealTimers();
    }
  });

  it('schedules escalation from refreshed stopping session truth and confirms after refetch', async () => {
    vi.useFakeTimers();
    let resolveSession!: (session: ChatSession) => void;
    const sessionTruth = new Promise<ChatSession>((resolve) => {
      resolveSession = resolve;
    });
    const chatAPI: Pick<ChatAPI, 'getSession' | 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSession: vi.fn().mockReturnValue(sessionTruth),
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({
        success: true,
        session_id: 's_1',
        state: 'terminating',
        status: 'terminating',
        stop_mode: 'terminate',
      }),
      stopStream: vi.fn().mockResolvedValue({
        success: true,
        stream_id: 'st_1',
        state: 'terminating',
        status: 'terminating',
        stop_mode: 'terminate',
      }),
    };
    const requests: ChatStreamEscalationConfirmationRequestDetail[] = [];
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<ChatStreamEscalationConfirmationRequestDetail>).detail;
      requests.push(detail);
      window.dispatchEvent(
        new CustomEvent(CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT, {
          detail: { requestId: detail.requestId, confirmed: true },
        }),
      );
    };
    window.addEventListener(CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT, onRequest);

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
        execution_status: 'stopping',
        can_escalate: true,
        escalation_reason: 'agent did not acknowledge stop',
      },
    ];

    try {
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
            upsertStreamAssistantToCache: vi.fn(),
            patchStreamAssistantInCache: vi.fn(),
          }),
        { wrapper },
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
        await Promise.resolve();
      });

      expect(chatAPI.getSession).toHaveBeenCalledWith('ws_1', 'p_1', 's_1');
      expect(requests).toHaveLength(0);
      expect(chatAPI.stopSessionStream).not.toHaveBeenCalled();

      await act(async () => {
        resolveSession({
          ...sessions[0],
          execution_status: 'stopping',
          can_escalate: true,
          escalation_reason: 'agent did not acknowledge stop',
        });
        await sessionTruth;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        sessionId: 's_1',
        reason: 'agent did not acknowledge stop',
      });
      expect(chatAPI.stopSessionStream).toHaveBeenCalledWith(
        'ws_1',
        'p_1',
        's_1',
        { mode: 'terminate' },
      );
      expect(chatAPI.stopStream).not.toHaveBeenCalled();
      expect(result.current.streamStateBySession['s_1']?.status).toBe('terminating');
    } finally {
      window.removeEventListener(CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT, onRequest);
      vi.useRealTimers();
    }
  });

  it('keeps stopping when backend downgrades a terminate request to cancel truth', async () => {
    vi.useFakeTimers();
    const chatAPI: Pick<ChatAPI, 'getSession' | 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSession: vi.fn().mockResolvedValue({
        id: 's_1',
        project_id: 'p_1',
        title: 't',
        model: 'm',
        endpoint_id: 'ep_1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 0,
        total_tokens: 0,
        execution_status: 'stopping',
        stop_mode: 'cancel',
        can_escalate: true,
        escalation_reason: 'agent did not acknowledge stop',
      }),
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'stopping', stop_mode: 'cancel', can_escalate: true }),
      stopStream: vi.fn()
        .mockResolvedValueOnce({ success: true, stream_id: 'st_1', state: 'stopping', stop_mode: 'cancel', can_escalate: true })
        .mockResolvedValueOnce({ success: true, stream_id: 'st_1', state: 'stopping', status: 'stopping', stop_mode: 'cancel', can_escalate: false }),
    };
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<ChatStreamEscalationConfirmationRequestDetail>).detail;
      window.dispatchEvent(
        new CustomEvent(CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT, {
          detail: { requestId: detail.requestId, confirmed: true },
        }),
      );
    };
    window.addEventListener(CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT, onRequest);

    useChatStreamStore.setState({
      streamIdBySession: { s_1: 'st_1' },
      streamStateBySession: {
        s_1: {
          status: 'streaming',
          assistant: null,
        },
      },
    });
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
        execution_status: 'running',
      },
    ];

    try {
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
            upsertStreamAssistantToCache: vi.fn(),
            patchStreamAssistantInCache: vi.fn(),
          }),
        { wrapper },
      );

      await act(async () => {
        await result.current.stopStreamingSession('s_1', 'user');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
        await Promise.resolve();
      });

      expect(chatAPI.stopStream).toHaveBeenCalledTimes(2);
      expect(result.current.streamStateBySession['s_1']?.status).toBe('stopping');
      expect(toast.info).not.toHaveBeenCalledWith(expect.stringContaining('Forced stop is not available.'));
    } finally {
      window.removeEventListener(CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT, onRequest);
      vi.useRealTimers();
    }
  });

  it('shows an informational prompt without dangerous confirmation when forced stop is unsupported', async () => {
    vi.useFakeTimers();
    const chatAPI: Pick<ChatAPI, 'getSession' | 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSession: vi.fn().mockResolvedValue({
        id: 's_1',
        project_id: 'p_1',
        title: 't',
        model: 'm',
        endpoint_id: 'ep_1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 0,
        total_tokens: 0,
        execution_status: 'stopping',
        can_escalate: false,
        escalation_reason: 'endpoint does not support terminate',
      }),
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'stopping' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_1', state: 'stopping' }),
    };
    const onRequest = vi.fn();
    window.addEventListener(CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT, onRequest);
    useChatStreamStore.setState({
      streamIdBySession: {},
      streamStateBySession: {
        s_1: {
          status: 'streaming',
          assistant: null,
        },
      },
    });
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
        execution_status: 'running',
      },
    ];

    try {
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
            upsertStreamAssistantToCache: vi.fn(),
            patchStreamAssistantInCache: vi.fn(),
          }),
        { wrapper },
      );

      await act(async () => {
        await result.current.stopStreamingSession('s_1', 'user');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
        await Promise.resolve();
      });

      expect(chatAPI.getSession).toHaveBeenCalledWith('ws_1', 'p_1', 's_1');
      expect(toast.info).toHaveBeenCalledWith(
        'Forced stop is not available. endpoint does not support terminate',
      );
      expect(onRequest).not.toHaveBeenCalled();
      expect(chatAPI.stopSessionStream).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT, onRequest);
      vi.useRealTimers();
    }
  });

  it('deduplicates repeated user stop clicks while stopping truth is already pending', async () => {
    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'stopping' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_1', state: 'stopping' }),
    };
    useChatStreamStore.setState({
      streamIdBySession: {},
      streamStateBySession: {
        s_1: {
          status: 'stopping',
          assistant: null,
        },
      },
    });
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
        execution_status: 'stopping',
      },
    ];
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
          upsertStreamAssistantToCache: vi.fn(),
          patchStreamAssistantInCache: vi.fn(),
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.stopStreamingSession('s_1', 'user');
      await result.current.stopStreamingSession('s_1', 'user');
    });

    expect(chatAPI.stopSessionStream).not.toHaveBeenCalled();
    expect(chatAPI.stopStream).not.toHaveBeenCalled();
  });

  it('does not synthesize a stopped state when session-stop reports not_found_or_finished', async () => {
    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'not_found_or_finished' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_1', state: 'stopping' }),
    };

    useChatStreamStore.setState({
      streamIdBySession: {},
      streamStateBySession: {
        s_1: {
          status: 'streaming',
          assistant: {
            messageId: 'm_asst',
            content: 'partial',
            mode: 'append',
            startedAt: Date.now(),
            lastTokenAt: Date.now(),
          },
        },
      },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
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
        execution_status: 'running',
      },
    ];

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
          upsertStreamAssistantToCache: vi.fn(),
          patchStreamAssistantInCache: vi.fn(),
        }),
      { wrapper },
    );

    await act(async () => {
      await result.current.stopStreamingSession('s_1', 'user');
    });

    expect(chatAPI.stopSessionStream).toHaveBeenCalledWith('ws_1', 'p_1', 's_1');
    expect(result.current.streamStateBySession['s_1']).toMatchObject({
      status: 'streaming',
      assistant: expect.objectContaining({
        content: 'partial',
      }),
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it('does not call session-stop preflight for append stream', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      createSseResponse([
        { event: 'meta', data: { stream_id: 'st_append', assistant_message_id: 'm_asst' } },
        { event: 'delta', data: { message_id: 'm_asst', delta: 'ok' } },
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
        { event: 'warning', data: { code: 'session.workspace_recreated', message: 'chat_session_workspace_recreated' } },
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
        execution_status: 'running',
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
    expect(toast.warning).toHaveBeenCalledWith('workspace reclaimed');
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
        execution_status: 'running',
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

  it('keeps attach recovery error state visible past the old 60s cleanup window', async () => {
    vi.useFakeTimers();
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      createSseResponse([
        { event: 'meta', data: { stream_id: 'st_recovery', assistant_message_id: 'm_asst' } },
        { event: 'error', data: { error_code: 'AGENT_UPSTREAM_ERROR', message: 'Provider attach failed' } },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'stopping' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_recovery', state: 'stopping' }),
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
        execution_status: 'running',
      },
    ];

    try {
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
            upsertStreamAssistantToCache: vi.fn(),
            patchStreamAssistantInCache: vi.fn(),
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

      expect(result.current.streamStateBySession['s_1']).toMatchObject({
        status: 'error',
        errorMessage: 'agent upstream error',
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(result.current.streamStateBySession['s_1']).toMatchObject({
        status: 'error',
        errorMessage: 'agent upstream error',
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
      vi.useRealTimers();
    }
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

  it('shows a workspace recreation warning during a fresh stream and continues streaming', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      createSseResponse([
        { event: 'meta', data: { stream_id: 'st_warning', assistant_message_id: 'm_asst' } },
        { event: 'warning', data: { code: 'session.workspace_recreated', message: 'chat_session_workspace_recreated' } },
        { event: 'delta', data: { message_id: 'm_asst', delta: 'Recovered' } },
        { event: 'done', data: { message_id: 'm_asst' } },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'not_found_or_finished' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_warning', state: 'stopping' }),
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
      expect(result.current.streamStateBySession['s_1']?.status ?? 'idle').toBe('idle');
    });
    expect(toast.warning).toHaveBeenCalledWith('workspace reclaimed');
    expect(fetchMock).toHaveBeenCalled();

    vi.stubGlobal('fetch', originalFetch);
  });

  it('shows explicit error when stream completes without any delta content', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      createSseResponse([
        { event: 'meta', data: { stream_id: 'st_empty', assistant_message_id: 'm_asst' } },
        { event: 'done', data: { message_id: 'm_asst' } },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const chatAPI: Pick<ChatAPI, 'getSessionStreams' | 'stopSessionStream' | 'stopStream'> = {
      getSessionStreams: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      stopSessionStream: vi.fn().mockResolvedValue({ success: true, session_id: 's_1', state: 'not_found_or_finished' }),
      stopStream: vi.fn().mockResolvedValue({ success: true, stream_id: 'st_empty', state: 'stopping' }),
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
    expect(toast.error).toHaveBeenCalledWith('empty response');

    vi.stubGlobal('fetch', originalFetch);
  });
});
