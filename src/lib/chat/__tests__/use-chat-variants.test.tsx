import { renderHook, waitFor } from '@testing-library/react';
import { useChatVariants } from '@/lib/chat/use-chat-variants';
import type { ChatMessage } from '@/lib/api/types';
import type { SessionStreamState } from '@/lib/chat/stream-state';

describe('useChatVariants', () => {
  it('does not loop when streaming replace meta is present (regression: maximum update depth)', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        session_id: 's1',
        role: 'user',
        content: 'hi',
        created_at: new Date().toISOString(),
        finish_reason: 'stop',
        parent_id: undefined,
        tokens: undefined,
        variant_group_id: undefined,
        variant_index: undefined,
        revision_index: undefined,
        logical_id: 'm1',
      },
    ];

    const streamStateBySession: Record<string, SessionStreamState> = {
      s1: {
        status: 'streaming',
        assistant: {
          mode: 'replace',
          content: '',
          startedAt: Date.now(),
          lastTokenAt: Date.now(),
          variantGroupId: 'g1',
          variantIndex: 2,
        },
      },
    };

    const { result } = renderHook(() =>
      useChatVariants({
        messages,
        currentSessionId: 's1',
        streamStateBySession,
      }),
    );

    await waitFor(() => {
      expect(result.current.activeVariantIndexByGroup.g1).toBe(2);
    });
  });
});
