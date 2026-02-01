import type { ChatMessage } from '@/lib/api/types';

export function sortMessagesByTime(messages: ChatMessage[]) {
  return [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function groupAssistantVariants(messages: ChatMessage[]) {
  const groups = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    if (!m.variant_group_id) continue;
    const list = groups.get(m.variant_group_id) || [];
    list.push(m);
    groups.set(m.variant_group_id, list);
  }
  for (const [k, list] of groups) {
    list.sort((a, b) => (a.variant_index ?? 0) - (b.variant_index ?? 0));
    groups.set(k, list);
  }
  return groups;
}

export function getVariantMeta(
  message: ChatMessage,
  variantGroups: Map<string, ChatMessage[]>,
) {
  if (message.role !== 'assistant' || !message.variant_group_id) return null;
  const list = variantGroups.get(message.variant_group_id) || [];
  if (list.length <= 1) return null;

  const index = list.findIndex((m) => m.id === message.id);
  return {
    groupId: message.variant_group_id,
    index: index >= 0 ? index : (message.variant_index ?? 0),
    total: list.length,
    list,
  };
}

