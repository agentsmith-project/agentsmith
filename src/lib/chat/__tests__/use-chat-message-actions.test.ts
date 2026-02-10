import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChatMessageActions } from '@/lib/chat/use-chat-message-actions';
import type { ChatMessage, ChatSession } from '@/lib/api/types';

describe('useChatMessageActions', () => {
  it('passes displayMessageId when regenerating assistant message (replace mode)', async () => {
    const runStream = vi.fn().mockResolvedValue(undefined);
    const markPendingAutoGroup = vi.fn();

    const session: ChatSession = {
      id: 's_1',
      project_id: 'p_1',
      title: 't',
      model: 'm',
      endpoint_id: 'ep_1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      message_count: 0,
      total_tokens: 0,
    };

    const msg: ChatMessage = {
      id: 'm_asst_1',
      session_id: 's_1',
      role: 'assistant',
      content: 'old',
      created_at: new Date().toISOString(),
      parent_id: 'm_user_1',
      variant_group_id: 'vg_1',
      variant_index: 0,
    };

    const { result } = renderHook(() =>
      useChatMessageActions({
        canUseChat: true,
        disabled: false,
        currentSessionId: 's_1',
        activeSession: session,
        messages: [msg],
        activeVariantIndexByGroup: {},
        setEditingMessageId: vi.fn(),
        editMessage: vi.fn(),
        upsertStreamAssistantToCache: vi.fn(),
        applyVariantFromMeta: vi.fn(),
        markPendingAutoGroup,
        runStream,
      }),
    );

    await result.current.onRegenerate(msg);

    expect(runStream).toHaveBeenCalledWith({
      sessionId: 's_1',
      model: 'm',
      endpointId: 'ep_1',
      fromMessageId: 'm_asst_1',
      displayMessageId: 'm_asst_1',
      mode: 'replace',
    });
  });
});
