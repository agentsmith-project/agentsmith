import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/api/types';
import { buildVariantGroups } from '@/lib/chat/branch';
import type { SessionStreamState } from '@/lib/chat/stream-state';

interface UseChatVariantsArgs {
  messages: ChatMessage[];
  currentSessionId: string | null;
  streamStateBySession: Record<string, SessionStreamState>;
}

export interface UseChatVariantsResult {
  activeVariantIndexByGroup: Record<string, number>;
  suppressAutoScroll: boolean;
  onManualSelectVariant: (groupId: string, nextIndex: number) => void;
  markPendingAutoGroup: (groupId: string | null) => void;
  applyVariantFromMeta: (groupId: string | undefined, variantIndex: number | undefined) => void;
}

export function useChatVariants(args: UseChatVariantsArgs): UseChatVariantsResult {
  const { messages, currentSessionId, streamStateBySession } = args;

  const [activeVariantIndexByGroup, setActiveVariantIndexByGroup] = useState<Record<string, number>>({});
  const [suppressAutoScroll, setSuppressAutoScroll] = useState(false);
  const lastVariantTailRef = useRef<Map<string, string>>(new Map());
  const manualVariantGroupsRef = useRef<Set<string>>(new Set());
  const pendingAutoGroupRef = useRef<string | null>(null);
  const suppressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    manualVariantGroupsRef.current.clear();
    pendingAutoGroupRef.current = null;
    lastVariantTailRef.current = new Map();
    setSuppressAutoScroll(false);
    if (suppressTimerRef.current) {
      window.clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (messages.length === 0) return;
    const status = currentSessionId ? (streamStateBySession[currentSessionId]?.status ?? 'idle') : 'idle';
    if (status !== 'idle') return;
    const groups = buildVariantGroups(messages);
    const nextMap = new Map(lastVariantTailRef.current);
    const updates: Record<string, number> = {};

    for (const [groupId, group] of groups.groups.entries()) {
      if (group.items.length === 0) continue;
      const last = group.items[group.items.length - 1];
      const lastId = last.id;
      const prevId = lastVariantTailRef.current.get(groupId);
      nextMap.set(groupId, lastId);

      const shouldAuto =
        pendingAutoGroupRef.current === groupId ||
        !manualVariantGroupsRef.current.has(groupId);

      if (
        shouldAuto &&
        (!Object.prototype.hasOwnProperty.call(activeVariantIndexByGroup, groupId) || (prevId && prevId !== lastId))
      ) {
        const idx = last.variant_index ?? last.revision_index ?? group.items.length - 1;
        updates[groupId] = idx;
      }
    }

    if (Object.keys(updates).length > 0) {
      setActiveVariantIndexByGroup((prev) => ({ ...prev, ...updates }));
    }
    if (pendingAutoGroupRef.current) pendingAutoGroupRef.current = null;
    lastVariantTailRef.current = nextMap;
  }, [messages, activeVariantIndexByGroup, currentSessionId, streamStateBySession]);

  const onManualSelectVariant = (groupId: string, nextIndex: number) => {
    manualVariantGroupsRef.current.add(groupId);
    setSuppressAutoScroll(true);
    if (suppressTimerRef.current) {
      window.clearTimeout(suppressTimerRef.current);
    }
    suppressTimerRef.current = window.setTimeout(() => setSuppressAutoScroll(false), 1500);
    setActiveVariantIndexByGroup((prev) => ({ ...prev, [groupId]: nextIndex }));
  };

  const markPendingAutoGroup = (groupId: string | null) => {
    pendingAutoGroupRef.current = groupId;
  };

  const applyVariantFromMeta = (groupId: string | undefined, variantIndex: number | undefined) => {
    if (!groupId || typeof variantIndex !== 'number') {
      return;
    }
    setActiveVariantIndexByGroup((prev) => ({ ...prev, [groupId]: variantIndex }));
  };

  return {
    activeVariantIndexByGroup,
    suppressAutoScroll,
    onManualSelectVariant,
    markPendingAutoGroup,
    applyVariantFromMeta,
  };
}
