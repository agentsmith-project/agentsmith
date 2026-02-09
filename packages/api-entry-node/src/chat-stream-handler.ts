import type http from 'node:http';
import type { ChatRoute } from './chat-route-match.js';
import type { NodeApiDeps } from './node-api-deps.js';
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

interface ChatStreamHandlerArgs {
  route: ChatRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  buildUpstreamUrl: (baseUrl: string, proxyPath: string) => string;
  sseWrite: (res: http.ServerResponse, event: string, data: unknown) => void;
}

export async function handleChatStreamRoute(args: ChatStreamHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, json, readBody, buildUpstreamUrl, sseWrite } = args;
  if (route.kind !== 'chatMessagesStream' || method !== 'POST') {
    return false;
  }

  const session = await deps.chatResourceService.getSession(
    route.workspaceId,
    route.projectId,
    route.sessionId,
  );
  if (!session) {
    json(res, 404, { code: 'RESOURCE_NOT_FOUND', message: 'chat_session_not_found' });
    return true;
  }
  const runningStreams = listActiveSessionStreams(route.workspaceId, route.projectId, route.sessionId);
  if (runningStreams.length > 0) {
    json(res, 409, {
      code: 'CHAT_SESSION_STREAM_CONFLICT',
      message: 'chat_session_stream_conflict',
    });
    return true;
  }

  const raw = (await readBody(req)) as {
    model?: string;
    endpoint_id?: string;
    from_message_id?: string;
    branch_leaf_message_id?: string;
    input?: { role?: 'user'; content?: string; attachments?: string[] };
  };
  const endpointId = raw.endpoint_id ?? session.endpoint_id;
  const endpoint = await deps.endpointResourceService.getEndpoint(
    route.workspaceId,
    route.projectId,
    endpointId,
  );
  if (!endpoint || endpoint.status !== 'active' || !endpoint.credential_ref) {
    json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'chat_endpoint_unavailable' });
    return true;
  }
  const apiKey = await deps.endpointResourceService.getCredentialSecret(
    route.workspaceId,
    route.projectId,
    endpoint.credential_ref,
  );
  if (!apiKey) {
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
    let branchLeaf: { id: string; role: string; content: string } | null = null;
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
    const canReuseLeafUser =
      !!branchLeaf &&
      branchLeaf.role === 'user' &&
      branchLeaf.content === raw.input.content;
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
  ACTIVE_CHAT_STREAMS.set(streamId, {
    workspaceId: route.workspaceId,
    projectId: route.projectId,
    sessionId: route.sessionId,
    abortController: streamAbortController,
    startedAt: new Date().toISOString(),
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
  let clientDisconnected = false;
  const onResClose = () => {
    clientDisconnected = true;
  };
  res.once('close', onResClose);

  const upstreamUrl = buildUpstreamUrl(endpoint.base_url, 'chat/completions');
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: raw.model ?? endpoint.source_model ?? endpoint.openai_model,
        stream: true,
        messages: messages.map((item) => ({ role: item.role, content: item.content })),
      }),
      signal: streamAbortController.signal,
    });
  } catch (error) {
    res.off('close', onResClose);
    ACTIVE_CHAT_STREAMS.delete(streamId);
    if (streamAbortController.signal.aborted) {
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
    return true;
  }

  if (!upstreamRes.ok) {
    res.off('close', onResClose);
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
  sseWrite(res, 'meta', {
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
    if (!clientDisconnected) {
      sseWrite(res, 'ping', { ts: Date.now() });
    }
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
          if (!clientDisconnected) {
            sseWrite(res, 'delta', {
              message_id: createdAssistant.id,
              delta: chunk.delta,
            });
          }
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
          if (!clientDisconnected) {
            sseWrite(res, 'delta', {
              message_id: createdAssistant.id,
              delta: chunk.delta,
            });
          }
        }
      }
    } else {
      const completionPayload = await upstreamRes.json().catch(() => ({}));
      assistantText = safeAssistantContent(completionPayload);
      finishReason = safeAssistantFinishReason(completionPayload);
      usageTokens = safeAssistantUsageTokens(completionPayload);
      if (assistantText.length > 0 && !clientDisconnected) {
        sseWrite(res, 'delta', {
          message_id: createdAssistant.id,
          delta: assistantText,
        });
      }
    }
  } catch (error) {
    if (streamAbortController.signal.aborted) {
      messageStatus = 'stopped';
    } else {
      res.off('close', onResClose);
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
  res.off('close', onResClose);
  clearInterval(pingTimer);
  const active = ACTIVE_CHAT_STREAMS.get(streamId);
  if (active) {
    active.status = 'finished';
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

  if (!clientDisconnected) {
    sseWrite(res, 'done', {
      message_id: finalized?.id ?? createdAssistant.id,
      finish_reason: finishReason,
      tokens: usageTokens,
      message_status: messageStatus,
    });
    res.end();
  }

  return true;
}
