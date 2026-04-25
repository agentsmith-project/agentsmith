import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type React from 'react';
import type { Attachment, ChatSession } from '@/lib/api/types';
import { useChatComposerActions } from '@/lib/chat/use-chat-composer-actions';

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

function createAttachment(overrides?: Partial<Attachment>): Attachment {
  return {
    id: 'att_1',
    session_id: 'session_1',
    file_name: 'test.txt',
    file_type: 'text/plain',
    file_size: 10,
    upload_status: 'ready',
    created_at: new Date().toISOString(),
    input_ref: {
      kind: 'library_object',
      library_id: 'lib_1',
      key: 'chat/session_1/uploads/test.txt',
      name: 'test.txt',
      content_type: 'text/plain',
      size_bytes: 10,
    },
    ...overrides,
  };
}

describe('useChatComposerActions', () => {
  it('sends message and forwards ready input refs to stream input', async () => {
    const createMessage = vi.fn().mockResolvedValue({ id: 'm_user_1' });
    const runStream = vi.fn().mockResolvedValue(undefined);
    const setComposerBySession = vi.fn();

    const { result } = renderHook(() =>
      useChatComposerActions({
        canUseChat: true,
        currentSessionId: 'session_1',
        activeSession: createSession(),
        composerBySession: { session_1: 'hello' },
        setComposerBySession,
        attachments: [createAttachment()],
        editingMessageId: null,
        visibleLeafId: 'parent_1',
        createMessage,
        runStream,
        initAttachment: vi.fn(),
        fileInputRef: { current: null },
      }),
    );

    await result.current.handleSend();

    expect(createMessage).toHaveBeenCalledWith({
      sessionId: 'session_1',
      content: 'hello',
      inputs: [{
        kind: 'library_object',
        library_id: 'lib_1',
        key: 'chat/session_1/uploads/test.txt',
        name: 'test.txt',
        content_type: 'text/plain',
        size_bytes: 10,
      }],
      parent_id: 'parent_1',
    });
    expect(runStream).toHaveBeenCalledWith({
      sessionId: 'session_1',
      model: 'gpt-4o',
      endpointId: 'ep_1',
      branchLeafMessageId: 'm_user_1',
      input: {
        role: 'user',
        content: 'hello',
        inputs: [{
          kind: 'library_object',
          library_id: 'lib_1',
          key: 'chat/session_1/uploads/test.txt',
          name: 'test.txt',
          content_type: 'text/plain',
          size_bytes: 10,
        }],
      },
      mode: 'append',
    });
    expect(setComposerBySession).toHaveBeenCalled();
  });

  it('uses the latest resolved session target when the visible activeSession prop is stale', async () => {
    const createMessage = vi.fn().mockResolvedValue({ id: 'm_user_1' });
    const runStream = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useChatComposerActions({
        canUseChat: true,
        currentSessionId: 'session_1',
        activeSession: createSession({ endpoint_id: 'ep_1', model: 'gpt-4o' }),
        resolveSessionForSend: () => createSession({ endpoint_id: 'ep_2', model: 'claude-3-7-sonnet' }),
        composerBySession: { session_1: 'hello' },
        setComposerBySession: vi.fn(),
        attachments: [],
        editingMessageId: null,
        visibleLeafId: null,
        createMessage,
        runStream,
        initAttachment: vi.fn(),
        fileInputRef: { current: null },
      }),
    );

    await result.current.handleSend();

    expect(runStream).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session_1',
      model: 'claude-3-7-sonnet',
      endpointId: 'ep_2',
    }));
  });

  it('does not send while backend truth still marks the session stream as active', async () => {
    const createMessage = vi.fn();
    const runStream = vi.fn();

    const { result } = renderHook(() =>
      useChatComposerActions({
        canUseChat: true,
        disabled: true,
        currentSessionId: 'session_1',
        activeSession: createSession(),
        composerBySession: { session_1: 'hello' },
        setComposerBySession: vi.fn(),
        attachments: [],
        editingMessageId: null,
        visibleLeafId: null,
        createMessage,
        runStream,
        initAttachment: vi.fn(),
        fileInputRef: { current: null },
      }),
    );

    await result.current.handleSend();

    expect(createMessage).not.toHaveBeenCalled();
    expect(runStream).not.toHaveBeenCalled();
  });

  it('does not send while any attachment is non-ready', async () => {
    const createMessage = vi.fn();
    const runStream = vi.fn();

    const { result } = renderHook(() =>
      useChatComposerActions({
        canUseChat: true,
        currentSessionId: 'session_1',
        activeSession: createSession(),
        composerBySession: { session_1: 'hello' },
        setComposerBySession: vi.fn(),
        attachments: [createAttachment({ upload_status: 'uploading' })],
        editingMessageId: null,
        visibleLeafId: null,
        createMessage,
        runStream,
        initAttachment: vi.fn(),
        fileInputRef: { current: null },
      }),
    );

    await result.current.handleSend();

    expect(createMessage).not.toHaveBeenCalled();
    expect(runStream).not.toHaveBeenCalled();
  });

  it('does not send when ready attachments are missing input_ref', async () => {
    const createMessage = vi.fn();
    const runStream = vi.fn();

    const { result } = renderHook(() =>
      useChatComposerActions({
        canUseChat: true,
        currentSessionId: 'session_1',
        activeSession: createSession(),
        composerBySession: { session_1: 'hello' },
        setComposerBySession: vi.fn(),
        attachments: [createAttachment({ input_ref: undefined })],
        editingMessageId: null,
        visibleLeafId: null,
        createMessage,
        runStream,
        initAttachment: vi.fn(),
        fileInputRef: { current: null },
      }),
    );

    await result.current.handleSend();

    expect(createMessage).not.toHaveBeenCalled();
    expect(runStream).not.toHaveBeenCalled();
  });

  it('does not send when active session has no endpoint binding', async () => {
    const createMessage = vi.fn();
    const runStream = vi.fn();

    const { result } = renderHook(() =>
      useChatComposerActions({
        canUseChat: true,
        currentSessionId: 'session_1',
        activeSession: createSession({ endpoint_id: '' }),
        composerBySession: { session_1: 'hello' },
        setComposerBySession: vi.fn(),
        attachments: [],
        editingMessageId: null,
        visibleLeafId: null,
        createMessage,
        runStream,
        initAttachment: vi.fn(),
        fileInputRef: { current: null },
      }),
    );

    await result.current.handleSend();

    expect(createMessage).not.toHaveBeenCalled();
    expect(runStream).not.toHaveBeenCalled();
  });

  it('initializes attachments for all picked files', async () => {
    const initAttachment = vi.fn().mockResolvedValue(undefined);
    const fileA = new File(['a'], 'a.txt', { type: 'text/plain' });
    const fileB = new File(['b'], 'b.txt', { type: 'text/plain' });

    const { result } = renderHook(() =>
      useChatComposerActions({
        canUseChat: true,
        currentSessionId: 'session_1',
        activeSession: createSession(),
        composerBySession: { session_1: '' },
        setComposerBySession: vi.fn(),
        attachments: [],
        editingMessageId: null,
        visibleLeafId: null,
        createMessage: vi.fn(),
        runStream: vi.fn(),
        initAttachment,
        fileInputRef: { current: null },
      }),
    );

    const event = {
      target: {
        files: [fileA, fileB],
        value: 'x',
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await result.current.onFilePicked(event);

    expect(initAttachment).toHaveBeenCalledTimes(2);
    expect(initAttachment).toHaveBeenNthCalledWith(1, { sessionId: 'session_1', file: fileA });
    expect(initAttachment).toHaveBeenNthCalledWith(2, { sessionId: 'session_1', file: fileB });
    expect(event.target.value).toBe('');
  });

  it('initializes attachments for externally attached files', async () => {
    const initAttachment = vi.fn().mockResolvedValue(undefined);
    const fileA = new File(['a'], 'a.txt', { type: 'text/plain' });
    const fileB = new File(['b'], 'b.txt', { type: 'text/plain' });

    const { result } = renderHook(() =>
      useChatComposerActions({
        canUseChat: true,
        currentSessionId: 'session_1',
        activeSession: createSession(),
        composerBySession: { session_1: '' },
        setComposerBySession: vi.fn(),
        attachments: [],
        editingMessageId: null,
        visibleLeafId: null,
        createMessage: vi.fn(),
        runStream: vi.fn(),
        initAttachment,
        fileInputRef: { current: null },
      }),
    );

    await result.current.onAttachFiles([fileA, fileB]);

    expect(initAttachment).toHaveBeenCalledTimes(2);
    expect(initAttachment).toHaveBeenNthCalledWith(1, { sessionId: 'session_1', file: fileA });
    expect(initAttachment).toHaveBeenNthCalledWith(2, { sessionId: 'session_1', file: fileB });
  });
});
