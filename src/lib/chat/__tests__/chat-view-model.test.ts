import { describe, expect, it } from 'vitest';
import { buildChatViewModel } from '@/lib/chat/chat-view-model';
import type { ChatSession } from '@/lib/api/types';

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

describe('buildChatViewModel', () => {
  it('uses local stream state first when present', () => {
    const session = makeSession({ execution_status: 'failed' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
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
      streamStateBySession: {},
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
});
