import { describe, expect, it } from 'vitest';
import { buildChatViewModel } from '@/lib/chat/chat-view-model';
import type { ChatMessage, ChatSession } from '@/lib/api/types';

function makeSession(partial: Partial<ChatSession>): ChatSession {
  return {
    id: 'sess_1',
    project_id: 'proj_1',
    title: 'Test',
    model: 'deepseek-chat',
    endpoint_id: 'ep_1',
    pinned: false,
    starred: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    message_count: 0,
    total_tokens: 0,
    ...partial,
  };
}

function makeMessage(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg_1',
    session_id: 'sess_1',
    role: 'assistant',
    content: '',
    created_at: new Date().toISOString(),
    ...partial,
  };
}

describe('buildChatViewModel', () => {
  it('uses local stream state first when present', () => {
    const session = makeSession({ execution_status: 'failed' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {
        [session.id]: {
          status: 'streaming',
          assistant: {
            content: 'partial',
            mode: 'append',
            startedAt: Date.now(),
            lastTokenAt: Date.now(),
          },
        },
      },
    });

    expect(model.activeStreamStatus).toBe('streaming');
    expect(model.disabled).toBe(true);
    expect(model.activeStreamingAssistant?.content).toBe('partial');
    expect(model.activeStreamErrorMessage).toBeNull();
    expect(model.mergedStreamingSessionIds).toContain(session.id);
  });

  it('falls back to execution status when local state is idle', () => {
    const session = makeSession({ execution_status: 'running' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {},
    });

    expect(model.activeStreamStatus).toBe('streaming');
    expect(model.disabled).toBe(true);
    expect(model.activeStreamingAssistant).toBeNull();
    expect(model.activeStreamErrorMessage).toBeNull();
    expect(model.mergedStreamingSessionIds).toContain(session.id);
  });

  it('keeps the session disabled while a stream is recovering', () => {
    const session = makeSession({ execution_status: 'running' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {
        [session.id]: {
          status: 'recovering',
          assistant: {
            messageId: null,
            content: '',
            mode: 'append',
            startedAt: Date.now(),
            lastTokenAt: Date.now(),
          },
        },
      },
    });

    expect(model.activeStreamStatus).toBe('recovering');
    expect(model.disabled).toBe(true);
    expect(model.mergedStreamingSessionIds).toContain(session.id);
  });

  it('surfaces backend stopping as the authoritative active status', () => {
    const session = makeSession({ execution_status: 'stopping' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {},
    });

    expect(model.activeStreamStatus).toBe('stopping');
    expect(model.disabled).toBe(true);
    expect(model.mergedStreamingSessionIds).toContain(session.id);
  });

  it('keeps the session disabled while forced stop is terminating locally', () => {
    const session = makeSession({ execution_status: 'stopping' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {
        [session.id]: {
          status: 'terminating',
          assistant: null,
        },
      },
    });

    expect(model.activeStreamStatus).toBe('terminating');
    expect(model.disabled).toBe(true);
    expect(model.mergedStreamingSessionIds).toContain(session.id);
  });

  it('surfaces authoritative terminating truth after reload without local stream state', () => {
    const session = makeSession({
      execution_status: 'terminating',
      stop_mode: 'terminate',
    });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {},
    });

    expect(model.activeStreamStatus).toBe('terminating');
    expect(model.disabled).toBe(true);
    expect(model.mergedStreamingSessionIds).toContain(session.id);
  });

  it('ignores stale terminal teardown markers once backend execution is terminal', () => {
    const session = makeSession({
      execution_status: 'stopped',
      stop_mode: 'terminate',
      termination_state: 'terminating',
    });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {},
    });

    expect(model.activeStreamStatus).toBe('stopped');
    expect(model.disabled).toBe(false);
    expect(model.mergedStreamingSessionIds).not.toContain(session.id);
  });

  it.each([
    { executionStatus: 'completed' as const, expectedStatus: 'idle' as const },
    { executionStatus: 'stopped' as const, expectedStatus: 'stopped' as const },
    { executionStatus: 'failed' as const, expectedStatus: 'error' as const },
  ])(
    'uses final backend $executionStatus truth over stale terminate stop_mode',
    ({ executionStatus, expectedStatus }) => {
      const session = makeSession({
        execution_status: executionStatus,
        stop_mode: 'terminate',
      });
      const model = buildChatViewModel({
        currentSessionId: session.id,
        activeSession: session,
        sessions: [session],
        messages: [],
        streamStateBySession: {
          [session.id]: {
            status: 'terminating',
            assistant: null,
          },
        },
      });

      expect(model.activeStreamStatus).toBe(expectedStatus);
      expect(model.disabled).toBe(false);
      expect(model.mergedStreamingSessionIds).not.toContain(session.id);
    },
  );

  it('does not turn a backend cancel stop into terminating after refetch', () => {
    const session = makeSession({
      execution_status: 'stopping',
      stop_mode: 'cancel',
      can_escalate: false,
    });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {
        [session.id]: {
          status: 'stopping',
          assistant: null,
        },
      },
    });

    expect(model.activeStreamStatus).toBe('stopping');
    expect(model.disabled).toBe(true);
    expect(model.mergedStreamingSessionIds).toContain(session.id);
  });

  it('does not let local recovering hide an authoritative backend stopping state', () => {
    const session = makeSession({ execution_status: 'stopping' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {
        [session.id]: {
          status: 'recovering',
          assistant: {
            messageId: null,
            content: '',
            mode: 'append',
            startedAt: Date.now(),
            lastTokenAt: Date.now(),
          },
        },
      },
    });

    expect(model.activeStreamStatus).toBe('stopping');
    expect(model.disabled).toBe(true);
  });

  it('does not let stale local terminal state override an active backend execution', () => {
    const session = makeSession({ execution_status: 'running' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {
        [session.id]: {
          status: 'stopped',
          assistant: null,
        },
      },
    });

    expect(model.activeStreamStatus).toBe('streaming');
    expect(model.disabled).toBe(true);
  });

  it('drops stale local terminal status once the backend marks execution completed', () => {
    const session = makeSession({ execution_status: 'completed' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {
        [session.id]: {
          status: 'stopped',
          assistant: null,
        },
      },
    });

    expect(model.activeStreamStatus).toBe('idle');
    expect(model.disabled).toBe(false);
  });

  it('returns idle state with no active session', () => {
    const model = buildChatViewModel({
      currentSessionId: null,
      activeSession: null,
      sessions: [],
      messages: [],
      streamStateBySession: {},
    });

    expect(model.activeStreamStatus).toBe('idle');
    expect(model.disabled).toBe(false);
    expect(model.activeStreamingAssistant).toBeNull();
    expect(model.activeStreamErrorMessage).toBeNull();
    expect(model.mergedStreamingSessionIds).toHaveLength(0);
  });

  it('exposes active stream error message when stream failed', () => {
    const session = makeSession({});
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {
        [session.id]: {
          status: 'error',
          assistant: null,
          errorMessage: 'Upstream rate limit',
        },
      },
    });

    expect(model.activeStreamStatus).toBe('error');
    expect(model.activeStreamErrorMessage).toBe('Upstream rate limit');
    expect(model.disabled).toBe(false);
  });

  it('surfaces a local attach error even while backend execution still says running', () => {
    const session = makeSession({ execution_status: 'running' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [],
      streamStateBySession: {
        [session.id]: {
          status: 'error',
          assistant: null,
          errorCode: 'STREAM_UPSTREAM_ERROR',
          errorMessage: 'Provider attach failed',
        },
      },
    });

    expect(model.activeStreamStatus).toBe('streaming');
    expect(model.activeStreamErrorCode).toBe('STREAM_UPSTREAM_ERROR');
    expect(model.activeStreamErrorMessage).toBe('Provider attach failed');
    expect(model.disabled).toBe(true);
  });

  it('keeps recovery truth from the latest failed assistant message after local error state is gone', () => {
    const session = makeSession({});
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [
        makeMessage({
          id: 'msg_failed',
          content: 'Provider stayed unavailable',
          message_status: 'failed',
          error_message: 'Provider stayed unavailable',
          error_code: 'STREAM_UPSTREAM_ERROR',
        }),
      ],
      streamStateBySession: {},
    });

    expect(model.activeStreamStatus).toBe('error');
    expect(model.activeStreamErrorCode).toBe('STREAM_UPSTREAM_ERROR');
    expect(model.activeStreamErrorMessage).toBe('Provider stayed unavailable');
    expect(model.disabled).toBe(false);
  });

  it('uses the visible chain instead of hidden stale variants for persisted recovery truth', () => {
    const session = makeSession({});
    const hiddenFailedAssistant = makeMessage({
      id: 'msg_hidden_failed',
      content: 'Hidden provider failure',
      message_status: 'failed',
      error_message: 'Hidden provider failure',
      error_code: 'STREAM_UPSTREAM_ERROR',
    });
    const visibleAssistant = makeMessage({
      id: 'msg_visible_clean',
      content: 'Visible assistant answer',
      message_status: 'completed',
    });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      messages: [hiddenFailedAssistant, visibleAssistant],
      visibleMessages: [visibleAssistant],
      streamStateBySession: {},
    });

    expect(model.activeStreamStatus).toBe('idle');
    expect(model.activeStreamErrorCode).toBeNull();
    expect(model.activeStreamErrorMessage).toBeNull();
    expect(model.disabled).toBe(false);
  });
});
