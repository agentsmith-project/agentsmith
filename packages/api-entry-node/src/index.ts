import http from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  CreateAIReadyJobRequestSchema,
  CreateSourceLibraryRequestSchema,
  CreateProjectRequestSchema,
  CreateSourceRequestSchema,
  ErrorResponseSchema,
  UpdateSourceLibraryRequestSchema,
  UpdateProjectRequestSchema,
} from '@mbos/contracts';
import {
  CancelAIReadyJobUseCase,
  BatchCancelSourceAIReadyUseCase,
  BatchStartSourceAIReadyUseCase,
  CancelSourceAIReadyUseCase,
  CreateAIReadyJobUseCase,
  CreateSourceLibraryUseCase,
  CreateProjectUseCase,
  CreateSourceUseCase,
  DeleteSourceLibraryUseCase,
  DeleteSourceUseCase,
  DeleteProjectUseCase,
  DownloadSourceUseCase,
  GetSourceUseCase,
  GetAIReadyJobUseCase,
  GetSourcesQuotaUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  ListSourceLibrariesUseCase,
  ListSourcesUseCase,
  RunQueuedAIReadyJobUseCase,
  RetrySourceAIReadyUseCase,
  StartSourceAIReadyUseCase,
  UpdateSourceLibraryUseCase,
  UpdateProjectUseCase,
  drainJobQueue,
} from '@mbos/application';
import {
  DeterministicEmbeddingProvider,
  FixedCharTextChunker,
  InMemoryJobQueue,
  InMemoryCache,
  InMemoryJsonDocStore,
  InMemoryObjectStore,
  JsonDocAIReadyJobRepo,
  JsonDocSourceRepo,
  JsonDocSourceLibraryRepo,
  MinioObjectStore,
  MongoJsonDocStore,
  NoopVectorStore,
  PgVectorStore,
  RedisCache,
  createProjectRepoFactoryResult,
  type ProjectRepoFactoryResult,
  SimpleIdGenerator,
  SystemClock,
  Utf8DocumentParser,
} from '@mbos/adapters-private';
import type { CachePort, JsonDocStorePort } from '@mbos/ports';
import {
  ACTIVE_CHAT_STREAMS,
} from './chat-stream-runtime.js';
import { matchChatRoute, type ChatRoute } from './chat-route-match.js';
import { handleChatNonStreamRoute } from './chat-non-stream-handler.js';
import { handleChatStreamRoute } from './chat-stream-handler.js';
import { handleEndpointRoute } from './endpoint-route-handler.js';
import { verifyBearerToken } from './auth.js';

interface WorkspaceRecord {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface WorkspaceMemberRecord {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'developer' | 'user';
  governance_group?: 'wheel' | 'user';
  permissions: string[];
  status: 'active' | 'removed';
  joined_at: string;
}

interface CredentialRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  type: 'api_key';
  fingerprint: string;
  created_at: string;
  last_rotated_at?: string;
}

interface CredentialSecretRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  value: string;
  updated_at: string;
}

interface EndpointRecord {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  description?: string;
  openai_model: string;
  source_model?: string;
  type: 'openai' | 'anthropic' | 'custom';
  mode?: 'openai';
  base_url: string;
  status: 'active' | 'disabled';
  credential_ref?: string;
  limits?: {
    max_requests_per_minute?: number;
    max_requests_per_day?: number;
    max_tokens_per_day?: number;
    timeout_seconds?: number;
  };
  created_at: string;
  updated_at: string;
}

interface EndpointImportItem {
  model: string;
  source_model?: string;
  api_base: string;
  api_key: string;
  mode?: 'openai';
}

interface EndpointImportPayload {
  reranker?: EndpointImportItem;
  embedding?: EndpointImportItem;
  completion?: EndpointImportItem;
}

interface ChatSessionRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  model: string;
  endpoint_id: string;
  pinned?: boolean;
  starred?: boolean;
  created_at: string;
  updated_at: string;
  message_count: number;
  total_tokens: number;
  runtime_status?: 'running' | 'stopping' | 'completed' | 'stopped' | 'failed';
}

interface ChatMessageRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  tokens?: number;
  finish_reason?: string | null;
  message_status?: 'streaming' | 'completed' | 'stopped' | 'failed';
  error_code?: string | null;
  error_message?: string | null;
  parent_id?: string | null;
  logical_id?: string;
  revision_of?: string | null;
  revision_index?: number;
  variant_group_id?: string;
  variant_index?: number;
  is_stale?: boolean;
}

interface ChatAttachmentRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  session_id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  upload_status: 'uploading' | 'processing' | 'ready' | 'failed';
  created_at: string;
  error_message?: string;
}

class EndpointResourceService {
  private static readonly credentialsCollection = 'credentials';
  private static readonly credentialSecretsCollection = 'credential_secrets';
  private static readonly endpointsCollection = 'endpoints';

  constructor(private readonly docStore: JsonDocStorePort) {}

  private hashFingerprint(secret: string): string {
    return createHash('sha256').update(secret).digest('hex').slice(0, 12);
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
  }

  private endpointId(): string {
    return `ep_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  private credentialId(): string {
    return `cred_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  async listCredentials(workspaceId: string, projectId: string): Promise<CredentialRecord[]> {
    return this.docStore.list<CredentialRecord>(EndpointResourceService.credentialsCollection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async createCredential(
    workspaceId: string,
    projectId: string,
    input: { name: string; value: string; type?: 'api_key' },
  ): Promise<CredentialRecord> {
    const id = this.credentialId();
    const now = new Date().toISOString();
    const credential: CredentialRecord = {
      id,
      workspace_id: workspaceId,
      project_id: projectId,
      name: input.name.trim(),
      type: 'api_key',
      fingerprint: this.hashFingerprint(input.value),
      created_at: now,
      last_rotated_at: now,
    };
    const secret: CredentialSecretRecord = {
      id,
      workspace_id: workspaceId,
      project_id: projectId,
      value: input.value,
      updated_at: now,
    };
    await this.docStore.upsert(EndpointResourceService.credentialsCollection, id, credential);
    await this.docStore.upsert(EndpointResourceService.credentialSecretsCollection, id, secret);
    return credential;
  }

  async rotateCredential(
    workspaceId: string,
    projectId: string,
    credentialId: string,
    value: string,
  ): Promise<CredentialRecord | null> {
    const credential = await this.docStore.get<CredentialRecord>(
      EndpointResourceService.credentialsCollection,
      credentialId,
    );
    if (!credential) {
      return null;
    }
    if (credential.workspace_id !== workspaceId || credential.project_id !== projectId) {
      return null;
    }
    const now = new Date().toISOString();
    const updated: CredentialRecord = {
      ...credential,
      fingerprint: this.hashFingerprint(value),
      last_rotated_at: now,
    };
    const secret: CredentialSecretRecord = {
      id: credentialId,
      workspace_id: workspaceId,
      project_id: projectId,
      value,
      updated_at: now,
    };
    await this.docStore.upsert(EndpointResourceService.credentialsCollection, credentialId, updated);
    await this.docStore.upsert(EndpointResourceService.credentialSecretsCollection, credentialId, secret);
    return updated;
  }

  async deleteCredential(workspaceId: string, projectId: string, credentialId: string): Promise<boolean> {
    const existing = await this.docStore.get<CredentialRecord>(
      EndpointResourceService.credentialsCollection,
      credentialId,
    );
    if (!existing) {
      return false;
    }
    if (existing.workspace_id !== workspaceId || existing.project_id !== projectId) {
      return false;
    }
    await this.docStore.delete(EndpointResourceService.credentialsCollection, credentialId);
    await this.docStore.delete(EndpointResourceService.credentialSecretsCollection, credentialId);
    return true;
  }

  async getCredentialSecret(
    workspaceId: string,
    projectId: string,
    credentialId: string,
  ): Promise<string | null> {
    const secret = await this.docStore.get<CredentialSecretRecord>(
      EndpointResourceService.credentialSecretsCollection,
      credentialId,
    );
    if (!secret) {
      return null;
    }
    if (secret.workspace_id !== workspaceId || secret.project_id !== projectId) {
      return null;
    }
    return secret.value;
  }

  async listEndpoints(workspaceId: string, projectId: string): Promise<EndpointRecord[]> {
    return this.docStore.list<EndpointRecord>(EndpointResourceService.endpointsCollection, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
  }

  async getEndpoint(
    workspaceId: string,
    projectId: string,
    endpointId: string,
  ): Promise<EndpointRecord | null> {
    const endpoint = await this.docStore.get<EndpointRecord>(
      EndpointResourceService.endpointsCollection,
      endpointId,
    );
    if (!endpoint) {
      return null;
    }
    if (endpoint.workspace_id !== workspaceId || endpoint.project_id !== projectId) {
      return null;
    }
    return endpoint;
  }

  async createEndpoint(
    workspaceId: string,
    projectId: string,
    input: Partial<EndpointRecord>,
  ): Promise<EndpointRecord> {
    const existing = await this.listEndpoints(workspaceId, projectId);
    if (existing.some((item) => item.openai_model === String(input.openai_model ?? '').trim())) {
      throw new Error('endpoint_model_conflict');
    }
    const now = new Date().toISOString();
    const endpoint: EndpointRecord = {
      id: this.endpointId(),
      workspace_id: workspaceId,
      project_id: projectId,
      name: String(input.name ?? '').trim(),
      description: input.description?.trim() || undefined,
      openai_model: String(input.openai_model ?? '').trim(),
      source_model: input.source_model?.trim() || undefined,
      type: (input.type as EndpointRecord['type']) ?? 'openai',
      mode: input.mode,
      base_url: this.normalizeBaseUrl(String(input.base_url ?? '')),
      status: (input.status as EndpointRecord['status']) ?? 'active',
      credential_ref: input.credential_ref?.trim() || undefined,
      limits: input.limits,
      created_at: now,
      updated_at: now,
    };
    await this.docStore.upsert(EndpointResourceService.endpointsCollection, endpoint.id, endpoint);
    return endpoint;
  }

  async updateEndpoint(
    workspaceId: string,
    projectId: string,
    endpointId: string,
    patch: Partial<EndpointRecord>,
  ): Promise<EndpointRecord | null> {
    const existing = await this.getEndpoint(workspaceId, projectId, endpointId);
    if (!existing) {
      return null;
    }
    const updated: EndpointRecord = {
      ...existing,
      ...patch,
      name: patch.name !== undefined ? String(patch.name).trim() : existing.name,
      openai_model:
        patch.openai_model !== undefined
          ? String(patch.openai_model).trim()
          : existing.openai_model,
      source_model:
        patch.source_model !== undefined
          ? String(patch.source_model).trim()
          : existing.source_model,
      base_url:
        patch.base_url !== undefined
          ? this.normalizeBaseUrl(String(patch.base_url))
          : existing.base_url,
      updated_at: new Date().toISOString(),
    };
    await this.docStore.upsert(EndpointResourceService.endpointsCollection, endpointId, updated);
    return updated;
  }

  async deleteEndpoint(workspaceId: string, projectId: string, endpointId: string): Promise<boolean> {
    const existing = await this.getEndpoint(workspaceId, projectId, endpointId);
    if (!existing) {
      return false;
    }
    await this.docStore.delete(EndpointResourceService.endpointsCollection, endpointId);
    return true;
  }

  async importOpenAICompatible(
    workspaceId: string,
    projectId: string,
    payload: EndpointImportPayload,
  ): Promise<{ items: EndpointRecord[] }> {
    const pairs: Array<{ name: string; item: EndpointImportItem | undefined; type: EndpointRecord['type'] }> = [
      { name: 'reranker', item: payload.reranker, type: 'custom' },
      { name: 'embedding', item: payload.embedding, type: 'openai' },
      { name: 'completion', item: payload.completion, type: 'openai' },
    ];
    const created: EndpointRecord[] = [];

    for (const pair of pairs) {
      if (!pair.item) continue;
      const credential = await this.createCredential(workspaceId, projectId, {
        name: `${pair.name}-key`,
        value: pair.item.api_key,
      });
      const endpoint = await this.createEndpoint(workspaceId, projectId, {
        name: `${pair.name}-${pair.item.model}`,
        openai_model: pair.item.model,
        source_model: pair.item.source_model ?? pair.item.model,
        type: pair.type,
        mode: pair.item.mode,
        base_url: pair.item.api_base,
        credential_ref: credential.id,
        status: 'active',
      });
      created.push(endpoint);
    }
    return { items: created };
  }
}

class ChatResourceService {
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

export interface NodeApiDeps {
  cache: CachePort;
  chatResourceService: ChatResourceService;
  endpointResourceService: EndpointResourceService;
  sourceBucket: string;
  aiReadyJobQueue: InMemoryJobQueue;
  createAIReadyJobUseCase: CreateAIReadyJobUseCase;
  createSourceLibraryUseCase: CreateSourceLibraryUseCase;
  createProjectUseCase: CreateProjectUseCase;
  createSourceUseCase: CreateSourceUseCase;
  deleteSourceLibraryUseCase: DeleteSourceLibraryUseCase;
  deleteSourceUseCase: DeleteSourceUseCase;
  downloadSourceUseCase: DownloadSourceUseCase;
  getSourceUseCase: GetSourceUseCase;
  getAIReadyJobUseCase: GetAIReadyJobUseCase;
  getSourcesQuotaUseCase: GetSourcesQuotaUseCase;
  startSourceAIReadyUseCase: StartSourceAIReadyUseCase;
  cancelSourceAIReadyUseCase: CancelSourceAIReadyUseCase;
  retrySourceAIReadyUseCase: RetrySourceAIReadyUseCase;
  batchStartSourceAIReadyUseCase: BatchStartSourceAIReadyUseCase;
  batchCancelSourceAIReadyUseCase: BatchCancelSourceAIReadyUseCase;
  deleteProjectUseCase: DeleteProjectUseCase;
  getProjectUseCase: GetProjectUseCase;
  listProjectsUseCase: ListProjectsUseCase;
  listSourceLibrariesUseCase: ListSourceLibrariesUseCase;
  listSourcesUseCase: ListSourcesUseCase;
  updateSourceLibraryUseCase: UpdateSourceLibraryUseCase;
  updateProjectUseCase: UpdateProjectUseCase;
  cancelAIReadyJobUseCase: CancelAIReadyJobUseCase;
  runQueuedAIReadyJobUseCase: RunQueuedAIReadyJobUseCase;
}

export function createDefaultNodeApiDeps(): NodeApiDeps {
  const projectRepo = createProjectRepoFactoryResult({}).projectRepo;
  const cache = new InMemoryCache();
  const clock = new SystemClock();
  const docStore = new InMemoryJsonDocStore();
  const chatResourceService = new ChatResourceService(docStore);
  const sourceRepo = new JsonDocSourceRepo(docStore);
  const sourceLibraryRepo = new JsonDocSourceLibraryRepo(docStore);
  const aiReadyJobRepo = new JsonDocAIReadyJobRepo(docStore);
  const aiReadyJobQueue = new InMemoryJobQueue();
  const objectStore = new InMemoryObjectStore();
  const endpointResourceService = new EndpointResourceService(docStore);
  const sourceBucket = 'mbos-dev';
  const vectorStore = new NoopVectorStore();
  const parser = new Utf8DocumentParser();
  const chunker = new FixedCharTextChunker();
  const embeddings = new DeterministicEmbeddingProvider();
  const startSourceAIReadyUseCase = new StartSourceAIReadyUseCase(sourceRepo, clock, cache);
  const cancelSourceAIReadyUseCase = new CancelSourceAIReadyUseCase(sourceRepo, clock, cache);
  const runQueuedAIReadyJobUseCase = new RunQueuedAIReadyJobUseCase(
    sourceRepo,
    sourceLibraryRepo,
    aiReadyJobRepo,
    objectStore,
    parser,
    chunker,
    embeddings,
    vectorStore,
    clock,
    cache,
    sourceBucket,
  );

  return {
    cache,
    chatResourceService,
    endpointResourceService,
    sourceBucket,
    aiReadyJobQueue,
    createAIReadyJobUseCase: new CreateAIReadyJobUseCase(
      sourceRepo,
      sourceLibraryRepo,
      aiReadyJobRepo,
      aiReadyJobQueue,
      clock,
      cache,
    ),
    createSourceLibraryUseCase: new CreateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
    ),
    createProjectUseCase: new CreateProjectUseCase(projectRepo, new SimpleIdGenerator(), new SystemClock()),
    createSourceUseCase: new CreateSourceUseCase(
      sourceRepo,
      objectStore,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
      sourceBucket,
    ),
    deleteSourceLibraryUseCase: new DeleteSourceLibraryUseCase(sourceLibraryRepo, cache),
    deleteSourceUseCase: new DeleteSourceUseCase(sourceRepo, objectStore, cache, sourceBucket),
    downloadSourceUseCase: new DownloadSourceUseCase(sourceRepo, objectStore, sourceBucket),
    deleteProjectUseCase: new DeleteProjectUseCase(projectRepo),
    getSourceUseCase: new GetSourceUseCase(sourceRepo),
    getAIReadyJobUseCase: new GetAIReadyJobUseCase(aiReadyJobRepo, cache),
    getSourcesQuotaUseCase: new GetSourcesQuotaUseCase(sourceRepo),
    startSourceAIReadyUseCase,
    cancelSourceAIReadyUseCase,
    retrySourceAIReadyUseCase: new RetrySourceAIReadyUseCase(startSourceAIReadyUseCase),
    batchStartSourceAIReadyUseCase: new BatchStartSourceAIReadyUseCase(startSourceAIReadyUseCase),
    batchCancelSourceAIReadyUseCase: new BatchCancelSourceAIReadyUseCase(cancelSourceAIReadyUseCase),
    getProjectUseCase: new GetProjectUseCase(projectRepo),
    listProjectsUseCase: new ListProjectsUseCase(projectRepo),
    listSourceLibrariesUseCase: new ListSourceLibrariesUseCase(sourceLibraryRepo, cache),
    listSourcesUseCase: new ListSourcesUseCase(sourceRepo, cache),
    updateSourceLibraryUseCase: new UpdateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SystemClock(),
      cache,
    ),
    updateProjectUseCase: new UpdateProjectUseCase(projectRepo, new SystemClock()),
    cancelAIReadyJobUseCase: new CancelAIReadyJobUseCase(aiReadyJobRepo, clock, cache),
    runQueuedAIReadyJobUseCase,
  };
}

const OWNER_PROJECT_PERMISSIONS = [
  'project:read',
  'project:chat:access',
  'project:studio:access',
  'project:source:use',
  'project:source:manage',
  'project:endpoint:use',
  'project:endpoint:manage',
  'project:agent:use',
  'project:agent:manage',
  'project:resource_policy:manage',
  'project:credential:manage',
  'project:settings:manage',
  'project:member:view',
  'project:member:manage',
  'project:audit:view',
  'project:usage:view',
] as const;

const OPERATOR_PROJECT_PERMISSIONS = [
  'project:read',
  'project:chat:access',
  'project:source:use',
  'project:source:manage',
  'project:endpoint:use',
  'project:endpoint:manage',
  'project:credential:manage',
] as const;

const OWNER_WORKSPACE_PERMISSIONS = [
  'workspace:read',
  'workspace:project:create',
  'workspace:governance:update',
] as const;

function resolveProjectPermissions(ownerId: string, actorId: string): readonly string[] {
  if (ownerId === actorId) {
    return OWNER_PROJECT_PERMISSIONS;
  }
  return OPERATOR_PROJECT_PERMISSIONS;
}

function buildWorkspaceRecords(): WorkspaceRecord[] {
  const now = new Date().toISOString();
  const workspaceId = process.env.MBOS_DEFAULT_WORKSPACE_ID ?? 'ws_default';
  const workspaceName = process.env.MBOS_DEFAULT_WORKSPACE_NAME ?? 'Default Workspace';
  return [{
    id: workspaceId,
    name: workspaceName,
    created_at: now,
    updated_at: now,
  }];
}

function unauthorized(res: http.ServerResponse): void {
  json(res, 401, { code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token' });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function applyCors(res: http.ServerResponse): void {
  const allowOrigin = process.env.CORS_ALLOW_ORIGIN ?? '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Idempotency-Key',
  );
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString('utf-8').trim();
  if (!text) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function buildUpstreamUrl(baseUrl: string, proxyPath: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = proxyPath.replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

async function proxyJsonRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: {
    upstreamUrl: string;
    apiKey: string;
    sourceModel?: string;
    timeoutSeconds?: number;
  },
): Promise<void> {
  const method = req.method ?? 'POST';
  const rawBody = await readBody(req);
  const body =
    rawBody && typeof rawBody === 'object'
      ? ({ ...(rawBody as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  if (options.sourceModel) {
    body.model = options.sourceModel;
  }

  const abortController = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutSeconds ?? 120) * 1000;
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const upstreamRes = await fetch(options.upstreamUrl, {
      method,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
    const payload = Buffer.from(await upstreamRes.arrayBuffer());
    const contentType = upstreamRes.headers.get('content-type') ?? 'application/json';
    res.statusCode = upstreamRes.status;
    res.setHeader('content-type', contentType);
    res.end(payload);
  } finally {
    clearTimeout(timeout);
  }
}

function sseWrite(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

type ProjectsRoute =
  | { kind: 'workspacesCollection' }
  | { kind: 'workspaceItem'; workspaceId: string }
  | { kind: 'workspaceMembers'; workspaceId: string }
  | { kind: 'collection'; workspaceId: string }
  | { kind: 'item'; workspaceId: string; projectId: string }
  | { kind: 'sources'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibraries'; workspaceId: string; projectId: string }
  | { kind: 'sourceLibraryItem'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryAIReadyJobs'; workspaceId: string; projectId: string; libraryId: string }
  | { kind: 'sourceLibraryAIReadyJobItem'; workspaceId: string; projectId: string; libraryId: string; jobId: string }
  | { kind: 'sourceLibraryAIReadyJobCancel'; workspaceId: string; projectId: string; libraryId: string; jobId: string }
  | { kind: 'sourcesQuota'; workspaceId: string; projectId: string }
  | { kind: 'sourceAIReadyStart'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceAIReadyCancel'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceAIReadyRetry'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceBatchAIReadyStart'; workspaceId: string; projectId: string }
  | { kind: 'sourceBatchAIReadyCancel'; workspaceId: string; projectId: string }
  | { kind: 'sourceItem'; workspaceId: string; projectId: string; sourceId: string }
  | { kind: 'sourceDownload'; workspaceId: string; projectId: string; sourceId: string }
  | ChatRoute
  | { kind: 'endpoints'; workspaceId: string; projectId: string }
  | { kind: 'endpointItem'; workspaceId: string; projectId: string; endpointId: string }
  | {
    kind: 'endpointProxy';
    workspaceId: string;
    projectId: string;
    endpointId: string;
    proxyPath: string;
  }
  | { kind: 'endpointImportOpenAICompatible'; workspaceId: string; projectId: string }
  | { kind: 'credentials'; workspaceId: string; projectId: string }
  | { kind: 'credentialItem'; workspaceId: string; projectId: string; credentialId: string }
  | { kind: 'credentialRotate'; workspaceId: string; projectId: string; credentialId: string };

function matchProjectsRoute(url: string): ProjectsRoute | null {
  const pathname = new URL(url, 'http://localhost').pathname;
  if (pathname === '/api/v1/workspaces' || pathname === '/api/v1/workspaces/') {
    return { kind: 'workspacesCollection' };
  }

  const workspaceItemMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/?$/);
  if (workspaceItemMatched) {
    return {
      kind: 'workspaceItem',
      workspaceId: decodeURIComponent(workspaceItemMatched[1]),
    };
  }

  const workspaceMembersMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/members\/?$/);
  if (workspaceMembersMatched) {
    return {
      kind: 'workspaceMembers',
      workspaceId: decodeURIComponent(workspaceMembersMatched[1]),
    };
  }

  const collectionMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/?$/);
  if (collectionMatched) {
    return { kind: 'collection', workspaceId: decodeURIComponent(collectionMatched[1]) };
  }

  const itemMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/?$/);
  if (itemMatched) {
    return {
      kind: 'item',
      workspaceId: decodeURIComponent(itemMatched[1]),
      projectId: decodeURIComponent(itemMatched[2]),
    };
  }

  const sourcesMatched = pathname.match(/^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/?$/);
  if (sourcesMatched) {
    return {
      kind: 'sources',
      workspaceId: decodeURIComponent(sourcesMatched[1]),
      projectId: decodeURIComponent(sourcesMatched[2]),
    };
  }

  const sourceLibrariesMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/?$/,
  );
  if (sourceLibrariesMatched) {
    return {
      kind: 'sourceLibraries',
      workspaceId: decodeURIComponent(sourceLibrariesMatched[1]),
      projectId: decodeURIComponent(sourceLibrariesMatched[2]),
    };
  }

  const sourceLibraryItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/?$/,
  );
  if (sourceLibraryItemMatched) {
    return {
      kind: 'sourceLibraryItem',
      workspaceId: decodeURIComponent(sourceLibraryItemMatched[1]),
      projectId: decodeURIComponent(sourceLibraryItemMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryItemMatched[3]),
    };
  }

  const sourceLibraryAIReadyJobsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/ai-ready-jobs\/?$/,
  );
  if (sourceLibraryAIReadyJobsMatched) {
    return {
      kind: 'sourceLibraryAIReadyJobs',
      workspaceId: decodeURIComponent(sourceLibraryAIReadyJobsMatched[1]),
      projectId: decodeURIComponent(sourceLibraryAIReadyJobsMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryAIReadyJobsMatched[3]),
    };
  }

  const sourceLibraryAIReadyJobCancelMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/ai-ready-jobs\/([^/]+):cancel\/?$/,
  );
  if (sourceLibraryAIReadyJobCancelMatched) {
    return {
      kind: 'sourceLibraryAIReadyJobCancel',
      workspaceId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[1]),
      projectId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[3]),
      jobId: decodeURIComponent(sourceLibraryAIReadyJobCancelMatched[4]),
    };
  }

  const sourceLibraryAIReadyJobItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/source-libraries\/([^/]+)\/ai-ready-jobs\/([^/]+)\/?$/,
  );
  if (sourceLibraryAIReadyJobItemMatched) {
    return {
      kind: 'sourceLibraryAIReadyJobItem',
      workspaceId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[1]),
      projectId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[2]),
      libraryId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[3]),
      jobId: decodeURIComponent(sourceLibraryAIReadyJobItemMatched[4]),
    };
  }

  const sourcesQuotaMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/quota\/?$/,
  );
  if (sourcesQuotaMatched) {
    return {
      kind: 'sourcesQuota',
      workspaceId: decodeURIComponent(sourcesQuotaMatched[1]),
      projectId: decodeURIComponent(sourcesQuotaMatched[2]),
    };
  }

  const sourceAIReadyStartMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/ai-ready\/start\/?$/,
  );
  if (sourceAIReadyStartMatched) {
    return {
      kind: 'sourceAIReadyStart',
      workspaceId: decodeURIComponent(sourceAIReadyStartMatched[1]),
      projectId: decodeURIComponent(sourceAIReadyStartMatched[2]),
      sourceId: decodeURIComponent(sourceAIReadyStartMatched[3]),
    };
  }

  const sourceAIReadyCancelMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/ai-ready\/cancel\/?$/,
  );
  if (sourceAIReadyCancelMatched) {
    return {
      kind: 'sourceAIReadyCancel',
      workspaceId: decodeURIComponent(sourceAIReadyCancelMatched[1]),
      projectId: decodeURIComponent(sourceAIReadyCancelMatched[2]),
      sourceId: decodeURIComponent(sourceAIReadyCancelMatched[3]),
    };
  }

  const sourceAIReadyRetryMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/ai-ready\/retry\/?$/,
  );
  if (sourceAIReadyRetryMatched) {
    return {
      kind: 'sourceAIReadyRetry',
      workspaceId: decodeURIComponent(sourceAIReadyRetryMatched[1]),
      projectId: decodeURIComponent(sourceAIReadyRetryMatched[2]),
      sourceId: decodeURIComponent(sourceAIReadyRetryMatched[3]),
    };
  }

  const sourceBatchAIReadyStartMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/batch\/ai-ready\/start\/?$/,
  );
  if (sourceBatchAIReadyStartMatched) {
    return {
      kind: 'sourceBatchAIReadyStart',
      workspaceId: decodeURIComponent(sourceBatchAIReadyStartMatched[1]),
      projectId: decodeURIComponent(sourceBatchAIReadyStartMatched[2]),
    };
  }

  const sourceBatchAIReadyCancelMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/batch\/ai-ready\/cancel\/?$/,
  );
  if (sourceBatchAIReadyCancelMatched) {
    return {
      kind: 'sourceBatchAIReadyCancel',
      workspaceId: decodeURIComponent(sourceBatchAIReadyCancelMatched[1]),
      projectId: decodeURIComponent(sourceBatchAIReadyCancelMatched[2]),
    };
  }

  const sourceItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/?$/,
  );
  if (sourceItemMatched) {
    return {
      kind: 'sourceItem',
      workspaceId: decodeURIComponent(sourceItemMatched[1]),
      projectId: decodeURIComponent(sourceItemMatched[2]),
      sourceId: decodeURIComponent(sourceItemMatched[3]),
    };
  }

  const sourceDownloadMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/sources\/([^/]+)\/download\/?$/,
  );
  if (sourceDownloadMatched) {
    return {
      kind: 'sourceDownload',
      workspaceId: decodeURIComponent(sourceDownloadMatched[1]),
      projectId: decodeURIComponent(sourceDownloadMatched[2]),
      sourceId: decodeURIComponent(sourceDownloadMatched[3]),
    };
  }

  const chatRoute = matchChatRoute(pathname);
  if (chatRoute) {
    return chatRoute;
  }

  const endpointImportMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/import-openai-compatible\/?$/,
  );
  if (endpointImportMatched) {
    return {
      kind: 'endpointImportOpenAICompatible',
      workspaceId: decodeURIComponent(endpointImportMatched[1]),
      projectId: decodeURIComponent(endpointImportMatched[2]),
    };
  }

  const endpointProxyMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/proxy\/(.+)$/,
  );
  if (endpointProxyMatched) {
    return {
      kind: 'endpointProxy',
      workspaceId: decodeURIComponent(endpointProxyMatched[1]),
      projectId: decodeURIComponent(endpointProxyMatched[2]),
      endpointId: decodeURIComponent(endpointProxyMatched[3]),
      proxyPath: endpointProxyMatched[4],
    };
  }

  const endpointItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/([^/]+)\/?$/,
  );
  if (endpointItemMatched) {
    return {
      kind: 'endpointItem',
      workspaceId: decodeURIComponent(endpointItemMatched[1]),
      projectId: decodeURIComponent(endpointItemMatched[2]),
      endpointId: decodeURIComponent(endpointItemMatched[3]),
    };
  }

  const endpointsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/endpoints\/?$/,
  );
  if (endpointsMatched) {
    return {
      kind: 'endpoints',
      workspaceId: decodeURIComponent(endpointsMatched[1]),
      projectId: decodeURIComponent(endpointsMatched[2]),
    };
  }

  const credentialRotateMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/credentials\/([^/]+)\/rotate\/?$/,
  );
  if (credentialRotateMatched) {
    return {
      kind: 'credentialRotate',
      workspaceId: decodeURIComponent(credentialRotateMatched[1]),
      projectId: decodeURIComponent(credentialRotateMatched[2]),
      credentialId: decodeURIComponent(credentialRotateMatched[3]),
    };
  }

  const credentialItemMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/credentials\/([^/]+)\/?$/,
  );
  if (credentialItemMatched) {
    return {
      kind: 'credentialItem',
      workspaceId: decodeURIComponent(credentialItemMatched[1]),
      projectId: decodeURIComponent(credentialItemMatched[2]),
      credentialId: decodeURIComponent(credentialItemMatched[3]),
    };
  }

  const credentialsMatched = pathname.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/credentials\/?$/,
  );
  if (credentialsMatched) {
    return {
      kind: 'credentials',
      workspaceId: decodeURIComponent(credentialsMatched[1]),
      projectId: decodeURIComponent(credentialsMatched[2]),
    };
  }

  return null;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse, deps: NodeApiDeps): Promise<void> {
  applyCors(res);
  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const route = matchProjectsRoute(req.url ?? '');
  if (!route) {
    json(res, 404, { code: 'NOT_FOUND', message: 'Route not found' });
    return;
  }

  try {
    const requestUrl = new URL(req.url ?? '', 'http://localhost');
    const user = await verifyBearerToken(req);
    if (!user) {
      unauthorized(res);
      return;
    }

    const workspaces = buildWorkspaceRecords();
    const defaultWorkspace = workspaces[0];

    if (route.kind === 'workspacesCollection' && method === 'GET') {
      json(res, 200, { items: workspaces, total: workspaces.length });
      return;
    }

    if (route.kind === 'workspaceItem' && method === 'GET') {
      const found = workspaces.find((item) => item.id === route.workspaceId);
      if (!found) {
        json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
        return;
      }
      json(res, 200, found);
      return;
    }

    if (route.kind === 'workspaceMembers' && method === 'GET') {
      if (!defaultWorkspace || route.workspaceId !== defaultWorkspace.id) {
        json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
        return;
      }
      const member: WorkspaceMemberRecord = {
        id: `wm_${user.id}`,
        user_id: user.id,
        name: user.name,
        email: user.email,
        role: 'owner',
        governance_group: 'wheel',
        permissions: [...OWNER_WORKSPACE_PERMISSIONS],
        status: 'active',
        joined_at: defaultWorkspace.created_at,
      };
      json(res, 200, { items: [member], total: 1 });
      return;
    }

    const workspaceIdInRoute = 'workspaceId' in route ? route.workspaceId : null;
    if (workspaceIdInRoute && !workspaces.some((item) => item.id === workspaceIdInRoute)) {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
      return;
    }

    if (route.kind === 'collection' && method === 'GET') {
      const listed = await deps.listProjectsUseCase.execute(route.workspaceId);
        json(res, 200, {
          items: listed.items.map((item) => ({
            ...item,
            role: item.owner_id === user.id ? 'owner' : 'developer',
            permissions: [...resolveProjectPermissions(item.owner_id, user.id)],
          })),
        });
        return;
      }

    if (route.kind === 'collection' && method === 'POST') {
      const raw = await readBody(req);
      const input = CreateProjectRequestSchema.parse(raw);
      const actorId = user.id;

      const created = await deps.createProjectUseCase.execute({
        workspaceId: route.workspaceId,
        actorId,
        input,
      });

      json(res, 201, created);
      return;
    }

    if (route.kind === 'item' && method === 'GET') {
      const found = await deps.getProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      json(res, 200, {
        ...found,
        role: found.owner_id === user.id ? 'owner' : 'developer',
        permissions: [...resolveProjectPermissions(found.owner_id, user.id)],
      });
      return;
    }

    if (route.kind === 'item' && method === 'PATCH') {
      const raw = await readBody(req);
      const input = UpdateProjectRequestSchema.parse(raw);
      const updated = await deps.updateProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        input,
      });
      json(res, 200, updated);
      return;
    }

    if (route.kind === 'item' && method === 'DELETE') {
      await deps.deleteProjectUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      res.statusCode = 204;
      res.end();
      return;
    }

    if (route.kind === 'sources' && method === 'GET') {
      const libraryId = requestUrl.searchParams.get('library_id') ?? undefined;
      const listed = await deps.listSourcesUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId,
      });
      json(res, 200, listed);
      return;
    }

    if (route.kind === 'sources' && method === 'POST') {
      const raw = await readBody(req);
      const input = CreateSourceRequestSchema.parse(raw);
      const created = await deps.createSourceUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        input,
      });
      json(res, 201, created);
      return;
    }

    if (route.kind === 'sourceLibraries' && method === 'GET') {
      const listed = await deps.listSourceLibrariesUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
      });
      json(res, 200, listed);
      return;
    }

    if (route.kind === 'sourceLibraries' && method === 'POST') {
      const raw = await readBody(req);
      const input = CreateSourceLibraryRequestSchema.parse(raw);
      const created = await deps.createSourceLibraryUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorId: user.id,
        input,
      });
      json(res, 201, created);
      return;
    }

    if (route.kind === 'sourceLibraryItem' && method === 'PATCH') {
      const raw = await readBody(req);
      const input = UpdateSourceLibraryRequestSchema.parse(raw);
      const updated = await deps.updateSourceLibraryUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId: route.libraryId,
        input,
      });
      json(res, 200, updated);
      return;
    }

    if (route.kind === 'sourceLibraryItem' && method === 'DELETE') {
      await deps.deleteSourceLibraryUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId: route.libraryId,
      });
      res.statusCode = 204;
      res.end();
      return;
    }

    if (route.kind === 'sourceLibraryAIReadyJobs' && method === 'POST') {
      const raw = await readBody(req);
      const input = CreateAIReadyJobRequestSchema.parse(raw);
      const created = await deps.createAIReadyJobUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId: route.libraryId,
        actorId: user.id,
        idempotencyKey: req.headers['idempotency-key']?.toString(),
        input,
      });
      json(res, 201, created);
      return;
    }

    if (route.kind === 'sourceLibraryAIReadyJobItem' && method === 'GET') {
      await drainJobQueue(deps.aiReadyJobQueue, async (item) => {
        await deps.runQueuedAIReadyJobUseCase.execute({
          workspaceId: item.workspaceId,
          projectId: item.projectId,
          libraryId: item.libraryId,
          jobId: item.jobId,
        });
      });
      const found = await deps.getAIReadyJobUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId: route.libraryId,
        jobId: route.jobId,
      });
      json(res, 200, found);
      return;
    }

    if (route.kind === 'sourceLibraryAIReadyJobCancel' && method === 'POST') {
      const updated = await deps.cancelAIReadyJobUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId: route.libraryId,
        jobId: route.jobId,
      });
      json(res, 200, updated);
      return;
    }

    if (route.kind === 'sourcesQuota' && method === 'GET') {
      const libraryId = requestUrl.searchParams.get('library_id') ?? undefined;
      const quota = await deps.getSourcesQuotaUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId,
      });
      json(res, 200, quota);
      return;
    }

    if (route.kind === 'sourceAIReadyStart' && method === 'POST') {
      const job = await deps.startSourceAIReadyUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId: route.sourceId,
      });
      json(res, 200, job);
      return;
    }

    if (route.kind === 'sourceAIReadyCancel' && method === 'POST') {
      const job = await deps.cancelSourceAIReadyUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId: route.sourceId,
      });
      json(res, 200, job);
      return;
    }

    if (route.kind === 'sourceAIReadyRetry' && method === 'POST') {
      const job = await deps.retrySourceAIReadyUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId: route.sourceId,
      });
      json(res, 200, job);
      return;
    }

    if (route.kind === 'sourceBatchAIReadyStart' && method === 'POST') {
      const raw = (await readBody(req)) as { file_ids?: string[] };
      const sourceIds = Array.isArray(raw.file_ids) ? raw.file_ids : [];
      const jobs = await deps.batchStartSourceAIReadyUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceIds,
      });
      json(res, 200, jobs);
      return;
    }

    if (route.kind === 'sourceBatchAIReadyCancel' && method === 'POST') {
      const raw = (await readBody(req)) as { file_ids?: string[] };
      const sourceIds = Array.isArray(raw.file_ids) ? raw.file_ids : [];
      const jobs = await deps.batchCancelSourceAIReadyUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceIds,
      });
      json(res, 200, jobs);
      return;
    }

    if (route.kind === 'sourceItem' && method === 'DELETE') {
      await deps.deleteSourceUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId: route.sourceId,
      });
      res.statusCode = 204;
      res.end();
      return;
    }

    if (route.kind === 'sourceItem' && method === 'GET') {
      const source = await deps.getSourceUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId: route.sourceId,
      });
      json(res, 200, source);
      return;
    }

    if (route.kind === 'sourceDownload' && method === 'GET') {
      const source = await deps.downloadSourceUseCase.execute({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sourceId: route.sourceId,
      });
      res.statusCode = 200;
      res.setHeader('content-type', source.source.content_type);
      res.setHeader(
        'content-disposition',
        `attachment; filename=\"${encodeURIComponent(source.source.name)}\"`,
      );
      res.end(Buffer.from(source.body));
      return;
    }

    const handledChatNonStream = await handleChatNonStreamRoute({
      route,
      method,
      req,
      res,
      deps,
      requestUrl,
      json,
      readBody,
    });
    if (handledChatNonStream) {
      return;
    }

    const handledChatStream = await handleChatStreamRoute({
      route,
      method,
      req,
      res,
      deps,
      json,
      readBody,
      buildUpstreamUrl,
      sseWrite,
    });
    if (handledChatStream) {
      return;
    }

    const handledEndpointRoute = await handleEndpointRoute({
      route,
      method,
      req,
      res,
      deps,
      json,
      readBody,
      buildUpstreamUrl,
      proxyJsonRequest,
    });
    if (handledEndpointRoute) {
      return;
    }

    json(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  } catch (error) {
    if (error instanceof Error && error.message === 'project_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'project_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'source_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_library_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'source_library_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'ai_ready_job_not_found') {
      json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'ai_ready_job_not_found' });
      return;
    }
    if (error instanceof Error && error.message === 'source_library_mismatch') {
      json(res, 422, { code: 'VALIDATION_ERROR', message: 'source_library_mismatch' });
      return;
    }

    const parsed = ErrorResponseSchema.safeParse({
      code: 'VALIDATION_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });

    json(res, 400, parsed.success ? parsed.data : { code: 'BAD_REQUEST', message: 'Bad request' });
  }
}

export function createNodeApiServer(
  port = 3010,
  deps = createDefaultNodeApiDeps(),
  lifecycle?: Pick<ProjectRepoFactoryResult, 'shutdown'>,
): http.Server {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, deps);
  });

  const jobWorkerInterval = setInterval(() => {
    void drainJobQueue(deps.aiReadyJobQueue, async (item) => {
      await deps.runQueuedAIReadyJobUseCase.execute({
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        libraryId: item.libraryId,
        jobId: item.jobId,
      });
    });
  }, 200);

  if (lifecycle) {
    server.on('close', () => {
      clearInterval(jobWorkerInterval);
      ACTIVE_CHAT_STREAMS.clear();
      void lifecycle.shutdown();
    });
  } else {
    server.on('close', () => {
      clearInterval(jobWorkerInterval);
      ACTIVE_CHAT_STREAMS.clear();
    });
  }

  server.listen(port);
  return server;
}

function startFromCli(): void {
  const portRaw = process.env.PORT;
  const port = portRaw ? Number(portRaw) : 3010;
  if (!Number.isInteger(port) || port <= 0) {
    // Keep startup validation explicit for ops.
    throw new Error('invalid_port');
  }

  const factory = createProjectRepoFactoryResult({
    databaseUrl: process.env.DATABASE_URL,
  });
  const cache = process.env.REDIS_URL
    ? new RedisCache({ url: process.env.REDIS_URL })
    : new InMemoryCache();
  const clock = new SystemClock();
  const docStore = process.env.MONGO_URL
    ? new MongoJsonDocStore({
      url: process.env.MONGO_URL,
      dbName: process.env.MONGO_DB_NAME ?? 'mbos',
    })
    : new InMemoryJsonDocStore();
  const chatResourceService = new ChatResourceService(docStore);
  const objectStore = process.env.MINIO_ENDPOINT
    ? new MinioObjectStore({
      endPoint: process.env.MINIO_ENDPOINT,
      port: Number(process.env.MINIO_PORT ?? '19000'),
      useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'mbos',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'mbos_dev_password',
    })
    : new InMemoryObjectStore();
  const sourceRepo = new JsonDocSourceRepo(docStore);
  const sourceLibraryRepo = new JsonDocSourceLibraryRepo(docStore);
  const aiReadyJobRepo = new JsonDocAIReadyJobRepo(docStore);
  const aiReadyJobQueue = new InMemoryJobQueue();
  const endpointResourceService = new EndpointResourceService(docStore);
  const sourceBucket = process.env.MINIO_BUCKET ?? 'mbos-dev';
  const parser = new Utf8DocumentParser();
  const chunker = new FixedCharTextChunker({
    chunkSize: Number(process.env.AIREADY_CHUNK_SIZE ?? '1000'),
    overlap: Number(process.env.AIREADY_CHUNK_OVERLAP ?? '100'),
  });
  const embeddings = new DeterministicEmbeddingProvider(
    Number(process.env.AIREADY_EMBEDDING_DIMENSIONS ?? '1536'),
  );
  const vectorStore = process.env.DATABASE_URL
    ? new PgVectorStore({
      databaseUrl: process.env.DATABASE_URL,
      embeddingDimensions: embeddings.dimensions(),
    })
    : new NoopVectorStore();
  if (vectorStore instanceof PgVectorStore) {
    void vectorStore.ensureSchema().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown_error';
      process.stderr.write(`[api-entry-node] pgvector schema init failed: ${message}\n`);
    });
  }
  const startSourceAIReadyUseCase = new StartSourceAIReadyUseCase(sourceRepo, clock, cache);
  const cancelSourceAIReadyUseCase = new CancelSourceAIReadyUseCase(sourceRepo, clock, cache);
  const runQueuedAIReadyJobUseCase = new RunQueuedAIReadyJobUseCase(
    sourceRepo,
    sourceLibraryRepo,
    aiReadyJobRepo,
    objectStore,
    parser,
    chunker,
    embeddings,
    vectorStore,
    clock,
    cache,
    sourceBucket,
  );
  const deps: NodeApiDeps = {
    cache,
    chatResourceService,
    endpointResourceService,
    sourceBucket,
    aiReadyJobQueue,
    createAIReadyJobUseCase: new CreateAIReadyJobUseCase(
      sourceRepo,
      sourceLibraryRepo,
      aiReadyJobRepo,
      aiReadyJobQueue,
      clock,
      cache,
    ),
    createSourceLibraryUseCase: new CreateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
    ),
    createProjectUseCase: new CreateProjectUseCase(factory.projectRepo, new SimpleIdGenerator(), new SystemClock()),
    createSourceUseCase: new CreateSourceUseCase(
      sourceRepo,
      objectStore,
      new SimpleIdGenerator(),
      new SystemClock(),
      cache,
      sourceBucket,
    ),
    deleteSourceLibraryUseCase: new DeleteSourceLibraryUseCase(sourceLibraryRepo, cache),
    deleteSourceUseCase: new DeleteSourceUseCase(sourceRepo, objectStore, cache, sourceBucket),
    downloadSourceUseCase: new DownloadSourceUseCase(sourceRepo, objectStore, sourceBucket),
    deleteProjectUseCase: new DeleteProjectUseCase(factory.projectRepo),
    getSourceUseCase: new GetSourceUseCase(sourceRepo),
    getAIReadyJobUseCase: new GetAIReadyJobUseCase(aiReadyJobRepo, cache),
    getSourcesQuotaUseCase: new GetSourcesQuotaUseCase(sourceRepo),
    startSourceAIReadyUseCase,
    cancelSourceAIReadyUseCase,
    retrySourceAIReadyUseCase: new RetrySourceAIReadyUseCase(startSourceAIReadyUseCase),
    batchStartSourceAIReadyUseCase: new BatchStartSourceAIReadyUseCase(startSourceAIReadyUseCase),
    batchCancelSourceAIReadyUseCase: new BatchCancelSourceAIReadyUseCase(cancelSourceAIReadyUseCase),
    getProjectUseCase: new GetProjectUseCase(factory.projectRepo),
    listProjectsUseCase: new ListProjectsUseCase(factory.projectRepo),
    listSourceLibrariesUseCase: new ListSourceLibrariesUseCase(sourceLibraryRepo, cache),
    listSourcesUseCase: new ListSourcesUseCase(sourceRepo, cache),
    updateSourceLibraryUseCase: new UpdateSourceLibraryUseCase(
      sourceLibraryRepo,
      new SystemClock(),
      cache,
    ),
    updateProjectUseCase: new UpdateProjectUseCase(factory.projectRepo, new SystemClock()),
    cancelAIReadyJobUseCase: new CancelAIReadyJobUseCase(aiReadyJobRepo, clock, cache),
    runQueuedAIReadyJobUseCase,
  };
  createNodeApiServer(port, deps, factory);
  // Keep log compact and machine-readable for local integration.
  process.stdout.write(`[api-entry-node] listening on ${port} (repo=${process.env.DATABASE_URL ? 'postgres' : 'memory'})\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startFromCli();
}
