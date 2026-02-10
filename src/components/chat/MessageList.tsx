'use client';

import * as React from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useTranslations } from 'next-intl';

import type { ChatMessage } from '@/lib/api/types';
import { buildVariantGroups, buildVisibleChain, buildBranchBadgesForChain } from '@/lib/chat/branch';
import { getChatContentWidthClass, type ChatLayoutMode } from '@/lib/chat/layout';
import { cn } from '@/lib/utils';

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
  followOutput = true,
  suppressAutoScroll = false,
  disabled,
  layoutMode = 'standard',
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
  streamingAssistant?: {
    messageId?: string | null;
    content: string;
    mode: 'append' | 'replace';
    startedAt: number;
    lastTokenAt: number;
  } | null;
  followOutput?: boolean;
  suppressAutoScroll?: boolean;
  disabled: boolean;
  layoutMode?: ChatLayoutMode;
}) {
  const t = useTranslations('chat');
  const groups = React.useMemo(() => buildVariantGroups(messages), [messages]);
  const { chain } = React.useMemo(
    () => buildVisibleChain(messages, groups, activeVariantIndexByGroup),
    [messages, groups, activeVariantIndexByGroup],
  );
  const branchBadges = React.useMemo(
    () => buildBranchBadgesForChain(chain, groups, activeVariantIndexByGroup),
    [chain, groups, activeVariantIndexByGroup],
  );

  const virtuosoRef = React.useRef<import('react-virtuoso').VirtuosoHandle>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);
  const showJump = !isAtBottom;

  if (chain.length === 0) {
    return (
        <div className="h-full flex items-center justify-center px-6">
        <div className="text-tertiary text-sm">{t('message_list.empty')}</div>
        </div>
      );
  }

  const shouldFollow = followOutput && isAtBottom && !suppressAutoScroll;
  const contentWidthClass = getChatContentWidthClass(layoutMode);

  return (
    <div className="h-full relative">
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: '100%' }}
        data={chain}
        followOutput={shouldFollow ? 'smooth' : false}
        computeItemKey={(_index, item) => item.id}
        atBottomStateChange={setIsAtBottom}
        itemContent={(_idx, m) => (
          <div className="px-3 py-2 sm:px-4">
            <div className={cn('mx-auto w-full', contentWidthClass)}>
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
                streamingMeta={
                  streamingAssistant && streamingAssistant.mode === 'replace' && streamingAssistant.messageId === m.id
                    ? { startedAt: streamingAssistant.startedAt, lastTokenAt: streamingAssistant.lastTokenAt }
                    : null
                }
                branchBadge={branchBadges.get(m.id) || null}
                disabled={disabled}
                layoutMode={layoutMode}
              />
            </div>
          </div>
        )}
        components={{
          Footer: () => (
            <div className="px-3 pb-4 sm:px-4">
              <div className={cn('mx-auto w-full', contentWidthClass)}>{footer}</div>
            </div>
          ),
        }}
      />

      {showJump && (
        <button
          type="button"
          onClick={() => {
            virtuosoRef.current?.scrollToIndex({ index: chain.length - 1, align: 'end', behavior: 'smooth' });
          }}
          className="absolute bottom-5 right-5 px-3 py-1.5 text-xs rounded-sm border border-subtle bg-surface-high text-primary hover:bg-hover transition-colors"
        >
          {t('message_list.jump_to_latest')}
        </button>
      )}
    </div>
  );
}
