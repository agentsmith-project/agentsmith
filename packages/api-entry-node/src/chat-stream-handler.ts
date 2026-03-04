import type http from 'node:http';
import { Readable } from 'node:stream';
import type { ChatRoute } from './chat-route-match.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { extractBearerToken, type AuthenticatedUser } from './auth.js';
import { writeProjectAuditEvent, writeProjectUsageFact } from './audit-usage-recorders.js';
import { resolveImageMimeType, toImageDataUrl } from './chat-image-utils.js';
import {
  ACTIVE_CHAT_STREAMS,
  STREAM_REGISTRY_FINAL_TTL_SECONDS,
  STREAM_REGISTRY_TTL_SECONDS,
  listActiveSessionStreams,
  readStreamRegistry,
  writeSessionStreamState,
  writeStreamRegistry,
} from './chat-stream-runtime.js';
import {
  parseOpenAIStreamChunk,
  safeAssistantContent,
  safeAssistantFinishReason,
  safeAssistantUsageTokens,
} from './chat-openai-payload.js';
import { anthropicResponseToOpenAiChat, openAiChatRequestToAnthropic } from './protocol-bridge.js';
import { logChatStreamEvent } from './chat-observability.js';
import type { ChatAttachmentRecord } from './resource-models.js';
import { isProjectResourceAccessAllowedForUser } from './project-resource-policy-store.js';
import {
  checkAndConsumeProjectResourceRateLimitsForUser,
} from './project-resource-policy-enforcer.js';
import {
  indexChatAttachmentsByLibraryObjectRef,
  readChatMessageInputs,
  resolveChatInputsFromAttachmentIndex,
  toChatAttachmentSnapshots,
} from './chat-input-refs.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import { buildRuntimeThirdPartyCredentialFiles } from './third-party-runtime-files.js';

interface ChatStreamHandlerArgs {
  route: ChatRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  buildUpstreamUrl: (baseUrl: string, proxyPath: string) => string;
  sseWrite: (res: http.ServerResponse, event: string, data: unknown) => void;
}

const MAX_ATTACHMENTS_PER_MESSAGE = 8;
const MAX_ATTACHMENT_TOTAL_SIZE_BYTES = 60 * 1024 * 1024;

class AgentStreamRouteError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentStreamRouteError';
    this.code = code;
  }
}

function mapAgentDispatchError(error: unknown): AgentStreamRouteError {
  if (error instanceof AgentStreamRouteError) return error;
  const codeCandidate = error && typeof error === 'object'
    ? (error as { code?: unknown }).code
    : undefined;
  if (typeof codeCandidate === 'string' && codeCandidate.startsWith('AGENT_SANDBOX_')) {
    return new AgentStreamRouteError(codeCandidate, codeCandidate.toLowerCase());
  }
  const message = error instanceof Error ? error.message : 'agent_stream_error';
  const sandboxStatusMatch = message.match(/sandbox_manager_error:\s*[a-z_]+\s+(\d{3})\b/i)
    ?? message.match(/sandbox_manager_error:\s*(\d{3})\b/i);
  const sandboxStatus = sandboxStatusMatch ? Number.parseInt(sandboxStatusMatch[1], 10) : null;
  if (sandboxStatus === 403) {
    return new AgentStreamRouteError('AGENT_SANDBOX_FORBIDDEN', 'agent_sandbox_forbidden');
  }
  if (sandboxStatus === 404) {
    return new AgentStreamRouteError('AGENT_SANDBOX_NOT_FOUND', 'agent_sandbox_not_found');
  }
  if (sandboxStatus !== null && sandboxStatus >= 500) {
    return new AgentStreamRouteError('AGENT_SANDBOX_UNAVAILABLE', 'agent_sandbox_unavailable');
  }
  if (message === 'agent_offline') {
    return new AgentStreamRouteError('AGENT_OFFLINE', 'agent_offline');
  }
  if (message === 'agent_workspace_mismatch') {
    return new AgentStreamRouteError('AGENT_WORKSPACE_MISMATCH', 'agent_workspace_mismatch');
  }
  return new AgentStreamRouteError('AGENT_STREAM_ERROR', message);
}

function endpointSupportsMultimodal(endpoint: { capabilities?: Array<{ type: string; enabled: boolean }> }): boolean {
  return (
    endpoint.capabilities?.some(
      (capability) => capability.type === 'multimodal_completion' && capability.enabled,
    ) ?? false
  );
}

function toDataUrl(attachment: ChatAttachmentRecord, mimeType: string | null): string | null {
  return toImageDataUrl(attachment.content_base64, mimeType);
}

function buildProxyUsername(user: AuthenticatedUser): string {
  const base = (user.email || user.id || 'unknown').toLowerCase();
  return base.replace(/[^a-z0-9._-]/g, '_').slice(0, 64) || 'unknown';
}

function readLegacyAttachmentIds(rawAttachments: unknown): string[] | null {
  if (rawAttachments == null) return [];
  if (!Array.isArray(rawAttachments)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of rawAttachments) {
    if (typeof item !== 'string' || item.length === 0) return null;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

async function toDataUrlFromAttachmentOrSourceObject(
  deps: ChatStreamHandlerArgs['deps'],
  route: { workspaceId: string; projectId: string },
  attachment: ChatAttachmentRecord,
  mimeType: string | null,
): Promise<string | null> {
  const inline = toDataUrl(attachment, mimeType);
  if (inline) return inline;
  if (!mimeType || !attachment.source_library_id || !attachment.source_object_key) return null;
  try {
    const downloaded = await deps.downloadSourceObjectUseCase.execute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: attachment.source_library_id,
      key: attachment.source_object_key,
    });
    const nodeStream = Readable.fromWeb(downloaded.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    const chunks: Buffer[] = [];
    for await (const chunk of nodeStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return `data:${mimeType};base64,${Buffer.concat(chunks).toString('base64')}`;
  } catch {
    return null;
  }
}

export async function handleChatStreamRoute(args: ChatStreamHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, json, readBody, buildUpstreamUrl, sseWrite } = args;
  const isWritable = (candidate: http.ServerResponse): boolean =>
    !candidate.writableEnded && !candidate.destroyed;

  const registerClient = (streamId: string, client: http.ServerResponse) => {
    const record = ACTIVE_CHAT_STREAMS.get(streamId);
    if (!record) return;
    record.clients.add(client);
    client.once('close', () => {
      record.clients.delete(client);
    });
  };

  const broadcast = (streamId: string, event: string, data: unknown) => {
    const record = ACTIVE_CHAT_STREAMS.get(streamId);
    if (!record) return;
    for (const client of record.clients) {
      if (!isWritable(client)) {
        record.clients.delete(client);
        continue;
      }
      try {
        sseWrite(client, event, data);
      } catch {
        record.clients.delete(client);
      }
    }
  };

  if (route.kind === 'chatMessagesStreamAttach' && method === 'GET') {
    const record = ACTIVE_CHAT_STREAMS.get(route.streamId);
    if (
      !record ||
      record.workspaceId !== route.workspaceId ||
      record.projectId !== route.projectId ||
      record.sessionId !== route.sessionId
    ) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_stream_not_found' });
      return true;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    registerClient(route.streamId, res);
    sseWrite(res, 'meta', {
      stream_id: route.streamId,
      session_id: record.sessionId,
      model: record.model,
      endpoint_id: record.endpointId,
      assistant_message_id: record.assistantMessageId,
      parent_message_id: record.parentMessageId,
      variant_group_id: record.variantGroupId,
      variant_index: record.variantIndex,
    });
    if (record.contentSoFar.length > 0) {
      sseWrite(res, 'delta', {
        message_id: record.assistantMessageId,
        delta: record.contentSoFar,
      });
    }
    return true;
  }

  if (route.kind !== 'chatMessagesStream' || method !== 'POST') {
    return false;
  }

  const session = await deps.chatResourceService.getSession(
    route.workspaceId,
    route.projectId,
    route.sessionId,
  );
  if (!session) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
    return true;
  }
  const runningStreams = listActiveSessionStreams(route.workspaceId, route.projectId, route.sessionId);
  if (runningStreams.length > 0) {
    logChatStreamEvent({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      endpointId: session.endpoint_id,
      status: 'rejected',
      stopReason: 'session_stream_conflict',
    });
    json(res, 409, {
      error_code: 'CHAT_SESSION_STREAM_CONFLICT',
      message: 'chat_session_stream_conflict',
    });
    return true;
  }

  const raw = (await readBody(req)) as {
    model?: string;
    endpoint_id?: string;
    from_message_id?: string;
    branch_leaf_message_id?: string;
    input?: { role?: 'user'; content?: string; inputs?: unknown; attachments?: unknown };
  };
  const useExternalAgent = typeof session.external_agent_id === 'string' && session.external_agent_id.length > 0;
  const endpointId = useExternalAgent ? null : (raw.endpoint_id ?? session.endpoint_id);
  const endpoint = endpointId
    ? await deps.endpointResourceService.getEndpoint(route.workspaceId, route.projectId, endpointId)
    : null;
  if (!useExternalAgent) {
    if (!endpoint || endpoint.status !== 'active' || !endpoint.credential_ref) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_endpoint_unavailable' });
      return true;
    }
    const endpointPolicyCheck = isProjectResourceAccessAllowedForUser({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      userId: user.id,
    });
    if (!endpointPolicyCheck.allowed) {
      json(res, 403, {
        error_code: 'RESOURCE_POLICY_DENIED',
        message: 'resource_policy_denied',
        resource_type: 'endpoint',
        resource_id: endpoint.id,
      });
      return true;
    }
    const endpointRateCheck = checkAndConsumeProjectResourceRateLimitsForUser({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      resourceType: 'endpoint',
      resourceId: endpoint.id,
      userId: user.id,
      policy: endpointPolicyCheck.policy,
    });
    if (!endpointRateCheck.allowed) {
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'resource_policy.rate_limited',
        result: 'error',
        resourceType: 'endpoint',
        resourceId: endpoint.id,
        errorCode: 'RESOURCE_POLICY_RATE_LIMITED',
        errorMessage: 'resource_policy_rate_limited',
        metadata: {
          governance_kind: 'resource_policy',
          enforcement_kind: 'rate_limit',
          effective_limit_per_minute: endpointRateCheck.effective_limit_per_minute,
          retry_after_seconds: endpointRateCheck.retry_after_seconds,
          scope: endpointRateCheck.scope,
          rate_key: 'endpoint.requests_per_minute',
          source: 'chat_stream_preflight',
          session_id: route.sessionId,
        },
      });
      await writeProjectUsageFact(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        resourceType: 'endpoint',
        resourceId: endpoint.id,
        endUserId: user.id,
        requests: 1,
        result: 'error',
        errorCode: 'RESOURCE_POLICY_RATE_LIMITED',
        metadata: {
          stage: 'preflight',
          governance_kind: 'resource_policy',
          enforcement_kind: 'rate_limit',
          effective_limit_per_minute: endpointRateCheck.effective_limit_per_minute,
          retry_after_seconds: endpointRateCheck.retry_after_seconds,
          scope: endpointRateCheck.scope,
          rate_key: 'endpoint.requests_per_minute',
          source: 'chat_stream_preflight',
          session_id: route.sessionId,
        },
      });
      res.setHeader('Retry-After', String(endpointRateCheck.retry_after_seconds));
      json(res, 429, {
        error_code: 'RESOURCE_POLICY_RATE_LIMITED',
        message: 'resource_policy_rate_limited',
        resource_type: 'endpoint',
        resource_id: endpoint.id,
        retry_after_seconds: endpointRateCheck.retry_after_seconds,
      });
      return true;
    }
  }
  const apiKey = endpoint?.credential_ref
    ? await deps.endpointResourceService.getCredentialSecret(
      route.workspaceId,
      route.projectId,
      endpoint.credential_ref,
    )
    : null;
  if (!useExternalAgent && !apiKey) {
    json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_endpoint_credential_missing' });
    return true;
  }

  const fromMessage = raw.from_message_id
    ? await deps.chatResourceService.getMessage(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      raw.from_message_id,
    )
    : null;
  if (raw.from_message_id && !fromMessage) {
    json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_from_message_not_found' });
    return true;
  }

  let parentForAssistant: string | null = null;
  if (fromMessage?.role === 'assistant') {
    parentForAssistant = fromMessage.parent_id ?? null;
  } else if (fromMessage?.role === 'user') {
    parentForAssistant = fromMessage.id;
  } else if (raw.branch_leaf_message_id) {
    parentForAssistant = raw.branch_leaf_message_id;
  }

  if (raw.input?.content?.trim()) {
    const inputRefs = readChatMessageInputs(raw.input.inputs);
    const legacyAttachmentIds = readLegacyAttachmentIds(raw.input.attachments);
    if (inputRefs === null) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_input_refs_invalid' });
      return true;
    }
    if (legacyAttachmentIds === null) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_input_refs_invalid' });
      return true;
    }
    if (inputRefs.length + legacyAttachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
      return true;
    }
    let attachmentSnapshots: Array<{
      id: string;
      file_name: string;
      file_type: string;
      file_size: number;
      input_ref?: ChatAttachmentRecord['input_ref'];
      source_type?: 'local_upload' | 'library_import';
      source_library_id?: string;
      source_object_key?: string;
    }> = [];
    if (inputRefs.length > 0 || legacyAttachmentIds.length > 0) {
      if (useExternalAgent) {
        const agent = await deps.agentResourceService.getAgent(
          route.workspaceId,
          route.projectId,
          session.external_agent_id ?? '',
        );
        if (!agent || !agent.capabilities?.multimodal_completion) {
          json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'external_agent_not_multimodal' });
          return true;
        }
      } else if (!endpoint || !endpointSupportsMultimodal(endpoint)) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_endpoint_not_multimodal' });
        return true;
      }
      const allSessionAttachments = await deps.chatResourceService.listAttachments(
        route.workspaceId,
        route.projectId,
        route.sessionId,
      );
      const byRef = indexChatAttachmentsByLibraryObjectRef(allSessionAttachments);
      const byId = new Map(allSessionAttachments.map((attachment) => [attachment.id, attachment] as const));
      const resolvedFromInputRefs = resolveChatInputsFromAttachmentIndex(inputRefs, byRef);
      const resolvedFromLegacyIds = legacyAttachmentIds.map((id) => byId.get(id) ?? null);
      const resolvedAttachments = [...resolvedFromInputRefs, ...resolvedFromLegacyIds];
      if (resolvedAttachments.some((item) => item === null)) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_not_found' });
        return true;
      }
      const attachments: ChatAttachmentRecord[] = [];
      const seenAttachmentIds = new Set<string>();
      for (const attachment of resolvedAttachments as ChatAttachmentRecord[]) {
        if (seenAttachmentIds.has(attachment.id)) continue;
        seenAttachmentIds.add(attachment.id);
        attachments.push(attachment);
      }
      const notReady = attachments.find((item) => item.upload_status !== 'ready');
      if (notReady) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_not_ready' });
        return true;
      }
      const totalSize = attachments.reduce((acc, item) => acc + item.file_size, 0);
      if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE_BYTES) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
        return true;
      }
      attachmentSnapshots = toChatAttachmentSnapshots(attachments);
    }
    let branchLeaf: {
      id: string;
      role: string;
      content: string;
      attachment_snapshots?: Array<{ id: string }>;
    } | null = null;
    if (raw.branch_leaf_message_id) {
      branchLeaf = await deps.chatResourceService.getMessage(
        route.workspaceId,
        route.projectId,
        route.sessionId,
        raw.branch_leaf_message_id,
      );
      if (!branchLeaf) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_branch_leaf_not_found' });
        return true;
      }
    }
    const branchLeafAttachmentIds = new Set((branchLeaf?.attachment_snapshots ?? []).map((item) => item.id));
    const canReuseLeafUser =
      !!branchLeaf &&
      branchLeaf.role === 'user' &&
      branchLeaf.content === raw.input.content &&
      attachmentSnapshots.length === branchLeafAttachmentIds.size &&
      attachmentSnapshots.every((item) => branchLeafAttachmentIds.has(item.id));
    if (canReuseLeafUser && branchLeaf) {
      parentForAssistant = branchLeaf.id;
    } else {
      const createdInput = await deps.chatResourceService.createMessage({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sessionId: route.sessionId,
        role: 'user',
        content: raw.input.content,
        parentId: raw.branch_leaf_message_id ?? null,
        logicalId: undefined,
        attachmentSnapshots: attachmentSnapshots.length > 0 ? attachmentSnapshots : undefined,
      });
      parentForAssistant = createdInput.id;
    }
  }

  if (!parentForAssistant) {
    const history = await deps.chatResourceService.listMessages(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    const latestUser = [...history].reverse().find((item) => item.role === 'user');
    parentForAssistant = latestUser?.id ?? null;
  }
  if (!parentForAssistant) {
    json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_parent_message_not_found' });
    return true;
  }

  const messages = await deps.chatResourceService.listMessages(
    route.workspaceId,
    route.projectId,
    route.sessionId,
  );
  const attachmentIds = Array.from(
    new Set(
      messages.flatMap((message) => (message.attachment_snapshots ?? []).map((snapshot) => snapshot.id)),
    ),
  );
  const attachmentById = new Map<string, ChatAttachmentRecord>();
  if (attachmentIds.length > 0) {
    const attachments = await deps.chatResourceService.listAttachmentsByIds(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      attachmentIds,
    );
    for (const attachment of attachments) {
      attachmentById.set(attachment.id, attachment);
    }
  }

  let missingImageDataUrl = false;
  const upstreamMessages = await Promise.all(messages.map(async (item) => {
    if (item.role !== 'user' || !item.attachment_snapshots || item.attachment_snapshots.length === 0) {
      return { role: item.role, content: item.content };
    }
    const parts: Array<Record<string, unknown>> = [];
    if (item.content.trim().length > 0) {
      parts.push({ type: 'text', text: item.content });
    }
    for (const snapshot of item.attachment_snapshots) {
      const attachment = attachmentById.get(snapshot.id);
      const imageMimeType = resolveImageMimeType(snapshot.file_type, snapshot.file_name);
      const dataUrl = attachment
        ? await toDataUrlFromAttachmentOrSourceObject(
            deps,
            { workspaceId: route.workspaceId, projectId: route.projectId },
            attachment,
            imageMimeType,
          )
        : null;
      if (dataUrl && imageMimeType) {
        parts.push({
          type: 'image_url',
          image_url: { url: dataUrl },
        });
      } else if (imageMimeType) {
        missingImageDataUrl = true;
      } else {
        parts.push({
          type: 'text',
          text: `[attached_file] ${snapshot.file_name} (${snapshot.file_type}, ${snapshot.file_size}B)`,
        });
      }
    }
    if (parts.length === 0) {
      return { role: item.role, content: item.content };
    }
    return { role: item.role, content: parts };
  }));
  if (missingImageDataUrl) {
    json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_image_data_url_unavailable' });
    return true;
  }

  const variantMeta = await deps.chatResourceService.buildNextAssistantVariant(
    route.workspaceId,
    route.projectId,
    route.sessionId,
    parentForAssistant,
    fromMessage,
  );
  const createdAssistant = await deps.chatResourceService.createMessage({
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    sessionId: route.sessionId,
    role: 'assistant',
    content: '',
    messageStatus: 'streaming',
    parentId: parentForAssistant,
    variantGroupId: variantMeta.variantGroupId,
    variantIndex: variantMeta.variantIndex,
  });

  const streamAbortController = new AbortController();
  const streamId = `stream_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const streamStartedAt = new Date().toISOString();
  const streamStartedAtMs = Date.now();
  const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;
  await writeProjectAuditEvent(deps, {
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    actor: { type: 'user', id: user.id },
    action: 'chat.run.started',
    resourceType: 'chat',
    resourceId: route.sessionId,
    requestId,
    metadata: {
      stream_id: streamId,
      endpoint_id: endpoint?.id ?? null,
      external_agent_id: session.external_agent_id ?? null,
    },
  });
  const streamEndpointId = useExternalAgent ? `agent:${session.external_agent_id}` : (endpoint?.id ?? '');
  const streamModel = useExternalAgent ? (raw.model ?? session.model) : (endpoint?.openai_model ?? session.model);
  ACTIVE_CHAT_STREAMS.set(streamId, {
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    sessionId: route.sessionId,
    abortController: streamAbortController,
    startedAt: streamStartedAt,
    status: 'running',
    assistantMessageId: createdAssistant.id,
    parentMessageId: parentForAssistant,
    variantGroupId: variantMeta.variantGroupId,
    variantIndex: variantMeta.variantIndex,
    endpointId: streamEndpointId,
    model: streamModel,
    contentSoFar: '',
    clients: new Set(),
  });
  registerClient(streamId, res);
  logChatStreamEvent({
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    sessionId: route.sessionId,
    streamId,
    endpointId: streamEndpointId,
    status: 'running',
  });
  await writeStreamRegistry(
    deps.cache,
    {
      streamId,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      status: 'running',
      updatedAt: new Date().toISOString(),
    },
    STREAM_REGISTRY_TTL_SECONDS,
  );
  await writeSessionStreamState(
    deps.cache,
    route.workspaceId,
    route.projectId,
    route.sessionId,
    'running',
    STREAM_REGISTRY_TTL_SECONDS,
  );

  if (useExternalAgent) {
    const externalAgentId = session.external_agent_id ?? '';
    let internalKeepaliveTimer: NodeJS.Timeout | undefined;
    const clearInternalKeepalive = () => {
      if (!internalKeepaliveTimer) return;
      clearInterval(internalKeepaliveTimer);
      internalKeepaliveTimer = undefined;
    };
    try {
      const rawBearerToken = extractBearerToken(req);
      if (!rawBearerToken) {
        throw new AgentStreamRouteError('UNAUTHORIZED', 'user_token_missing');
      }
      const agent = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, externalAgentId);
      if (agent?.mode === 'internal') {
        if (!deps.internalAgentPodManager) {
          throw new AgentStreamRouteError('AGENT_SANDBOX_NOT_CONFIGURED', 'agent_sandbox_not_configured');
        }
        const workloadId = sanitizeWorkloadId(route.sessionId);
        await deps.internalAgentPodManager.ensureAgentReady({
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          workloadId,
          agent,
        });
        await deps.internalAgentPodManager.keepalive(
          route.workspaceId,
          route.projectId,
          workloadId,
        ).catch(() => undefined);
        internalKeepaliveTimer = setInterval(() => {
          void deps.internalAgentPodManager?.keepalive(
            route.workspaceId,
            route.projectId,
            workloadId,
          ).catch(() => undefined);
        }, 60_000);
      }
      const thirdPartyCredentialFiles = await buildRuntimeThirdPartyCredentialFiles(
        deps.docStore,
        user.id,
      );
      const dispatched = await deps.agentRuntimeService.dispatchStreamingRequest({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sessionId: route.sessionId,
        agentId: externalAgentId,
        model: raw.model ?? session.model,
        messages: upstreamMessages,
        runtimeContext: {
          workspace_id: route.workspaceId,
          project_id: route.projectId,
          username: buildProxyUsername(user),
          user_bearer_token: rawBearerToken,
          credential_files: thirdPartyCredentialFiles,
          model: raw.model ?? session.model,
          notebook_mode: false,
        },
      });

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('x-chat-stream-id', streamId);
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }
      broadcast(streamId, 'meta', {
        stream_id: streamId,
        session_id: route.sessionId,
        model: streamModel,
        endpoint_id: streamEndpointId,
        assistant_message_id: createdAssistant.id,
        parent_message_id: parentForAssistant,
        variant_group_id: variantMeta.variantGroupId,
        variant_index: variantMeta.variantIndex,
      });

      const pingTimer = setInterval(() => {
        const record = ACTIVE_CHAT_STREAMS.get(streamId);
        if (!record || record.clients.size === 0) return;
        broadcast(streamId, 'ping', { ts: Date.now() });
      }, 15_000);

      let assistantText = '';
      let finishReason: string | null = null;
      let usageTokens: number | undefined;
      let messageStatus: 'streaming' | 'completed' | 'stopped' | 'failed' = 'completed';
      let agentErrorCode: string | null = null;
      let agentErrorMessage: string | null = null;
      let persistedLength = 0;
      const persistAssistantProgress = async (force: boolean) => {
        if (!force && assistantText.length - persistedLength < 32) {
          return;
        }
        await deps.chatResourceService.updateAssistantMessage(
          route.workspaceId,
          route.projectId,
          route.sessionId,
          createdAssistant.id,
          {
            content: assistantText,
            messageStatus: 'streaming',
          },
        );
        persistedLength = assistantText.length;
      };

      const active = ACTIVE_CHAT_STREAMS.get(streamId);
      if (active) {
        const originalAbort = active.abortController.abort.bind(active.abortController);
        active.abortController.abort = () => {
          dispatched.cancel();
          originalAbort();
        };
      }

      try {
        for await (const event of dispatched.stream) {
          if (event.type === 'delta') {
            if (!event.delta) continue;
            assistantText += event.delta;
            const record = ACTIVE_CHAT_STREAMS.get(streamId);
            if (record) record.contentSoFar = assistantText;
            broadcast(streamId, 'delta', { message_id: createdAssistant.id, delta: event.delta });
            await persistAssistantProgress(false);
            continue;
          }
          if (event.type === 'done') {
            finishReason = event.finish_reason ?? 'stop';
            usageTokens = event.usage_tokens;
            break;
          }
          if (event.type === 'error') {
            messageStatus = 'failed';
            await deps.chatResourceService.updateAssistantMessage(
              route.workspaceId,
              route.projectId,
              route.sessionId,
              createdAssistant.id,
              {
                content: assistantText,
                finishReason: null,
                messageStatus: 'failed',
                errorCode: event.error_code ?? 'AGENT_UPSTREAM_ERROR',
                errorMessage: event.error_message ?? 'agent_upstream_error',
              },
            );
            agentErrorCode = event.error_code ?? 'AGENT_UPSTREAM_ERROR';
            agentErrorMessage = event.error_message ?? 'agent_upstream_error';
            break;
          }
        }
      } catch (error) {
        if (streamAbortController.signal.aborted) {
          messageStatus = 'stopped';
        } else {
          clearInterval(pingTimer);
          await writeStreamRegistry(
            deps.cache,
            {
              streamId,
              workspaceId: route.workspaceId,
              projectId: route.projectId,
              sessionId: route.sessionId,
              status: 'failed',
              updatedAt: new Date().toISOString(),
            },
            STREAM_REGISTRY_FINAL_TTL_SECONDS,
          );
          await writeSessionStreamState(
            deps.cache,
            route.workspaceId,
            route.projectId,
            route.sessionId,
            'failed',
            STREAM_REGISTRY_FINAL_TTL_SECONDS,
          );
          ACTIVE_CHAT_STREAMS.delete(streamId);
          logChatStreamEvent({
            workspaceId: route.workspaceId,
            projectId: route.projectId,
            sessionId: route.sessionId,
            streamId,
            endpointId: streamEndpointId,
            status: 'failed',
            durationMs: Date.now() - streamStartedAtMs,
            stopReason: 'upstream_error',
          });
          throw error;
        }
      }

      if (agentErrorCode) {
        clearInterval(pingTimer);
        broadcast(streamId, 'error', {
          error_code: agentErrorCode,
          message: agentErrorMessage ?? 'agent_upstream_error',
          request_id: dispatched.requestId,
        });
        const activeRecord = ACTIVE_CHAT_STREAMS.get(streamId);
        if (activeRecord) {
          for (const client of activeRecord.clients) {
            if (isWritable(client)) {
              client.end();
            }
          }
        }
        ACTIVE_CHAT_STREAMS.delete(streamId);
        await writeStreamRegistry(
          deps.cache,
          {
            streamId,
            workspaceId: route.workspaceId,
            projectId: route.projectId,
            sessionId: route.sessionId,
            status: 'failed',
            updatedAt: new Date().toISOString(),
          },
          STREAM_REGISTRY_FINAL_TTL_SECONDS,
        );
        await writeSessionStreamState(
          deps.cache,
          route.workspaceId,
          route.projectId,
          route.sessionId,
          'failed',
          STREAM_REGISTRY_FINAL_TTL_SECONDS,
        );
        logChatStreamEvent({
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          sessionId: route.sessionId,
          streamId,
          endpointId: streamEndpointId,
          status: 'failed',
          durationMs: Date.now() - streamStartedAtMs,
          stopReason: 'upstream_error',
        });
        return true;
      }

      await persistAssistantProgress(true);
      const finalized = await deps.chatResourceService.updateAssistantMessage(
        route.workspaceId,
        route.projectId,
        route.sessionId,
        createdAssistant.id,
        {
          content: assistantText,
          finishReason,
          tokens: usageTokens,
          messageStatus,
        },
      );
      clearInterval(pingTimer);
      const activeRecord = ACTIVE_CHAT_STREAMS.get(streamId);
      const stopReason = messageStatus === 'stopped' ? activeRecord?.stopReason ?? 'session_stop' : undefined;
      if (activeRecord) {
        activeRecord.status = 'finished';
      }
      broadcast(streamId, 'done', {
        message_id: finalized?.id ?? createdAssistant.id,
        finish_reason: finishReason,
        tokens: usageTokens,
        message_status: messageStatus,
      });
      if (activeRecord) {
        for (const client of activeRecord.clients) {
          if (isWritable(client)) {
            client.end();
          }
        }
      }
      ACTIVE_CHAT_STREAMS.delete(streamId);
      await writeStreamRegistry(
        deps.cache,
        {
          streamId,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          sessionId: route.sessionId,
          status: messageStatus === 'stopped' ? 'stopped' : 'completed',
          updatedAt: new Date().toISOString(),
        },
        STREAM_REGISTRY_FINAL_TTL_SECONDS,
      );
      await writeSessionStreamState(
        deps.cache,
        route.workspaceId,
        route.projectId,
        route.sessionId,
        messageStatus === 'stopped' ? 'stopped' : 'completed',
        STREAM_REGISTRY_FINAL_TTL_SECONDS,
      );
      logChatStreamEvent({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sessionId: route.sessionId,
        streamId,
        endpointId: streamEndpointId,
        status: messageStatus === 'stopped' ? 'stopped' : 'completed',
        durationMs: Date.now() - streamStartedAtMs,
        stopReason,
      });
      return true;
    } catch (error) {
      ACTIVE_CHAT_STREAMS.delete(streamId);
      const mappedError = mapAgentDispatchError(error);
      await writeStreamRegistry(
        deps.cache,
        {
          streamId,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          sessionId: route.sessionId,
          status: 'failed',
          updatedAt: new Date().toISOString(),
        },
        STREAM_REGISTRY_FINAL_TTL_SECONDS,
      );
      await writeSessionStreamState(
        deps.cache,
        route.workspaceId,
        route.projectId,
        route.sessionId,
        'failed',
        STREAM_REGISTRY_FINAL_TTL_SECONDS,
      );
      await deps.chatResourceService.updateAssistantMessage(
        route.workspaceId,
        route.projectId,
        route.sessionId,
        createdAssistant.id,
        {
          messageStatus: 'failed',
          errorCode: mappedError.code,
          errorMessage: mappedError.message,
        },
      );
      if (!res.headersSent) {
        const statusCode = mappedError.code === 'UNAUTHORIZED'
          ? 401
          : mappedError.code === 'AGENT_SANDBOX_RATE_LIMITED'
            ? 429
            : (mappedError.code.startsWith('AGENT_SANDBOX_') ? 422 : 502);
        json(res, statusCode, { error_code: mappedError.code, message: mappedError.message });
      } else if (isWritable(res)) {
        broadcast(streamId, 'error', {
          error_code: mappedError.code,
          message: mappedError.message,
        });
        res.end();
      }
      return true;
    } finally {
      clearInternalKeepalive();
    }
  }

  if (!endpoint || !apiKey) {
    json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_endpoint_unavailable' });
    return true;
  }

  const isAnthropicCompatible = endpoint.protocol === 'anthropic_compatible';
  const upstreamProxyPath = isAnthropicCompatible ? 'messages' : 'chat/completions';
  const upstreamUrl = buildUpstreamUrl(endpoint.base_url, upstreamProxyPath);
  const sourceRequestBody = {
    model: raw.model ?? endpoint.openai_model,
    stream: true,
    messages: upstreamMessages,
  };
  const upstreamRequestBody = isAnthropicCompatible
    ? openAiChatRequestToAnthropic(sourceRequestBody)
    : sourceRequestBody;
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamRequestBody),
      signal: streamAbortController.signal,
    });
  } catch (error) {
    ACTIVE_CHAT_STREAMS.delete(streamId);
    if (streamAbortController.signal.aborted) {
      logChatStreamEvent({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sessionId: route.sessionId,
        streamId,
        endpointId: endpoint.id,
        status: 'stopped',
        durationMs: Date.now() - streamStartedAtMs,
        stopReason: ACTIVE_CHAT_STREAMS.get(streamId)?.stopReason ?? 'session_stop',
      });
      await writeStreamRegistry(
        deps.cache,
        {
          streamId,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          sessionId: route.sessionId,
          status: 'stopped',
          updatedAt: new Date().toISOString(),
        },
        STREAM_REGISTRY_FINAL_TTL_SECONDS,
      );
      await deps.chatResourceService.updateAssistantMessage(
        route.workspaceId,
        route.projectId,
        route.sessionId,
        createdAssistant.id,
        { messageStatus: 'stopped' },
      );
      await writeSessionStreamState(
        deps.cache,
        route.workspaceId,
        route.projectId,
        route.sessionId,
        'stopped',
        STREAM_REGISTRY_FINAL_TTL_SECONDS,
      );
      return true;
    }
    await writeStreamRegistry(
      deps.cache,
      {
        streamId,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sessionId: route.sessionId,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      },
      STREAM_REGISTRY_FINAL_TTL_SECONDS,
    );
    await writeSessionStreamState(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
      'failed',
      STREAM_REGISTRY_FINAL_TTL_SECONDS,
    );
    await deps.chatResourceService.updateAssistantMessage(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      createdAssistant.id,
      {
        content: '',
        finishReason: null,
        messageStatus: 'failed',
        errorCode: 'STREAM_UPSTREAM_CONNECT_ERROR',
        errorMessage: error instanceof Error ? error.message : 'stream_upstream_connect_error',
      },
    );
    json(res, 502, { error_code: 'STREAM_UPSTREAM_CONNECT_ERROR', message: 'chat_upstream_unreachable' });
    logChatStreamEvent({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      streamId,
      endpointId: endpoint.id,
      status: 'failed',
      durationMs: Date.now() - streamStartedAtMs,
      stopReason: 'upstream_error',
    });
    return true;
  }

  if (!upstreamRes.ok) {
    ACTIVE_CHAT_STREAMS.delete(streamId);
    await writeStreamRegistry(
      deps.cache,
      {
        streamId,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sessionId: route.sessionId,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      },
      STREAM_REGISTRY_FINAL_TTL_SECONDS,
    );
    await writeSessionStreamState(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
      'failed',
      STREAM_REGISTRY_FINAL_TTL_SECONDS,
    );
    await deps.chatResourceService.updateAssistantMessage(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      createdAssistant.id,
      {
        content: '',
        finishReason: null,
        messageStatus: 'failed',
        errorCode: `STREAM_UPSTREAM_${upstreamRes.status}`,
        errorMessage: `chat_upstream_status_${upstreamRes.status}`,
      },
    );
    const completionPayload = await upstreamRes.json().catch(() => ({}));
    json(res, upstreamRes.status, completionPayload);
    logChatStreamEvent({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      streamId,
      endpointId: endpoint.id,
      status: 'failed',
      durationMs: Date.now() - streamStartedAtMs,
      stopReason: 'upstream_error',
    });
    return true;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('x-chat-stream-id', streamId);
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  broadcast(streamId, 'meta', {
    stream_id: streamId,
    session_id: route.sessionId,
    model: endpoint.openai_model,
    endpoint_id: endpoint.id,
    assistant_message_id: createdAssistant.id,
    parent_message_id: parentForAssistant,
    variant_group_id: variantMeta.variantGroupId,
    variant_index: variantMeta.variantIndex,
  });
  const pingTimer = setInterval(() => {
    const record = ACTIVE_CHAT_STREAMS.get(streamId);
    if (!record || record.clients.size === 0) return;
    broadcast(streamId, 'ping', { ts: Date.now() });
  }, 15_000);

  let assistantText = '';
  let persistedLength = 0;
  let finishReason: string | null = null;
  let usageTokens: number | undefined;
  let messageStatus: 'streaming' | 'completed' | 'stopped' | 'failed' = 'completed';
  const inactivityTimeoutMs = Math.max(
    5_000,
    Number(process.env.CHAT_STREAM_INACTIVITY_TIMEOUT_MS ?? '120000'),
  );
  const persistAssistantProgress = async (force: boolean) => {
    if (!force && assistantText.length - persistedLength < 32) {
      return;
    }
    await deps.chatResourceService.updateAssistantMessage(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      createdAssistant.id,
      {
        content: assistantText,
        messageStatus: 'streaming',
      },
    );
    persistedLength = assistantText.length;
  };
  const contentType = upstreamRes.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('text/event-stream') && upstreamRes.body) {
      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done) {
        const registry = await readStreamRegistry(deps.cache, streamId);
        if (registry?.status === 'stopping') {
          streamAbortController.abort();
          break;
        }
        const result = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('stream_inactivity_timeout')), inactivityTimeoutMs);
          reader.read().then(
            (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            (error: unknown) => {
              clearTimeout(timer);
              reject(error);
            },
          );
        });
        done = result.done;
        buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !done });
        const sepIndex = buffer.lastIndexOf('\n\n');
        if (sepIndex < 0) continue;
        const consumable = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const chunks = parseOpenAIStreamChunk(consumable);
        for (const chunk of chunks) {
          if (chunk.done) {
            if (chunk.finishReason) {
              finishReason = chunk.finishReason;
            }
            if (chunk.usageTokens !== undefined) {
              usageTokens = chunk.usageTokens;
            }
            continue;
          }
          if (chunk.usageTokens !== undefined) {
            usageTokens = chunk.usageTokens;
          }
          assistantText += chunk.delta;
          const record = ACTIVE_CHAT_STREAMS.get(streamId);
          if (record) record.contentSoFar = assistantText;
          broadcast(streamId, 'delta', { message_id: createdAssistant.id, delta: chunk.delta });
        }
        await persistAssistantProgress(false);
      }
      if (buffer.trim().length > 0) {
        const chunks = parseOpenAIStreamChunk(buffer);
        for (const chunk of chunks) {
          if (chunk.done) {
            if (chunk.finishReason) {
              finishReason = chunk.finishReason;
            }
            if (chunk.usageTokens !== undefined) {
              usageTokens = chunk.usageTokens;
            }
            continue;
          }
          if (chunk.usageTokens !== undefined) {
            usageTokens = chunk.usageTokens;
          }
          assistantText += chunk.delta;
          const record = ACTIVE_CHAT_STREAMS.get(streamId);
          if (record) record.contentSoFar = assistantText;
          broadcast(streamId, 'delta', { message_id: createdAssistant.id, delta: chunk.delta });
        }
      }
    } else {
      const completionPayloadRaw = await upstreamRes.json().catch(() => ({}));
      const completionPayload = isAnthropicCompatible
        ? anthropicResponseToOpenAiChat(
          completionPayloadRaw as Record<string, unknown>,
          sourceRequestBody as Record<string, unknown>,
        )
        : completionPayloadRaw;
      assistantText = safeAssistantContent(completionPayload);
      finishReason = safeAssistantFinishReason(completionPayload);
      usageTokens = safeAssistantUsageTokens(completionPayload);
      const record = ACTIVE_CHAT_STREAMS.get(streamId);
      if (record) record.contentSoFar = assistantText;
      if (assistantText.length > 0) {
        broadcast(streamId, 'delta', { message_id: createdAssistant.id, delta: assistantText });
      }
    }
  } catch (error) {
    if (streamAbortController.signal.aborted) {
      messageStatus = 'stopped';
    } else {
      messageStatus = 'failed';
      const errorCode =
        error instanceof Error && error.message === 'stream_inactivity_timeout'
          ? 'STREAM_INACTIVITY_TIMEOUT'
          : 'STREAM_UPSTREAM_ERROR';
      await deps.chatResourceService.updateAssistantMessage(
        route.workspaceId,
        route.projectId,
        route.sessionId,
        createdAssistant.id,
        {
          content: assistantText,
          finishReason: finishReason ?? null,
          tokens: usageTokens,
          messageStatus: 'failed',
          errorCode,
          errorMessage: error instanceof Error ? error.message : 'stream_upstream_error',
        },
      );
      clearInterval(pingTimer);
      await writeStreamRegistry(
        deps.cache,
        {
          streamId,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          sessionId: route.sessionId,
          status: 'failed',
          updatedAt: new Date().toISOString(),
        },
        STREAM_REGISTRY_FINAL_TTL_SECONDS,
      );
      await writeSessionStreamState(
        deps.cache,
        route.workspaceId,
        route.projectId,
        route.sessionId,
        'failed',
        STREAM_REGISTRY_FINAL_TTL_SECONDS,
      );
      ACTIVE_CHAT_STREAMS.delete(streamId);
      logChatStreamEvent({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sessionId: route.sessionId,
        streamId,
        endpointId: endpoint.id,
        status: 'failed',
        durationMs: Date.now() - streamStartedAtMs,
        stopReason: errorCode === 'STREAM_INACTIVITY_TIMEOUT' ? 'timeout' : 'upstream_error',
      });
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'chat.run.failed',
        resourceType: 'chat',
        resourceId: route.sessionId,
        requestId,
        result: 'error',
        errorCode,
        errorMessage: error instanceof Error ? error.message : 'stream_upstream_error',
        metadata: {
          stream_id: streamId,
          endpoint_id: endpoint.id,
          duration_ms: Date.now() - streamStartedAtMs,
        },
      });
      await writeProjectUsageFact(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        resourceType: 'chat',
        resourceId: route.sessionId,
        requestId,
        requests: 1,
        durationMs: Date.now() - streamStartedAtMs,
        tokensTotal: usageTokens ?? undefined,
        result: 'error',
        errorCode,
        metadata: { stream_id: streamId, endpoint_id: endpoint.id },
      });
      if (useExternalAgent && session.external_agent_id) {
        await writeProjectUsageFact(deps, {
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          resourceType: 'agent',
          resourceId: session.external_agent_id,
          endUserId: user.id,
          requestId,
          requests: 1,
          durationMs: Date.now() - streamStartedAtMs,
          result: 'error',
          errorCode,
          metadata: { stream_id: streamId, source: 'chat_stream', session_id: route.sessionId },
        });
      }
      throw error;
    }
  }

  await persistAssistantProgress(true);
  const finalized = await deps.chatResourceService.updateAssistantMessage(
    route.workspaceId,
    route.projectId,
    route.sessionId,
    createdAssistant.id,
    {
      content: assistantText,
      finishReason,
      tokens: usageTokens,
      messageStatus,
    },
  );
  clearInterval(pingTimer);
  const active = ACTIVE_CHAT_STREAMS.get(streamId);
  const durationMs = Date.now() - streamStartedAtMs;
  const stopReason =
    messageStatus === 'stopped'
      ? active?.stopReason ?? 'session_stop'
      : undefined;
  if (active) {
    active.status = 'finished';
  }
  broadcast(streamId, 'done', {
    message_id: finalized?.id ?? createdAssistant.id,
    finish_reason: finishReason,
    tokens: usageTokens,
    message_status: messageStatus,
  });
  if (active) {
    for (const client of active.clients) {
      if (isWritable(client)) {
        client.end();
      }
    }
  }
  ACTIVE_CHAT_STREAMS.delete(streamId);
  await writeStreamRegistry(
    deps.cache,
    {
      streamId,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      status: messageStatus === 'stopped' ? 'stopped' : 'completed',
      updatedAt: new Date().toISOString(),
    },
    STREAM_REGISTRY_FINAL_TTL_SECONDS,
  );
  await writeSessionStreamState(
    deps.cache,
    route.workspaceId,
    route.projectId,
    route.sessionId,
    messageStatus === 'stopped' ? 'stopped' : 'completed',
    STREAM_REGISTRY_FINAL_TTL_SECONDS,
  );
  logChatStreamEvent({
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    sessionId: route.sessionId,
    streamId,
    endpointId: endpoint.id,
    status: messageStatus === 'stopped' ? 'stopped' : 'completed',
    durationMs,
    stopReason,
  });
  await writeProjectAuditEvent(deps, {
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    actor: { type: 'user', id: user.id },
    action: messageStatus === 'stopped' ? 'chat.run.cancelled' : 'chat.run.completed',
    resourceType: 'chat',
    resourceId: route.sessionId,
    requestId,
    result: 'ok',
      metadata: {
        stream_id: streamId,
        endpoint_id: endpoint?.id ?? null,
        duration_ms: durationMs,
        tokens_total: usageTokens ?? null,
        stop_reason: stopReason ?? null,
    },
  });
  await writeProjectUsageFact(deps, {
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    resourceType: 'chat',
    resourceId: route.sessionId,
    requestId,
    requests: 1,
    durationMs,
    tokensTotal: usageTokens ?? undefined,
    result: 'ok',
    metadata: {
      stream_id: streamId,
      endpoint_id: endpoint?.id ?? null,
      message_status: messageStatus,
      stop_reason: stopReason ?? null,
    },
  });
  if (useExternalAgent && session.external_agent_id) {
    await writeProjectUsageFact(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      resourceType: 'agent',
      resourceId: session.external_agent_id,
      endUserId: user.id,
      requestId,
      requests: 1,
      durationMs,
      result: 'ok',
      metadata: {
        stream_id: streamId,
        source: 'chat_stream',
        session_id: route.sessionId,
        message_status: messageStatus,
        stop_reason: stopReason ?? null,
      },
    });
  }

  return true;
}
