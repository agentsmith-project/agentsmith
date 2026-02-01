'use client';

import * as React from 'react';
import { Virtuoso } from 'react-virtuoso';

import type { ChatMessage } from '@/lib/api/types';
import { groupAssistantVariants, sortMessagesByTime } from '@/lib/chat/branch';

import { MessageItem } from './MessageItem';

function filterByVariants(messages: ChatMessage[], activeVariantIndexByGroup: Record<string, number>) {
  const groups = groupAssistantVariants(messages);
  const result: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.variant_group_id) {
      result.push(m);
      continue;
    }
    const list = groups.get(m.variant_group_id) || [];
    if (list.length <= 1) {
      result.push(m);
      continue;
    }
    const desired = activeVariantIndexByGroup[m.variant_group_id];
    const fallback = list[list.length - 1];
    const chosen = list.find((x) => (x.variant_index ?? 0) === desired) || fallback;
    if (m.id === chosen.id) result.push(m);
  }
  return { items: result, groups };
}

export function MessageList({
  messages,
  activeVariantIndexByGroup,
  onSelectVariant,
  onEdit,
  onRegenerate,
  footer,
  disabled,
}: {
  messages: ChatMessage[];
  activeVariantIndexByGroup: Record<string, number>;
  onSelectVariant: (groupId: string, nextIndex: number) => void;
  onEdit: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
  footer?: React.ReactNode;
  disabled: boolean;
}) {
  const ordered = React.useMemo(() => sortMessagesByTime(messages), [messages]);
  const { items, groups } = React.useMemo(
    () => filterByVariants(ordered, activeVariantIndexByGroup),
    [ordered, activeVariantIndexByGroup],
  );

  if (items.length === 0) {
    return <div className="text-tertiary text-sm px-4 py-6">Start a conversation…</div>;
  }

  return (
    <Virtuoso
      style={{ height: '100%' }}
      data={items}
      followOutput="smooth"
      itemContent={(_idx, m) => (
        <div className="px-4 py-2">
          <MessageItem
            message={m}
            variantGroups={groups}
            activeVariantIndexByGroup={activeVariantIndexByGroup}
            onSelectVariant={onSelectVariant}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
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

