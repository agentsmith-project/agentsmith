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
    const session = makeSession({ runtime_status: 'failed' });
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
    expect(model.mergedStreamingSessionIds).toContain(session.id);
  });

  it('falls back to runtime status when local state is idle', () => {
    const session = makeSession({ runtime_status: 'running' });
    const model = buildChatViewModel({
      currentSessionId: session.id,
      activeSession: session,
      sessions: [session],
      streamStateBySession: {},
    });

    expect(model.activeStreamStatus).toBe('streaming');
    expect(model.disabled).toBe(false);
    expect(model.activeStreamingAssistant).toBeNull();
    expect(model.mergedStreamingSessionIds).toContain(session.id);
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
    expect(model.mergedStreamingSessionIds).toHaveLength(0);
  });
});
