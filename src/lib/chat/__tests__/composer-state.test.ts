import { describe, expect, it } from 'vitest';
import { deriveChatComposerState, hasEndpointBinding } from '@/lib/chat/composer-state';
import type { ChatSession } from '@/lib/api/types';

function createSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    id: 'session_1',
    project_id: 'project_1',
    title: 'Session',
    model: 'gpt-4o',
    endpoint_id: 'ep_1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    message_count: 0,
    total_tokens: 0,
    ...overrides,
  };
}

describe('composer-state', () => {
  it('detects endpoint binding', () => {
    expect(hasEndpointBinding(createSession())).toBe(true);
    expect(hasEndpointBinding(createSession({ endpoint_id: '' }))).toBe(false);
    expect(hasEndpointBinding(createSession({ model: '' }))).toBe(false);
    expect(
      hasEndpointBinding(createSession({ endpoint_id: undefined as unknown as string })),
    ).toBe(false);
    expect(hasEndpointBinding(createSession({ model: undefined as unknown as string }))).toBe(false);
  });

  it('derives no_thread state first', () => {
    expect(
      deriveChatComposerState({
        currentSessionId: null,
        activeSession: null,
        editingMessageId: null,
        streamStatus: 'idle',
        createMessagePending: false,
        editMessagePending: false,
        initAttachmentPending: false,
      }),
    ).toBe('no_thread');
  });

  it('derives need_endpoint when session exists but endpoint/model missing', () => {
    expect(
      deriveChatComposerState({
        currentSessionId: 'session_1',
        activeSession: createSession({ endpoint_id: '' }),
        editingMessageId: null,
        streamStatus: 'idle',
        createMessagePending: false,
        editMessagePending: false,
        initAttachmentPending: false,
      }),
    ).toBe('need_endpoint');
  });

  it('derives ready when all preconditions are met', () => {
    expect(
      deriveChatComposerState({
        currentSessionId: 'session_1',
        activeSession: createSession(),
        editingMessageId: null,
        streamStatus: 'idle',
        createMessagePending: false,
        editMessagePending: false,
        initAttachmentPending: false,
      }),
    ).toBe('ready');
  });

  it('keeps composer ready when last stream failed', () => {
    expect(
      deriveChatComposerState({
        currentSessionId: 'session_1',
        activeSession: createSession(),
        editingMessageId: null,
        streamStatus: 'error',
        createMessagePending: false,
        editMessagePending: false,
        initAttachmentPending: false,
      }),
    ).toBe('ready');
  });
});
