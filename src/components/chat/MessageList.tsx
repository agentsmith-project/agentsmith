'use client';

import * as React from 'react';
import { Virtuoso } from 'react-virtuoso';

import type { ChatMessage } from '@/lib/api/types';
import { buildVariantGroups, buildVisibleChain } from '@/lib/chat/branch';

import { MessageItem } from './MessageItem';

export function MessageList({
  messages,
  activeVariantIndexByGroup,
  editingMessageId,
  onSelectVariant,
  onEdit,
  onEditCommit,
  onEditCancel,
  onRegenerate,
  footer,
  streamingAssistant,
  disabled,
}: {
  messages: ChatMessage[];
  activeVariantIndexByGroup: Record<string, number>;
  editingMessageId: string | null;
  onSelectVariant: (groupId: string, nextIndex: number) => void;
  onEdit: (message: ChatMessage) => void;
  onEditCommit: (message: ChatMessage, nextContent: string) => void;
  onEditCancel: () => void;
  onRegenerate: (message: ChatMessage) => void;
  footer?: React.ReactNode;
  streamingAssistant?: { messageId?: string | null; content: string; mode: 'append' | 'replace' } | null;
  disabled: boolean;
}) {
  const groups = React.useMemo(() => buildVariantGroups(messages), [messages]);
  const { chain } = React.useMemo(
    () => buildVisibleChain(messages, groups, activeVariantIndexByGroup),
    [messages, groups, activeVariantIndexByGroup],
  );

  if (chain.length === 0) {
    return <div className="text-tertiary text-sm px-4 py-6">Start a conversation…</div>;
  }

  return (
    <Virtuoso
      style={{ height: '100%' }}
      data={chain}
      followOutput="smooth"
      itemContent={(_idx, m) => (
        <div className="px-4 py-2">
          <MessageItem
            message={m}
            variantGroups={groups}
            activeVariantIndexByGroup={activeVariantIndexByGroup}
            onSelectVariant={onSelectVariant}
            onEdit={onEdit}
            onEditCommit={onEditCommit}
            onEditCancel={onEditCancel}
            isEditing={editingMessageId === m.id}
            onRegenerate={onRegenerate}
            streamingOverride={
              streamingAssistant && streamingAssistant.mode === 'replace' && streamingAssistant.messageId === m.id
                ? streamingAssistant.content
                : null
            }
            disabled={disabled}
          />
        </div>
      )}
      components={{
        Footer: () => <div className="pb-4">{footer}</div>,
      }}
    />
  );
}
