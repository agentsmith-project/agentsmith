import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageList } from '@/components/chat/MessageList';
import type { ChatMessage } from '@/lib/api/types';

function createMessage(id: string, role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    id,
    session_id: 's_1',
    role,
    content,
    created_at: new Date().toISOString(),
  };
}

describe('MessageList', () => {
  it('does not violate hook order when transitioning from empty to non-empty', () => {
    const { rerender } = render(
      <MessageList
        messages={[]}
        activeVariantIndexByGroup={{}}
        editingMessageId={null}
        onSelectVariant={vi.fn()}
        onEdit={vi.fn()}
        onEditCommit={vi.fn()}
        onEditCancel={vi.fn()}
        onRegenerate={vi.fn()}
        disabled={false}
      />,
    );

    expect(() =>
      rerender(
        <MessageList
          messages={[createMessage('m_user_1', 'user', 'hello')]}
          activeVariantIndexByGroup={{}}
          editingMessageId={null}
          onSelectVariant={vi.fn()}
          onEdit={vi.fn()}
          onEditCommit={vi.fn()}
          onEditCancel={vi.fn()}
          onRegenerate={vi.fn()}
          disabled={false}
        />,
      ),
    ).not.toThrow();
  });
});
