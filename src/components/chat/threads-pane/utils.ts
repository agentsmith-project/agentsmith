import type { ChatSession } from '@/lib/api/types';

export function sortSessions(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => {
    if ((a.starred ? 1 : 0) !== (b.starred ? 1 : 0)) return (b.starred ? 1 : 0) - (a.starred ? 1 : 0);
    if ((a.pinned ? 1 : 0) !== (b.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export function filterSessions(sessions: ChatSession[], searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  const sorted = sortSessions(sessions);
  if (!query) return sorted;
  return sorted.filter((session) => (session.title || '').toLowerCase().includes(query));
}

export function countGeneratingSessions(streamingSessionIds: string[]) {
  return new Set(streamingSessionIds).size;
}
