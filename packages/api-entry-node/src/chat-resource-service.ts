import type { JsonDocStorePort } from '@mbos/ports';
import type {
  ChatAttachmentRecord,
  ChatAttachmentSnapshotRecord,
  ChatMessageRecord,
  ChatSessionRecord,
} from './resource-models.js';

export class ChatResourceService {
  private static readonly sessionsCollection = 'chat_sessions';
  private static readonly messagesCollection = 'chat_messages';
  private static readonly attachmentsCollection = 'chat_attachments';

  constructor(private readonly docStore: JsonDocStorePort) {}

  private sessionId(): string {
    return `chat_sess_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  private messageId(): string {
    return `chat_msg_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  private attachmentId(): string {
    return `chat_att_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  async listSessions(workspaceId: string, projectId: string): Promise<ChatSessionRecord[]> {
    const items = await this.docStore.list<ChatSessionRecord>(ChatResourceService.sessionsCollection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getSession(
    workspaceId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ChatSessionRecord | null> {
    const session = await this.docStore.get<ChatSessionRecord>(ChatResourceService.sessionsCollection, sessionId);
    if (!session) {
      return null;
    }
    if (session.workspace_id !== workspaceId || session.project_id !== projectId) {
      return null;
    }
    return session;
  }

  async createSession(input: {
    workspaceId: string;
    projectId: string;
    model: string;
    endpointId: string;
    externalAgentId?: string;
    title?: string;
  }): Promise<ChatSessionRecord> {
    const now = new Date().toISOString();
    const session: ChatSessionRecord = {
      id: this.sessionId(),
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      title: input.title?.trim() || 'New Chat',
      model: input.model,
      endpoint_id: input.endpointId,
      external_agent_id: input.externalAgentId,
      pinned: false,
      starred: false,
      created_at: now,
      updated_at: now,
      message_count: 0,
      total_tokens: 0,
    };
    await this.docStore.upsert(ChatResourceService.sessionsCollection, session.id, session);
    return session;
  }

  async updateSession(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    patch: Partial<ChatSessionRecord>,
  ): Promise<ChatSessionRecord | null> {
    const existing = await this.getSession(workspaceId, projectId, sessionId);
    if (!existing) return null;
    const next: ChatSessionRecord = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    await this.docStore.upsert(ChatResourceService.sessionsCollection, sessionId, next);
    return next;
  }

  async deleteSession(workspaceId: string, projectId: string, sessionId: string): Promise<boolean> {
    const existing = await this.getSession(workspaceId, projectId, sessionId);
    if (!existing) return false;
    await this.docStore.delete(ChatResourceService.sessionsCollection, sessionId);
    const messages = await this.listMessages(workspaceId, projectId, sessionId);
    for (const message of messages) {
      await this.docStore.delete(ChatResourceService.messagesCollection, message.id);
    }
    const attachments = await this.listAttachments(workspaceId, projectId, sessionId);
    for (const attachment of attachments) {
      await this.docStore.delete(ChatResourceService.attachmentsCollection, attachment.id);
    }
    return true;
  }

  async listMessages(
    workspaceId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ChatMessageRecord[]> {
    const items = await this.docStore.list<ChatMessageRecord>(ChatResourceService.messagesCollection, {
      workspace_id: workspaceId,
      project_id: projectId,
      session_id: sessionId,
    });
    return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async createMessage(input: {
    workspaceId: string;
    projectId: string;
    sessionId: string;
    role: ChatMessageRecord['role'];
    content: string;
    tokens?: number;
    finishReason?: string | null;
    messageStatus?: ChatMessageRecord['message_status'];
    errorCode?: string | null;
    errorMessage?: string | null;
    parentId?: string | null;
    logicalId?: string;
    revisionOf?: string | null;
    revisionIndex?: number;
    variantGroupId?: string;
    variantIndex?: number;
    isStale?: boolean;
    attachmentSnapshots?: ChatAttachmentSnapshotRecord[];
  }): Promise<ChatMessageRecord> {
    const now = new Date().toISOString();
    const generatedId = this.messageId();
    const resolvedLogicalId =
      input.role === 'user'
        ? input.logicalId ?? (input.revisionOf ? `log_${input.revisionOf}` : `log_${generatedId}`)
        : input.logicalId;
    const resolvedRevisionIndex =
      input.role === 'user' ? input.revisionIndex ?? (input.revisionOf ? 1 : 0) : input.revisionIndex;
    const message: ChatMessageRecord = {
      id: generatedId,
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      session_id: input.sessionId,
      role: input.role,
      content: input.content,
      created_at: now,
      tokens: input.tokens,
      finish_reason: input.finishReason ?? null,
      message_status: input.messageStatus,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage ?? null,
      parent_id: input.parentId ?? null,
      logical_id: resolvedLogicalId,
      revision_of: input.revisionOf ?? null,
      revision_index: resolvedRevisionIndex,
      variant_group_id: input.variantGroupId,
      variant_index: input.variantIndex,
      is_stale: input.isStale ?? false,
      attachment_snapshots: input.attachmentSnapshots,
    };
    await this.docStore.upsert(ChatResourceService.messagesCollection, message.id, message);
    const session = await this.getSession(input.workspaceId, input.projectId, input.sessionId);
    if (session) {
      await this.updateSession(input.workspaceId, input.projectId, input.sessionId, {
        message_count: session.message_count + 1,
        title:
          session.title === 'New Chat' && input.role === 'user'
            ? input.content.slice(0, 40)
            : session.title,
      });
    }
    return message;
  }

  async listAllProjectMessages(workspaceId: string, projectId: string): Promise<ChatMessageRecord[]> {
    return this.docStore.list<ChatMessageRecord>(ChatResourceService.messagesCollection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async getMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    messageId: string,
  ): Promise<ChatMessageRecord | null> {
    const message = await this.docStore.get<ChatMessageRecord>(ChatResourceService.messagesCollection, messageId);
    if (!message) {
      return null;
    }
    if (
      message.workspace_id !== workspaceId ||
      message.project_id !== projectId ||
      message.session_id !== sessionId
    ) {
      return null;
    }
    return message;
  }

  async updateMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    messageId: string,
    content: string,
  ): Promise<ChatMessageRecord | null> {
    const existing = await this.getMessage(workspaceId, projectId, sessionId, messageId);
    if (!existing) {
      return null;
    }
    if (existing.role !== 'user') {
      return null;
    }

    const allProjectMessages = await this.listAllProjectMessages(workspaceId, projectId);
    const rootMessageId = existing.revision_of ?? existing.id;
    const logicalId = existing.logical_id ?? `log_${rootMessageId}`;
    const revisionMessages = allProjectMessages.filter(
      (item) => item.session_id === sessionId && item.logical_id === logicalId,
    );
    const nextRevisionIndex =
      revisionMessages.length === 0
        ? 1
        : Math.max(...revisionMessages.map((item) => item.revision_index ?? 0)) + 1;

    const revised = await this.createMessage({
      workspaceId,
      projectId,
      sessionId,
      role: 'user',
      content,
      parentId: existing.parent_id ?? null,
      logicalId,
      revisionOf: rootMessageId,
      revisionIndex: nextRevisionIndex,
    });
    return revised;
  }

  async updateAssistantMessage(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    messageId: string,
    patch: {
      content?: string;
      finishReason?: string | null;
      tokens?: number;
      messageStatus?: ChatMessageRecord['message_status'];
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): Promise<ChatMessageRecord | null> {
    const existing = await this.getMessage(workspaceId, projectId, sessionId, messageId);
    if (!existing) {
      return null;
    }
    if (existing.role !== 'assistant') {
      return null;
    }
    const next: ChatMessageRecord = {
      ...existing,
      content: patch.content ?? existing.content,
      finish_reason: patch.finishReason === undefined ? existing.finish_reason : patch.finishReason,
      tokens: patch.tokens ?? existing.tokens,
      message_status: patch.messageStatus === undefined ? existing.message_status : patch.messageStatus,
      error_code: patch.errorCode === undefined ? existing.error_code : patch.errorCode,
      error_message: patch.errorMessage === undefined ? existing.error_message : patch.errorMessage,
    };
    await this.docStore.upsert(ChatResourceService.messagesCollection, messageId, next);
    return next;
  }

  async buildNextAssistantVariant(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    parentId: string,
    fromMessage?: ChatMessageRecord | null,
  ): Promise<{ variantGroupId: string; variantIndex: number }> {
    const allMessages = await this.listAllProjectMessages(workspaceId, projectId);
    const baseGroupId =
      fromMessage?.variant_group_id ??
      (fromMessage?.role === 'assistant' && fromMessage.parent_id
        ? `asst_${fromMessage.parent_id}`
        : `asst_${parentId}`);
    const variants = allMessages.filter(
      (item) =>
        item.session_id === sessionId &&
        item.role === 'assistant' &&
        (item.variant_group_id ?? `asst_${item.parent_id ?? ''}`) === baseGroupId,
    );
    const nextVariantIndex =
      variants.length === 0
        ? 0
        : Math.max(...variants.map((item) => item.variant_index ?? 0)) + 1;
    return { variantGroupId: baseGroupId, variantIndex: nextVariantIndex };
  }

  async listAttachments(
    workspaceId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ChatAttachmentRecord[]> {
    const items = await this.docStore.list<ChatAttachmentRecord>(ChatResourceService.attachmentsCollection, {
      workspace_id: workspaceId,
      project_id: projectId,
      session_id: sessionId,
    });
    return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async initAttachment(input: {
    workspaceId: string;
    projectId: string;
    sessionId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    sourceType?: 'local_upload' | 'library_import';
    sourceLibraryId?: string;
    sourceObjectKey?: string;
    contentBase64?: string;
    previewUrl?: string;
  }): Promise<ChatAttachmentRecord> {
    const now = new Date().toISOString();
    const attachment: ChatAttachmentRecord = {
      id: this.attachmentId(),
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      session_id: input.sessionId,
      file_name: input.fileName,
      file_type: input.fileType,
      file_size: input.fileSize,
      upload_status: 'ready',
      created_at: now,
      source_type: input.sourceType,
      source_library_id: input.sourceLibraryId,
      source_object_key: input.sourceObjectKey,
      content_base64: input.contentBase64,
      preview_url: input.previewUrl,
    };
    await this.docStore.upsert(ChatResourceService.attachmentsCollection, attachment.id, attachment);
    return attachment;
  }

  async completeAttachment(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    attachmentId: string,
  ): Promise<ChatAttachmentRecord | null> {
    const attachment = await this.docStore.get<ChatAttachmentRecord>(
      ChatResourceService.attachmentsCollection,
      attachmentId,
    );
    if (!attachment) return null;
    if (
      attachment.workspace_id !== workspaceId ||
      attachment.project_id !== projectId ||
      attachment.session_id !== sessionId
    ) {
      return null;
    }
    const updated: ChatAttachmentRecord = {
      ...attachment,
      upload_status: 'ready',
    };
    await this.docStore.upsert(ChatResourceService.attachmentsCollection, attachmentId, updated);
    return updated;
  }

  async getAttachment(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    attachmentId: string,
  ): Promise<ChatAttachmentRecord | null> {
    const attachment = await this.docStore.get<ChatAttachmentRecord>(
      ChatResourceService.attachmentsCollection,
      attachmentId,
    );
    if (!attachment) return null;
    if (
      attachment.workspace_id !== workspaceId ||
      attachment.project_id !== projectId ||
      attachment.session_id !== sessionId
    ) {
      return null;
    }
    return attachment;
  }

  async listAttachmentsByIds(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    attachmentIds: string[],
  ): Promise<ChatAttachmentRecord[]> {
    if (attachmentIds.length === 0) return [];
    const resolved: ChatAttachmentRecord[] = [];
    for (const attachmentId of attachmentIds) {
      const attachment = await this.getAttachment(workspaceId, projectId, sessionId, attachmentId);
      if (attachment) {
        resolved.push(attachment);
      }
    }
    return resolved;
  }

  async deleteAttachment(
    workspaceId: string,
    projectId: string,
    sessionId: string,
    attachmentId: string,
  ): Promise<boolean> {
    const attachment = await this.docStore.get<ChatAttachmentRecord>(
      ChatResourceService.attachmentsCollection,
      attachmentId,
    );
    if (!attachment) return false;
    if (
      attachment.workspace_id !== workspaceId ||
      attachment.project_id !== projectId ||
      attachment.session_id !== sessionId
    ) {
      return false;
    }
    await this.docStore.delete(ChatResourceService.attachmentsCollection, attachmentId);
    return true;
  }
}
