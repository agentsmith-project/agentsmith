export function chatSessionsKey(workspaceId: string, projectId: string): readonly unknown[] {
  return ['chat', 'sessions', workspaceId, projectId] as const;
}

export function chatMessagesKey(
  workspaceId: string,
  projectId: string,
  sessionId: string,
): readonly unknown[] {
  return ['chat', 'messages', workspaceId, projectId, sessionId] as const;
}

export function chatAttachmentsKey(
  workspaceId: string,
  projectId: string,
  sessionId: string,
): readonly unknown[] {
  return ['chat', 'attachments', workspaceId, projectId, sessionId] as const;
}
