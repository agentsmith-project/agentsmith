import type { ChatMessage } from '@/lib/api/types';

export type VariantGroups = {
  groups: Map<string, ChatMessage[]>;
  messageToGroupId: Map<string, string>;
  groupBaseTime: Map<string, number>;
};

function parseTime(value?: string) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function buildVariantGroups(messages: ChatMessage[]): VariantGroups {
  const groups = new Map<string, ChatMessage[]>();
  const messageToGroupId = new Map<string, string>();
  const groupBaseTime = new Map<string, number>();

  const hasRevisions = new Set<string>();
  for (const m of messages) {
    if (m.revision_of) hasRevisions.add(m.revision_of);
  }

  for (const m of messages) {
    if (m.variant_group_id) {
      const key = m.variant_group_id;
      const list = groups.get(key) || [];
      list.push(m);
      groups.set(key, list);
      messageToGroupId.set(m.id, key);
      continue;
    }

    if (m.logical_id) {
      const key = m.logical_id;
      const list = groups.get(key) || [];
      list.push(m);
      groups.set(key, list);
      messageToGroupId.set(m.id, key);
      continue;
    }

    if (m.revision_of) {
      const key = `log_${m.revision_of}`;
      const list = groups.get(key) || [];
      list.push(m);
      groups.set(key, list);
      messageToGroupId.set(m.id, key);
      continue;
    }

    if (hasRevisions.has(m.id)) {
      const key = `log_${m.id}`;
      const list = groups.get(key) || [];
      list.push(m);
      groups.set(key, list);
      messageToGroupId.set(m.id, key);
    }
  }

  for (const [key, list] of groups) {
    list.sort((a, b) => {
      const ai = a.variant_index ?? a.revision_index ?? 0;
      const bi = b.variant_index ?? b.revision_index ?? 0;
      if (ai !== bi) return ai - bi;
      return parseTime(a.created_at) - parseTime(b.created_at);
    });
    groups.set(key, list);

    if (list.length > 1) {
      const base = Math.min(...list.map((m) => parseTime(m.created_at)));
      groupBaseTime.set(key, base);
    }
  }

  return { groups, messageToGroupId, groupBaseTime };
}

export function sortMessagesForDisplay(
  messages: ChatMessage[],
  groups: VariantGroups,
) {
  const { groupBaseTime, messageToGroupId } = groups;
  return [...messages].sort((a, b) => {
    const ga = messageToGroupId.get(a.id);
    const gb = messageToGroupId.get(b.id);
    const ta = ga && groupBaseTime.has(ga) ? groupBaseTime.get(ga)! : parseTime(a.created_at);
    const tb = gb && groupBaseTime.has(gb) ? groupBaseTime.get(gb)! : parseTime(b.created_at);
    if (ta !== tb) return ta - tb;
    return parseTime(a.created_at) - parseTime(b.created_at);
  });
}

export function selectVariantMessage(
  groupId: string,
  groups: VariantGroups,
  activeVariantIndexByGroup: Record<string, number>,
) {
  const list = groups.groups.get(groupId) || [];
  if (list.length === 0) return null;
  const desired = activeVariantIndexByGroup[groupId];
  const fallback = list[list.length - 1];
  return list.find((m) => (m.variant_index ?? m.revision_index ?? 0) === desired) || fallback;
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
  const leaf = leaves.sort((a, b) => parseTime(a.created_at) - parseTime(b.created_at)).pop() || validMessages[validMessages.length - 1];

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
  const list = variantGroups.groups.get(groupId) || [];
  if (list.length <= 1) return null;

  const index = list.findIndex((m) => m.id === message.id);
  const fallbackIndex = message.variant_index ?? message.revision_index ?? 0;
  return {
    groupId,
    index: index >= 0 ? index : fallbackIndex,
    total: list.length,
    list,
  };
}
