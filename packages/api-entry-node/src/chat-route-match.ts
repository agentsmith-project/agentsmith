export type ChatRoute =
  | { kind: 'chatSessions'; workspaceId: string; projectId: string }
  | { kind: 'chatSessionItem'; workspaceId: string; projectId: string; sessionId: string }
  | { kind: 'chatSessionStop'; workspaceId: string; projectId: string; sessionId: string }
  | { kind: 'chatSessionStreams'; workspaceId: string; projectId: string; sessionId: string }
  | { kind: 'chatMessages'; workspaceId: string; projectId: string; sessionId: string }
  | { kind: 'chatMessageItem'; workspaceId: string; projectId: string; sessionId: string; messageId: string }
  | { kind: 'chatMessagesStream'; workspaceId: string; projectId: string; sessionId: string }
  | {
    kind: 'chatMessagesStreamStop';
    workspaceId: string;
    projectId: string;
    sessionId: string;
    streamId: string;
  }
  | { kind: 'chatRegenerate'; workspaceId: string; projectId: string; sessionId: string }
  | { kind: 'chatAttachments'; workspaceId: string; projectId: string; sessionId: string }
  | { kind: 'chatAttachmentInit'; workspaceId: string; projectId: string; sessionId: string }
  | { kind: 'chatAttachmentComplete'; workspaceId: string; projectId: string; sessionId: string; attachmentId: string }
  | { kind: 'chatAttachmentItem'; workspaceId: string; projectId: string; sessionId: string; attachmentId: string }
  | { kind: 'chatAttachmentRetry'; workspaceId: string; projectId: string; sessionId: string; attachmentId: string };

export function matchChatRoute(pathname: string): ChatRoute | null {
  const chatMessagesStreamMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/messages\/stream\/?$/,
  );
  if (chatMessagesStreamMatched) {
    return {
      kind: 'chatMessagesStream',
      workspaceId: decodeURIComponent(chatMessagesStreamMatched[1]),
      projectId: decodeURIComponent(chatMessagesStreamMatched[2]),
      sessionId: decodeURIComponent(chatMessagesStreamMatched[3]),
    };
  }

  const chatMessagesStreamStopMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/messages\/streams\/([^/]+)\/stop\/?$/,
  );
  if (chatMessagesStreamStopMatched) {
    return {
      kind: 'chatMessagesStreamStop',
      workspaceId: decodeURIComponent(chatMessagesStreamStopMatched[1]),
      projectId: decodeURIComponent(chatMessagesStreamStopMatched[2]),
      sessionId: decodeURIComponent(chatMessagesStreamStopMatched[3]),
      streamId: decodeURIComponent(chatMessagesStreamStopMatched[4]),
    };
  }

  const chatSessionStopMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/stop\/?$/,
  );
  if (chatSessionStopMatched) {
    return {
      kind: 'chatSessionStop',
      workspaceId: decodeURIComponent(chatSessionStopMatched[1]),
      projectId: decodeURIComponent(chatSessionStopMatched[2]),
      sessionId: decodeURIComponent(chatSessionStopMatched[3]),
    };
  }

  const chatSessionStreamsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/streams\/?$/,
  );
  if (chatSessionStreamsMatched) {
    return {
      kind: 'chatSessionStreams',
      workspaceId: decodeURIComponent(chatSessionStreamsMatched[1]),
      projectId: decodeURIComponent(chatSessionStreamsMatched[2]),
      sessionId: decodeURIComponent(chatSessionStreamsMatched[3]),
    };
  }

  const chatMessageItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/messages\/([^/]+)\/?$/,
  );
  if (chatMessageItemMatched) {
    return {
      kind: 'chatMessageItem',
      workspaceId: decodeURIComponent(chatMessageItemMatched[1]),
      projectId: decodeURIComponent(chatMessageItemMatched[2]),
      sessionId: decodeURIComponent(chatMessageItemMatched[3]),
      messageId: decodeURIComponent(chatMessageItemMatched[4]),
    };
  }

  const chatMessagesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/messages\/?$/,
  );
  if (chatMessagesMatched) {
    return {
      kind: 'chatMessages',
      workspaceId: decodeURIComponent(chatMessagesMatched[1]),
      projectId: decodeURIComponent(chatMessagesMatched[2]),
      sessionId: decodeURIComponent(chatMessagesMatched[3]),
    };
  }

  const chatAttachmentRetryMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/attachments\/([^/]+)\/retry\/?$/,
  );
  if (chatAttachmentRetryMatched) {
    return {
      kind: 'chatAttachmentRetry',
      workspaceId: decodeURIComponent(chatAttachmentRetryMatched[1]),
      projectId: decodeURIComponent(chatAttachmentRetryMatched[2]),
      sessionId: decodeURIComponent(chatAttachmentRetryMatched[3]),
      attachmentId: decodeURIComponent(chatAttachmentRetryMatched[4]),
    };
  }

  const chatAttachmentCompleteMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/attachments\/([^/]+)\/complete\/?$/,
  );
  if (chatAttachmentCompleteMatched) {
    return {
      kind: 'chatAttachmentComplete',
      workspaceId: decodeURIComponent(chatAttachmentCompleteMatched[1]),
      projectId: decodeURIComponent(chatAttachmentCompleteMatched[2]),
      sessionId: decodeURIComponent(chatAttachmentCompleteMatched[3]),
      attachmentId: decodeURIComponent(chatAttachmentCompleteMatched[4]),
    };
  }

  const chatAttachmentInitMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/attachments\/init\/?$/,
  );
  if (chatAttachmentInitMatched) {
    return {
      kind: 'chatAttachmentInit',
      workspaceId: decodeURIComponent(chatAttachmentInitMatched[1]),
      projectId: decodeURIComponent(chatAttachmentInitMatched[2]),
      sessionId: decodeURIComponent(chatAttachmentInitMatched[3]),
    };
  }

  const chatAttachmentItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/attachments\/([^/]+)\/?$/,
  );
  if (chatAttachmentItemMatched) {
    return {
      kind: 'chatAttachmentItem',
      workspaceId: decodeURIComponent(chatAttachmentItemMatched[1]),
      projectId: decodeURIComponent(chatAttachmentItemMatched[2]),
      sessionId: decodeURIComponent(chatAttachmentItemMatched[3]),
      attachmentId: decodeURIComponent(chatAttachmentItemMatched[4]),
    };
  }

  const chatAttachmentsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/attachments\/?$/,
  );
  if (chatAttachmentsMatched) {
    return {
      kind: 'chatAttachments',
      workspaceId: decodeURIComponent(chatAttachmentsMatched[1]),
      projectId: decodeURIComponent(chatAttachmentsMatched[2]),
      sessionId: decodeURIComponent(chatAttachmentsMatched[3]),
    };
  }

  const chatRegenerateMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/regenerate\/?$/,
  );
  if (chatRegenerateMatched) {
    return {
      kind: 'chatRegenerate',
      workspaceId: decodeURIComponent(chatRegenerateMatched[1]),
      projectId: decodeURIComponent(chatRegenerateMatched[2]),
      sessionId: decodeURIComponent(chatRegenerateMatched[3]),
    };
  }

  const chatSessionItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/?$/,
  );
  if (chatSessionItemMatched) {
    return {
      kind: 'chatSessionItem',
      workspaceId: decodeURIComponent(chatSessionItemMatched[1]),
      projectId: decodeURIComponent(chatSessionItemMatched[2]),
      sessionId: decodeURIComponent(chatSessionItemMatched[3]),
    };
  }

  const chatSessionsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/chat\/sessions\/?$/,
  );
  if (chatSessionsMatched) {
    return {
      kind: 'chatSessions',
      workspaceId: decodeURIComponent(chatSessionsMatched[1]),
      projectId: decodeURIComponent(chatSessionsMatched[2]),
    };
  }

  return null;
}
