import type http from 'node:http';
import { Buffer } from 'node:buffer';
import type { ChatRoute } from './chat-route-match.js';
import { resolveImageMimeType, toImageDataUrl } from './chat-image-utils.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { parsePagination } from './pagination.js';
import {
  ACTIVE_CHAT_STREAMS,
  type ChatSessionExecutionRecord,
  type ChatStopEscalationReason,
  type ChatStopMode,
  readSessionExecutionRecord,
  STREAM_REGISTRY_TTL_SECONDS,
  listActiveSessionStreams,
  requestSessionExecutionStopTransition,
  readStreamRegistry,
  stopActiveSessionStreams,
  writeStreamRegistry,
} from './chat-stream-state.js';
import {
  indexChatAttachmentsByLibraryObjectRef,
  readChatMessageInputs,
  resolveChatInputsFromAttachmentIndex,
  toChatAttachmentSnapshots,
  type ChatMessageInputRef,
} from './chat-input-refs.js';
import {
  resolveInputRef,
} from './input-ref-input-resolver.js';
import type { ChatSessionRecord } from './resource-models.js';

interface ChatNonStreamHandlerArgs {
  route: ChatRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  requestUrl: URL;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}

const MAX_ATTACHMENTS_PER_MESSAGE = 8;
const MAX_ATTACHMENT_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_SIZE_BYTES = 60 * 1024 * 1024;

type StopState = 'stopping' | 'terminating' | 'not_found_or_finished';
type ActiveStopState = Exclude<StopState, 'not_found_or_finished'> | 'running';

interface StopCapability {
  supportsTerminate: boolean;
  unavailableReason?: ChatStopEscalationReason;
}

function parseStopMode(raw: unknown): ChatStopMode | null {
  if (raw == null) return 'cancel';
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const mode = (raw as { mode?: unknown }).mode;
  if (mode == null) return 'cancel';
  return mode === 'cancel' || mode === 'terminate' ? mode : null;
}

async function resolveStopCapability(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  session?: ChatSessionRecord | null;
  execution?: ChatSessionExecutionRecord | null;
  allowAgentLookup?: boolean;
}): Promise<StopCapability> {
  void input;
  return {
    supportsTerminate: false,
    unavailableReason: 'STOP_ESCALATION_UNAVAILABLE',
  };
}

function resolveEffectiveStopMode(
  requestedMode: ChatStopMode,
  capability: StopCapability,
  execution?: ChatSessionExecutionRecord | null,
): ChatStopMode {
  if (execution?.stopMode === 'terminate') return 'terminate';
  return requestedMode === 'terminate' && capability.supportsTerminate ? 'terminate' : 'cancel';
}

function buildStopResponse(
  ids: { sessionId?: string; streamId?: string },
  input: {
    state: StopState;
    stopMode: ChatStopMode;
    capability: StopCapability;
  },
): Record<string, unknown> {
  const canEscalate = input.state !== 'not_found_or_finished'
    && input.capability.supportsTerminate
    && input.stopMode !== 'terminate';
  return {
    success: true,
    ...(ids.sessionId ? { session_id: ids.sessionId } : {}),
    ...(ids.streamId ? { stream_id: ids.streamId } : {}),
    state: input.state,
    status: input.state,
    stop_mode: input.stopMode,
    can_escalate: canEscalate,
    ...(!canEscalate && input.capability.unavailableReason
      ? { escalation_reason: input.capability.unavailableReason }
      : {}),
  };
}

function isActiveStopState(status: ChatSessionExecutionRecord['status']): status is ActiveStopState {
  return status === 'running' || status === 'stopping' || status === 'terminating';
}

function isActiveStreamRegistryStatus(
  status: NonNullable<Awaited<ReturnType<typeof readStreamRegistry>>>['status'],
): status is 'running' | 'stopping' | 'terminating' {
  return status === 'running' || status === 'stopping' || status === 'terminating';
}

function buildSessionStopTruth(
  execution: ChatSessionExecutionRecord | null,
  capability: StopCapability,
): Pick<ChatSessionRecord, 'execution_status' | 'termination_state' | 'stop_mode' | 'can_escalate' | 'escalation_reason'> {
  if (!execution) return {};
  const active = isActiveStopState(execution.status);
  const stopMode = execution.stopMode ?? (
    active ? execution.status === 'terminating' ? 'terminate' : 'cancel' : undefined
  );
  const canEscalate = active && capability.supportsTerminate && stopMode !== 'terminate';
  const escalationReason = canEscalate
    ? undefined
    : execution.stopEscalationReason ?? (active ? capability.unavailableReason : undefined);
  return {
    execution_status: execution.status,
    ...(stopMode ? { stop_mode: stopMode } : {}),
    can_escalate: canEscalate,
    ...(escalationReason ? { escalation_reason: escalationReason } : {}),
  };
}

async function attachSessionStopTruth(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  session: ChatSessionRecord;
}): Promise<ChatSessionRecord> {
  const execution = await readSessionExecutionRecord(
    input.deps.cache,
    input.workspaceId,
    input.projectId,
    input.session.id,
  );
  const capability = execution && isActiveStopState(execution.status)
    ? await resolveStopCapability({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      session: input.session,
      execution,
      allowAgentLookup: true,
    })
    : {
        supportsTerminate: false,
      };
  return {
    ...input.session,
    ...buildSessionStopTruth(execution, capability),
  };
}

function endpointSupportsMultimodal(endpoint: { capabilities?: Array<{ type: string; enabled: boolean }> }): boolean {
  return (
    endpoint.capabilities?.some(
      (capability) => capability.type === 'multimodal_completion' && capability.enabled,
    ) ?? false
  );
}

function validateAttachmentPayload(raw: {
  file_name?: string;
  file_type?: string;
  file_size?: number;
  content_base64?: string;
  input_ref?: {
    kind?: string;
    library_id?: string;
    key?: string;
    url?: string;
    imported_library_id?: string;
    imported_key?: string;
    name?: string;
    content_type?: string;
    size_bytes?: number;
  };
}): string | null {
  if (!raw.file_name || !raw.file_type || typeof raw.file_size !== 'number' || raw.file_size < 0) {
    return 'attachment_fields_required';
  }
  if (raw.file_size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
    return 'chat_attachment_file_too_large';
  }
  if (raw.content_base64) {
    try {
      const size = Buffer.byteLength(raw.content_base64, 'base64');
      if (size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
        return 'chat_attachment_file_too_large';
      }
    } catch {
      return 'attachment_content_base64_invalid';
    }
  }
  if (raw.input_ref !== undefined) {
    if (typeof raw.input_ref !== 'object' || raw.input_ref === null) {
      return 'attachment_input_ref_invalid';
    }
    if (raw.input_ref.kind === 'library_object') {
      if (
        typeof raw.input_ref.library_id !== 'string'
        || raw.input_ref.library_id.length === 0
        || typeof raw.input_ref.key !== 'string'
        || raw.input_ref.key.length === 0
      ) {
        return 'attachment_input_ref_invalid';
      }
    } else if (raw.input_ref.kind === 'url') {
      if (typeof raw.input_ref.url !== 'string' || raw.input_ref.url.length === 0) {
        return 'attachment_input_ref_invalid';
      }
    } else {
      return 'attachment_input_ref_invalid';
    }
  }
  return null;
}

function hasUnsupportedExternalAgentField(body: unknown): boolean {
  return (
    typeof body === 'object'
    && body !== null
    && Object.prototype.hasOwnProperty.call(body, 'external_agent_id')
  );
}

async function resolveChatInputAttachments(
  deps: NodeApiDeps,
  workspaceId: string,
  projectId: string,
  sessionId: string,
  inputs: ChatMessageInputRef[],
) {
  if (inputs.length === 0) return [];
  const attachments = await deps.chatResourceService.listAttachments(workspaceId, projectId, sessionId);
  const byRef = indexChatAttachmentsByLibraryObjectRef(attachments);
  const resolved = resolveChatInputsFromAttachmentIndex(inputs, byRef);
  return resolved;
}

export async function handleChatNonStreamRoute(args: ChatNonStreamHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, requestUrl, json, readBody } = args;

  if (route.kind === 'chatMessagesStream') {
    return false;
  }

  if (route.kind === 'chatSessions' && method === 'GET') {
    const { page, pageSize, offset } = parsePagination(requestUrl.searchParams, {
      page: 1,
      pageSize: 100,
      maxPageSize: 500,
    });
    const items = await deps.chatResourceService.listSessionsForUser(route.workspaceId, route.projectId, user.id);
    const pageItems = items.slice(offset, offset + pageSize);
    const itemsWithRequestDetails = await Promise.all(
      pageItems.map(async (item) => attachSessionStopTruth({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        session: item,
      })),
    );
    json(res, 200, {
      items: itemsWithRequestDetails,
      total: items.length,
      page,
      page_size: pageSize,
      has_more: offset + itemsWithRequestDetails.length < items.length,
    });
    return true;
  }

  if (route.kind === 'chatSessions' && method === 'POST') {
    const raw = (await readBody(req)) as Record<string, unknown> & {
      title?: string;
      model?: string;
      endpoint_id?: string;
    };
    if (hasUnsupportedExternalAgentField(raw)) {
      json(res, 400, { error_code: 'unsupported_field', message: 'external_agent_id' });
      return true;
    }
    const endpoints = await deps.endpointResourceService.listEndpoints(route.workspaceId, route.projectId);
    const chosenEndpoint =
      (raw.endpoint_id
        ? endpoints.find((item) => item.id === raw.endpoint_id)
        : endpoints.find((item) => item.status === 'active')) ?? null;
    if (!chosenEndpoint) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'active_endpoint_required' });
      return true;
    }
    const created = await deps.chatResourceService.createSession({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      ownerUserId: user.id,
      title: raw.title,
      model: raw.model ?? chosenEndpoint.model,
      endpointId: chosenEndpoint.id,
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'chatSessionItem' && method === 'GET') {
    const session = await deps.chatResourceService.getSessionForUser(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      user.id,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    json(res, 200, await attachSessionStopTruth({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      session,
    }));
    return true;
  }

  if (route.kind === 'chatSessionItem' && method === 'PATCH') {
    const raw = (await readBody(req)) as Record<string, unknown>;
    if (hasUnsupportedExternalAgentField(raw)) {
      json(res, 400, { error_code: 'unsupported_field', message: 'external_agent_id' });
      return true;
    }
    const patch = { ...raw };
    const session = await deps.chatResourceService.getSessionForUser(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      user.id,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const updated = await deps.chatResourceService.updateSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      patch,
    );
    if (!updated) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'chatSessionItem' && method === 'DELETE') {
    await stopActiveSessionStreams(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    const session = await deps.chatResourceService.getSessionForUser(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      user.id,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const deleted = await deps.chatResourceService.deleteSession(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    json(res, 200, { success: true });
    return true;
  }

  if (route.kind === 'chatSessionStop' && method === 'POST') {
    const requestedMode = parseStopMode(await readBody(req));
    if (!requestedMode) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_stop_mode_invalid' });
      return true;
    }
    const session = await deps.chatResourceService.getSessionForUser(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      user.id,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const currentExecution = await readSessionExecutionRecord(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    const capability = await resolveStopCapability({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      session,
      execution: currentExecution,
      allowAgentLookup: requestedMode === 'terminate',
    });
    const effectiveStopMode = resolveEffectiveStopMode(requestedMode, capability, currentExecution);
    const stopEscalationReason = requestedMode === 'terminate' && effectiveStopMode !== 'terminate'
      ? capability.unavailableReason
      : undefined;
    const stopTransition = await requestSessionExecutionStopTransition(deps.cache, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      requestedBy: user.id,
      stopReason: 'session_stop',
      stopMode: effectiveStopMode,
      ...(stopEscalationReason ? { stopEscalationReason } : {}),
    });
    const execution = stopTransition.record;
    const stopped = await stopActiveSessionStreams(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
      {
        requestedBy: user.id,
        stopReason: 'session_stop',
        stopMode: effectiveStopMode,
        ...(stopEscalationReason ? { stopEscalationReason } : {}),
      },
    );
    const stopMode = execution?.stopMode ?? effectiveStopMode;
    const state: StopState = execution?.status === 'terminating'
      ? 'terminating'
      : execution?.status === 'stopping'
        ? 'stopping'
        : stopped > 0
          ? stopMode === 'terminate' ? 'terminating' : 'stopping'
          : 'not_found_or_finished';
    json(res, 202, buildStopResponse({ sessionId: route.sessionId }, {
      state,
      stopMode,
      capability,
    }));
    return true;
  }

  if (route.kind === 'chatSessionStreams' && method === 'GET') {
    const session = await deps.chatResourceService.getSessionForUser(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      user.id,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const sharedExecution = await readSessionExecutionRecord(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    const sharedItems = sharedExecution
      && sharedExecution.streamId
      && (sharedExecution.status === 'running' || sharedExecution.status === 'stopping' || sharedExecution.status === 'terminating')
      ? [{
          stream_id: sharedExecution.streamId,
          status: sharedExecution.status,
          started_at: sharedExecution.startedAt,
        }]
      : [];
    const activeItems = listActiveSessionStreams(route.workspaceId, route.projectId, route.sessionId)
      .map((item) => ({
        stream_id: item.streamId,
        status: item.status,
        started_at: item.startedAt,
      }));
    const deduped = new Map<string, { stream_id: string; status: string; started_at: string }>();
    for (const item of [...sharedItems, ...activeItems]) {
      deduped.set(item.stream_id, item);
    }
    const items = Array.from(deduped.values());
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (route.kind === 'chatMessages' && method === 'GET') {
    const { page, pageSize, offset } = parsePagination(requestUrl.searchParams, {
      page: 1,
      pageSize: 200,
      maxPageSize: 500,
    });
    const session = await deps.chatResourceService.getSessionForUser(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      user.id,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const items = await deps.chatResourceService.listMessages(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    const pageItems = items.slice(offset, offset + pageSize);
    json(res, 200, {
      items: pageItems,
      total: items.length,
      page,
      page_size: pageSize,
      has_more: offset + pageItems.length < items.length,
    });
    return true;
  }

  if (route.kind === 'chatMessages' && method === 'POST') {
    const session = await deps.chatResourceService.getSessionForUser(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      user.id,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const raw = (await readBody(req)) as {
      role?: 'user';
      content?: string;
      parent_id?: string | null;
      inputs?: unknown;
    };
    if (raw.role !== 'user' || !raw.content?.trim()) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_message_content_required' });
      return true;
    }
    const parentId = raw.parent_id ?? null;
    if (parentId) {
      const parent = await deps.chatResourceService.getMessage(
        route.workspaceId,
        route.projectId,
        route.sessionId,
        parentId,
      );
      if (!parent) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_parent_message_not_found' });
        return true;
      }
    }
    const inputRefs = readChatMessageInputs(raw.inputs);
    if (inputRefs === null) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_input_refs_invalid' });
      return true;
    }
    if (inputRefs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
      return true;
    }
    const attachmentSnapshots = [];
    if (inputRefs.length > 0) {
      const endpoint = await deps.endpointResourceService.getEndpoint(
        route.workspaceId,
        route.projectId,
        session.endpoint_id,
      );
      if (!endpoint || !endpointSupportsMultimodal(endpoint)) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_endpoint_not_multimodal' });
        return true;
      }
      const resolved = await resolveChatInputAttachments(
        deps,
        route.workspaceId,
        route.projectId,
        route.sessionId,
        inputRefs,
      );
      if (resolved.some((item) => !item)) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_not_found' });
        return true;
      }
      const attachments = resolved as NonNullable<(typeof resolved)[number]>[];
      const totalSize = attachments.reduce((acc, item) => acc + item.file_size, 0);
      if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE_BYTES) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
        return true;
      }
      const notReady = attachments.find((item) => item.upload_status !== 'ready');
      if (notReady) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_not_ready' });
        return true;
      }
      attachmentSnapshots.push(...toChatAttachmentSnapshots(attachments));
    }

    const created = await deps.chatResourceService.createMessage({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      role: 'user',
      content: raw.content,
      parentId,
      attachmentSnapshots: attachmentSnapshots.length > 0 ? attachmentSnapshots : undefined,
    });
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'chat.message.created',
      resourceType: 'chat',
      resourceId: route.sessionId,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
      metadata: {
        message_id: created.id,
        has_attachments: attachmentSnapshots.length > 0,
        attachment_count: attachmentSnapshots.length,
      },
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'chatMessageItem' && method === 'PATCH') {
    const raw = (await readBody(req)) as { content?: string };
    if (!raw.content?.trim()) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_message_content_required' });
      return true;
    }
    const revised = await deps.chatResourceService.updateMessage(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      route.messageId,
      raw.content,
    );
    if (!revised) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_message_not_found' });
      return true;
    }
    json(res, 200, revised);
    return true;
  }

  if (route.kind === 'chatRegenerate' && method === 'POST') {
    json(res, 200, { stream_id: `stream_${Date.now()}` });
    return true;
  }

  if (route.kind === 'chatAttachments' && method === 'GET') {
    const session = await deps.chatResourceService.getSessionForUser(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      user.id,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const items = await deps.chatResourceService.listAttachments(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (route.kind === 'chatAttachmentInit' && method === 'POST') {
    const session = await deps.chatResourceService.getSessionForUser(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      user.id,
    );
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
      return true;
    }
    const raw = (await readBody(req)) as {
      file_name?: string;
      file_type?: string;
      file_size?: number;
      content_base64?: string;
      input_ref?: {
        kind?: string;
        library_id?: string;
        key?: string;
        url?: string;
        imported_library_id?: string;
        imported_key?: string;
        name?: string;
        content_type?: string;
        size_bytes?: number;
      };
      source_type?: 'local_upload' | 'library_import';
      file_library_id?: string;
      source_object_key?: string;
    };
    const validationError = validateAttachmentPayload(raw);
    if (validationError) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: validationError });
      return true;
    }
    const existing = await deps.chatResourceService.listAttachments(
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    if (existing.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
      return true;
    }
    const totalSize = existing.reduce((acc, item) => acc + item.file_size, 0) + (raw.file_size ?? 0);
    if (totalSize > MAX_ATTACHMENT_TOTAL_SIZE_BYTES) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_attachment_limit_exceeded' });
      return true;
    }
    const inputRef =
      raw.input_ref?.kind === 'library_object'
        ? {
            kind: 'library_object' as const,
            library_id: raw.input_ref.library_id!,
            key: raw.input_ref.key!,
            name: typeof raw.input_ref.name === 'string' ? raw.input_ref.name : undefined,
            content_type: typeof raw.input_ref.content_type === 'string' ? raw.input_ref.content_type : undefined,
            size_bytes:
              typeof raw.input_ref.size_bytes === 'number' && raw.input_ref.size_bytes >= 0
                ? raw.input_ref.size_bytes
                : undefined,
          }
        : raw.input_ref?.kind === 'url'
          ? {
              kind: 'url' as const,
              url: raw.input_ref.url!,
              imported_library_id:
                typeof raw.input_ref.imported_library_id === 'string' ? raw.input_ref.imported_library_id : undefined,
              imported_key: typeof raw.input_ref.imported_key === 'string' ? raw.input_ref.imported_key : undefined,
              name: typeof raw.input_ref.name === 'string' ? raw.input_ref.name : undefined,
              content_type: typeof raw.input_ref.content_type === 'string' ? raw.input_ref.content_type : undefined,
              size_bytes:
                typeof raw.input_ref.size_bytes === 'number' && raw.input_ref.size_bytes >= 0
                  ? raw.input_ref.size_bytes
                  : undefined,
            }
          : undefined;
    let resolvedAttachmentMeta:
      | { fileName: string; fileType: string; fileSize: number }
      | undefined;
    if (inputRef?.kind === 'library_object') {
      const resolved = await resolveInputRef({
        kind: 'library_object',
        deps: { fileLibraryStorageAdapter: deps.fileLibraryStorageAdapter },
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        input: inputRef,
      });
      resolvedAttachmentMeta = {
        fileName: resolved.meta.filename || raw.file_name!,
        fileType: resolved.meta.file_type || raw.file_type!,
        fileSize: typeof resolved.meta.file_size === 'number' ? resolved.meta.file_size : raw.file_size!,
      };
    } else if (inputRef?.kind === 'url') {
      const resolved = await resolveInputRef({
        kind: 'url',
        deps: { fileLibraryStorageAdapter: deps.fileLibraryStorageAdapter },
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        input: inputRef,
      });
      resolvedAttachmentMeta = {
        fileName: resolved.meta.filename || raw.file_name!,
        fileType: resolved.meta.file_type || raw.file_type!,
        fileSize: typeof resolved.meta.file_size === 'number' ? resolved.meta.file_size : raw.file_size!,
      };
    }
    const attachment = await deps.chatResourceService.initAttachment({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      fileName: resolvedAttachmentMeta?.fileName ?? raw.file_name!,
      fileType: resolvedAttachmentMeta?.fileType ?? raw.file_type!,
      fileSize: resolvedAttachmentMeta?.fileSize ?? raw.file_size!,
      inputRef,
      sourceType: inputRef ? 'library_import' : raw.source_type,
      fileLibraryId:
        inputRef?.kind === 'library_object'
          ? inputRef.library_id
          : inputRef?.kind === 'url'
            ? (inputRef.imported_library_id ?? raw.file_library_id)
            : raw.file_library_id,
      sourceObjectKey:
        inputRef?.kind === 'library_object'
          ? inputRef.key
          : inputRef?.kind === 'url'
            ? (inputRef.imported_key ?? raw.source_object_key)
            : raw.source_object_key,
      contentBase64: raw.content_base64,
      previewUrl: toImageDataUrl(
        raw.content_base64,
        resolveImageMimeType(
          resolvedAttachmentMeta?.fileType ?? raw.file_type!,
          resolvedAttachmentMeta?.fileName ?? raw.file_name!,
        ),
      ) ?? undefined,
    });
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'chat.attachment.created',
      resourceType: 'chat_attachment',
      resourceId: attachment.id,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
      metadata: {
        session_id: route.sessionId,
        file_name: attachment.file_name,
        file_type: attachment.file_type,
        file_size: attachment.file_size,
        input_kind: attachment.input_ref?.kind ?? null,
      },
    });
    json(res, 200, { attachment });
    return true;
  }

  if (route.kind === 'chatAttachmentComplete' && method === 'POST') {
    const attachment = await deps.chatResourceService.completeAttachment(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      route.attachmentId,
    );
    if (!attachment) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'attachment_not_found' });
      return true;
    }
    json(res, 200, attachment);
    return true;
  }

  if (route.kind === 'chatAttachmentItem' && method === 'DELETE') {
    const deleted = await deps.chatResourceService.deleteAttachment(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      route.attachmentId,
    );
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'attachment_not_found' });
      return true;
    }
    json(res, 200, { success: true });
    return true;
  }

  if (route.kind === 'chatAttachmentRetry' && method === 'POST') {
    const attachment = await deps.chatResourceService.completeAttachment(
      route.workspaceId,
      route.projectId,
      route.sessionId,
      route.attachmentId,
    );
    if (!attachment) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'attachment_not_found' });
      return true;
    }
    json(res, 200, attachment);
    return true;
  }

  if (route.kind === 'chatMessagesStreamStop' && method === 'POST') {
    const requestedMode = parseStopMode(await readBody(req));
    if (!requestedMode) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_stop_mode_invalid' });
      return true;
    }
    const running = ACTIVE_CHAT_STREAMS.get(route.streamId);
    const registry = await readStreamRegistry(deps.cache, route.streamId);
    const execution = await readSessionExecutionRecord(
      deps.cache,
      route.workspaceId,
      route.projectId,
      route.sessionId,
    );
    const activeRunning = running &&
      running.workspaceId === route.workspaceId &&
      running.projectId === route.projectId &&
      running.sessionId === route.sessionId &&
      (running.status === 'running' || running.status === 'stopping' || running.status === 'terminating')
      ? running
      : null;
    const executionCanStop = Boolean(
      execution &&
      execution.workspaceId === route.workspaceId &&
      execution.projectId === route.projectId &&
      execution.sessionId === route.sessionId &&
      execution.streamId === route.streamId &&
      isActiveStopState(execution.status),
    );
    const registryCanStop = Boolean(
      !execution &&
      registry &&
      registry.workspaceId === route.workspaceId &&
      registry.projectId === route.projectId &&
      registry.sessionId === route.sessionId &&
      isActiveStreamRegistryStatus(registry.status),
    );
    const canStop = Boolean(activeRunning) || executionCanStop || registryCanStop;
    const capability = await resolveStopCapability({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      session: null,
      execution,
      allowAgentLookup: requestedMode === 'terminate',
    });
    if (!canStop) {
      json(res, 202, buildStopResponse({ streamId: route.streamId }, {
        state: 'not_found_or_finished',
        stopMode: requestedMode,
        capability,
      }));
      return true;
    }
    const effectiveStopMode = resolveEffectiveStopMode(requestedMode, capability, execution);
    const stopEscalationReason = requestedMode === 'terminate' && effectiveStopMode !== 'terminate'
      ? capability.unavailableReason
      : undefined;
    await requestSessionExecutionStopTransition(deps.cache, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      sessionId: route.sessionId,
      requestedBy: user.id,
      stopReason: 'user_stop',
      stopMode: effectiveStopMode,
      ...(stopEscalationReason ? { stopEscalationReason } : {}),
    });
    const activeStatus = effectiveStopMode === 'terminate' ? 'terminating' : 'stopping';
    await writeStreamRegistry(
      deps.cache,
      {
        streamId: route.streamId,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        sessionId: route.sessionId,
        status: activeStatus,
        updatedAt: new Date().toISOString(),
      },
      STREAM_REGISTRY_TTL_SECONDS,
    );
    if (activeRunning) {
      activeRunning.status = activeStatus;
      activeRunning.stopReason = 'user_stop';
      activeRunning.abortController.abort();
    }
    json(res, 202, buildStopResponse({ streamId: route.streamId }, {
      state: activeStatus,
      stopMode: effectiveStopMode,
      capability,
    }));
    return true;
  }

  return false;
}
