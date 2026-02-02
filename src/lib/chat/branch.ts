import type { ChatMessage } from '@/lib/api/types';

export type VariantGroup = {
  id: string;
  kind: 'assistant' | 'user';
  items: ChatMessage[];
};

export type VariantGroups = {
  groups: Map<string, VariantGroup>;
  messageToGroupId: Map<string, string>;
  groupBaseTime: Map<string, number>;
};

function parseTime(value?: string) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function groupSortKey(message: ChatMessage) {
  return message.variant_index ?? message.revision_index ?? 0;
}

function resolveGroupId(message: ChatMessage, hasRevisions: Set<string>) {
  if (message.variant_group_id) return { id: message.variant_group_id, kind: 'assistant' as const };
  if (message.logical_id) return { id: message.logical_id, kind: 'user' as const };
  if (message.revision_of) return { id: `log_${message.revision_of}`, kind: 'user' as const };
  if (hasRevisions.has(message.id)) return { id: `log_${message.id}`, kind: 'user' as const };
  if (message.role === 'assistant' && message.parent_id) {
    return { id: `asst_${message.parent_id}`, kind: 'assistant' as const };
  }
  return null;
}

export function buildVariantGroups(messages: ChatMessage[]): VariantGroups {
  const groups = new Map<string, VariantGroup>();
  const messageToGroupId = new Map<string, string>();
  const groupBaseTime = new Map<string, number>();

  const hasRevisions = new Set<string>();
  for (const m of messages) {
    if (m.revision_of) hasRevisions.add(m.revision_of);
  }

  for (const m of messages) {
    const groupMeta = resolveGroupId(m, hasRevisions);
    if (!groupMeta) continue;
    const existing = groups.get(groupMeta.id) || { id: groupMeta.id, kind: groupMeta.kind, items: [] };
    existing.items.push(m);
    groups.set(groupMeta.id, existing);
    messageToGroupId.set(m.id, groupMeta.id);
  }

  for (const [key, group] of groups) {
    group.items.sort((a, b) => {
      const ai = groupSortKey(a);
      const bi = groupSortKey(b);
      if (ai !== bi) return ai - bi;
      return parseTime(a.created_at) - parseTime(b.created_at);
    });
    groups.set(key, group);

    if (group.items.length > 1) {
      const base = Math.min(...group.items.map((m) => parseTime(m.created_at)));
      groupBaseTime.set(key, base);
    }
  }

  return { groups, messageToGroupId, groupBaseTime };
}

export function selectVariantMessage(
  groupId: string,
  groups: VariantGroups,
  activeVariantIndexByGroup: Record<string, number>,
) {
  const group = groups.groups.get(groupId);
  if (!group || group.items.length === 0) return null;
  const desired = activeVariantIndexByGroup[groupId];
  const fallback = group.items[group.items.length - 1];
  return group.items.find((m) => groupSortKey(m) === desired) || fallback;
}

export function getGroupIdForMessageId(
  groups: VariantGroups,
  messageId: string,
): string | null {
  return groups.messageToGroupId.get(messageId) ?? null;
}

export function buildBranchBadgesForChain(
  chain: ChatMessage[],
  groups: VariantGroups,
  activeVariantIndexByGroup: Record<string, number>,
) {
  const byId = new Map(chain.map((m) => [m.id, m]));
  const badges = new Map<string, { groupId: string; index: number; total: number }>();

  for (const msg of chain) {
    let cursor: ChatMessage | undefined = msg;
    let badge: { groupId: string; index: number; total: number } | null = null;
    while (cursor) {
      const gid = groups.messageToGroupId.get(cursor.id);
      if (gid) {
        const group = groups.groups.get(gid);
        if (group && group.items.length > 1) {
          const selected = selectVariantMessage(gid, groups, activeVariantIndexByGroup);
          const selectedIndex = selected
            ? group.items.findIndex((m) => m.id === selected.id)
            : 0;
          badge = {
            groupId: gid,
            index: Math.max(0, selectedIndex),
            total: group.items.length,
          };
          break;
        }
      }
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
    }
    if (badge) badges.set(msg.id, badge);
  }

  return badges;
}

export function buildVisibleChain(
  messages: ChatMessage[],
  groups: VariantGroups,
  activeVariantIndexByGroup: Record<string, number>,
) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const selectedByGroup = new Map<string, ChatMessage>();

  for (const groupId of groups.groups.keys()) {
    const selected = selectVariantMessage(groupId, groups, activeVariantIndexByGroup);
    if (selected) selectedByGroup.set(groupId, selected);
  }

  const isSelectedInGroup = (message: ChatMessage) => {
    const gid = groups.messageToGroupId.get(message.id);
    if (!gid) return true;
    const selected = selectedByGroup.get(gid);
    return selected ? selected.id === message.id : true;
  };

  const isValid = (message: ChatMessage) => {
    if (message.is_stale) return false;
    if (!isSelectedInGroup(message)) return false;
    let cur = message.parent_id ? byId.get(message.parent_id) : undefined;
    while (cur) {
      if (cur.is_stale) return false;
      if (!isSelectedInGroup(cur)) return false;
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return true;
  };

  const validMessages = messages.filter(isValid);
  if (validMessages.length === 0) {
    return { chain: [] as ChatMessage[], selectedByGroup };
  }

  const childrenMap = new Map<string, string[]>();
  for (const m of validMessages) {
    if (!m.parent_id) continue;
    const list = childrenMap.get(m.parent_id) || [];
    list.push(m.id);
    childrenMap.set(m.parent_id, list);
  }

  const isLeaf = (m: ChatMessage) => !(childrenMap.get(m.id) || []).length;
  const leaves = validMessages.filter(isLeaf);
  const leaf =
    leaves.sort((a, b) => parseTime(a.created_at) - parseTime(b.created_at)).pop() ||
    validMessages[validMessages.length - 1];

  const chain: ChatMessage[] = [];
  let cursor: ChatMessage | undefined = leaf;
  while (cursor) {
    chain.push(cursor);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  chain.reverse();

  return { chain, selectedByGroup };
}

export function getVariantMeta(
  message: ChatMessage,
  variantGroups: VariantGroups,
) {
  const groupId = variantGroups.messageToGroupId.get(message.id);
  if (!groupId) return null;
  const group = variantGroups.groups.get(groupId);
  if (!group || group.items.length <= 1) return null;

  const index = group.items.findIndex((m) => m.id === message.id);
  const fallbackIndex = groupSortKey(message);
  return {
    groupId,
    index: index >= 0 ? index : fallbackIndex,
    total: group.items.length,
    list: group.items,
  };
}
