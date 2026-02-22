import type http from 'node:http';

function debugEndpointProxy(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_ENDPOINT_PROXY !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[endpoint-proxy] ${message}${suffix}\n`);
}

function summarizeChatLikeBody(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const roleCounts: Record<string, number> = {};
  for (const raw of messages) {
    const item = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
    const role = typeof item?.role === 'string' ? item.role : 'unknown';
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
  }
  return {
    model: typeof body.model === 'string' ? body.model : null,
    stream: body.stream === true,
    message_count: messages.length,
    roles: roleCounts,
    tool_count: tools.length,
    tool_choice:
      typeof body.tool_choice === 'string'
        ? body.tool_choice
        : (typeof body.tool_choice === 'object' && body.tool_choice !== null ? 'object' : null),
    max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
  };
}

export function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export function unauthorized(res: http.ServerResponse): void {
  json(res, 401, { error_code: 'UNAUTHORIZED', message: 'Missing or invalid bearer token' });
}

export function applyCors(res: http.ServerResponse): void {
  const allowOrigin = process.env.CORS_ALLOW_ORIGIN ?? '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Idempotency-Key',
  );
}

export async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw) as unknown;
}

export async function proxyJsonRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: {
    upstreamUrl: string;
    apiKey: string;
    model?: string;
    timeoutSeconds?: number;
    responsesFallbackToChat?: boolean;
  },
): Promise<void> {
  const method = req.method ?? 'POST';
  const isBodyAllowed = method !== 'GET' && method !== 'HEAD';
  const rawBody = isBodyAllowed ? await readBody(req) : {};
  const body =
    rawBody && typeof rawBody === 'object'
      ? ({ ...(rawBody as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  if (options.model) {
    body.model = options.model;
  }

  const useResponsesFallback = options.responsesFallbackToChat === true && method === 'POST';

  const requestedResponsesStream = useResponsesFallback && body.stream === true;

  const upstreamUrl = useResponsesFallback
    ? options.upstreamUrl.replace(/\/responses\/?$/i, '/chat/completions')
    : options.upstreamUrl;
  const upstreamBody = useResponsesFallback ? translateResponsesRequestToChat(body) : body;

  const abortController = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutSeconds ?? 120) * 1000;
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  debugEndpointProxy('proxy_json_request', {
    method,
    use_responses_fallback: useResponsesFallback,
    requested_responses_stream: requestedResponsesStream,
    upstream_url: upstreamUrl,
    timeout_ms: timeoutMs,
    request_summary: summarizeChatLikeBody(upstreamBody),
  });

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: isBodyAllowed ? JSON.stringify(upstreamBody) : undefined,
      signal: abortController.signal,
    });
    const isStreamingChatUpstream =
      useResponsesFallback
      && requestedResponsesStream
      && upstreamRes.ok
      && (upstreamRes.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream');
    debugEndpointProxy('upstream_response', {
      status: upstreamRes.status,
      content_type: upstreamRes.headers.get('content-type') ?? null,
      streaming_chat_upstream: isStreamingChatUpstream,
      use_responses_fallback: useResponsesFallback,
    });

    if (isStreamingChatUpstream && upstreamRes.body) {
      res.statusCode = upstreamRes.status;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      await pipeTranslatedChatSseAsResponses(upstreamRes.body, res, upstreamBody, {
        upstreamUrl,
        fallbackMode: useResponsesFallback,
      });
      return;
    }

    let payload = Buffer.from(await upstreamRes.arrayBuffer());
    let contentType = upstreamRes.headers.get('content-type') ?? 'application/json';
    if (useResponsesFallback && upstreamRes.ok) {
      const translatedResponse = translateChatCompletionResponseToResponses(payload.toString('utf-8'), upstreamBody);
      if (requestedResponsesStream) {
        payload = Buffer.from(buildResponsesSsePayload(translatedResponse), 'utf-8');
        contentType = 'text/event-stream; charset=utf-8';
      } else {
        payload = Buffer.from(JSON.stringify(translatedResponse));
      }
    }
    res.statusCode = upstreamRes.status;
    res.setHeader('content-type', contentType);
    res.end(payload);
    debugEndpointProxy('proxy_json_request_done', {
      status: upstreamRes.status,
      content_type: contentType,
      translated_non_stream_response: useResponsesFallback && upstreamRes.ok,
      payload_bytes: payload.byteLength,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function textFromResponseInputContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const item = asObject(part);
      if (!item) return '';
      const type = typeof item.type === 'string' ? item.type : '';
      if (
        type === 'input_text'
        || type === 'output_text'
        || type === 'text'
        || type === 'message_text'
      ) {
        return typeof item.text === 'string' ? item.text : '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeResponsesInputToMessages(input: unknown): Array<Record<string, unknown>> {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  if (!Array.isArray(input)) {
    return [];
  }
  const messages: Array<Record<string, unknown>> = [];
  for (const raw of input) {
    const item = asObject(raw);
    if (!item) continue;
    const itemType = typeof item.type === 'string' ? item.type : '';

    if (itemType === 'function_call_output') {
      const callId = typeof item.call_id === 'string' ? item.call_id : '';
      if (!callId) continue;
      const output =
        typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? null);
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: output,
      });
      continue;
    }

    if (itemType === 'function_call') {
      const callId = typeof item.call_id === 'string' ? item.call_id : undefined;
      const name = typeof item.name === 'string' ? item.name : undefined;
      const argumentsText =
        typeof item.arguments === 'string'
          ? item.arguments
          : JSON.stringify(item.arguments ?? {});
      if (!name) continue;
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: callId ?? `call_${Date.now()}`,
            type: 'function',
            function: {
              name,
              arguments: argumentsText,
            },
          },
        ],
      });
      continue;
    }

    const role = normalizeChatRole(typeof item.role === 'string' ? item.role : undefined);
    const contentText = textFromResponseInputContent(item.content);
    if (role && contentText) {
      messages.push({ role, content: contentText });
      continue;
    }
    if ((item.type === 'message' || item.type === 'input_message') && role) {
      const text = textFromResponseInputContent(item.content);
      if (text) messages.push({ role, content: text });
    }
  }
  return messages;
}

function normalizeChatRole(role: string | undefined): 'system' | 'user' | 'assistant' | undefined {
  if (!role) return undefined;
  if (role === 'developer') return 'system';
  if (role === 'system' || role === 'user' || role === 'assistant') return role;
  if (role === 'tool' || role === 'function') return 'assistant';
  return 'user';
}

function translateResponsesRequestToChat(body: Record<string, unknown>): Record<string, unknown> {
  const chatBody: Record<string, unknown> = {};
  if (typeof body.model === 'string') chatBody.model = body.model;

  const messages = normalizeResponsesInputToMessages(body.input);
  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    messages.unshift({ role: 'system', content: body.instructions.trim() });
  }
  chatBody.messages = messages;

  if (typeof body.temperature === 'number') chatBody.temperature = body.temperature;
  if (typeof body.top_p === 'number') chatBody.top_p = body.top_p;
  if (typeof body.stream === 'boolean') chatBody.stream = body.stream;
  if (typeof body.max_output_tokens === 'number') chatBody.max_tokens = body.max_output_tokens;
  const translatedTools = body.tools !== undefined ? translateResponsesToolsToChat(body.tools) : undefined;
  if (translatedTools !== undefined) chatBody.tools = translatedTools;
  const translatedToolChoice =
    body.tool_choice !== undefined
      ? translateResponsesToolChoiceToChat(body.tool_choice, translatedTools)
      : undefined;
  if (translatedToolChoice !== undefined) chatBody.tool_choice = translatedToolChoice;
  if (typeof body.parallel_tool_calls === 'boolean') {
    chatBody.parallel_tool_calls = body.parallel_tool_calls;
  }
  if (typeof body.user === 'string') chatBody.user = body.user;

  return chatBody;
}

function translateResponsesToolsToChat(tools: unknown): unknown {
  if (!Array.isArray(tools)) return tools;
  const translated = tools.map((raw) => {
    const item = asObject(raw);
    if (!item) return raw;
    const type = typeof item.type === 'string' ? item.type : undefined;
    if (type === 'function') {
      const fn = asObject(item.function);
      if (fn) return { ...item, function: fn };
      const name = typeof item.name === 'string' ? item.name : undefined;
      if (!name) return raw;
      return {
        type: 'function',
        function: {
          name,
          description: typeof item.description === 'string' ? item.description : undefined,
          parameters:
            typeof item.parameters === 'object' && item.parameters !== null ? item.parameters : undefined,
        },
      };
    }
    // Drop built-in Responses tools that many OpenAI-compatible chat providers do not accept
    // (e.g. web_search, file_search, code_interpreter, computer_use, image_generation).
    return null;
  }).filter((item) => item !== null);
  return translated.length > 0 ? translated : undefined;
}

function translateResponsesToolChoiceToChat(toolChoice: unknown, translatedTools?: unknown): unknown {
  const availableFunctionNames = new Set(
    Array.isArray(translatedTools)
      ? translatedTools
          .map((item) => asObject(item))
          .map((item) => asObject(item?.function))
          .map((fn) => (typeof fn?.name === 'string' ? fn.name : null))
          .filter((name): name is string => Boolean(name))
      : [],
  );
  if (typeof toolChoice === 'string') return toolChoice;
  const obj = asObject(toolChoice);
  if (!obj) return toolChoice;
  const type = typeof obj.type === 'string' ? obj.type : '';
  if (type !== 'function') return availableFunctionNames.size > 0 ? 'auto' : undefined;

  const fn = asObject(obj.function);
  if (fn?.name && typeof fn.name === 'string') {
    if (availableFunctionNames.size > 0 && !availableFunctionNames.has(fn.name)) {
      return 'auto';
    }
    return { type: 'function', function: { name: fn.name } };
  }
  if (typeof obj.name === 'string') {
    if (availableFunctionNames.size > 0 && !availableFunctionNames.has(obj.name)) {
      return 'auto';
    }
    return { type: 'function', function: { name: obj.name } };
  }
  return availableFunctionNames.size > 0 ? 'auto' : undefined;
}

function translateChatCompletionResponseToResponses(
  rawPayload: string,
  upstreamBody: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const first = asObject(choices[0]);
  const message = asObject(first?.message);
  const content = typeof message?.content === 'string' ? message.content : '';
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const created = typeof parsed.created === 'number' ? parsed.created : Math.floor(Date.now() / 1000);
  const model = typeof parsed.model === 'string' ? parsed.model : String(upstreamBody.model ?? '');
  const usage = asObject(parsed.usage);

  const output: Array<Record<string, unknown>> = [];

  for (const rawToolCall of toolCalls) {
    const toolCall = asObject(rawToolCall);
    if (!toolCall) continue;
    const fn = asObject(toolCall.function);
    const name = typeof fn?.name === 'string' ? fn.name : undefined;
    const argumentsText = typeof fn?.arguments === 'string' ? fn.arguments : '{}';
    const callId = typeof toolCall.id === 'string' ? toolCall.id : `call_${Date.now()}`;
    if (!name) continue;
    output.push({
      id: `fc_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: 'function_call',
      status: 'completed',
      call_id: callId,
      name,
      arguments: argumentsText,
    });
  }

  if (content) {
    output.push({
      id: `msg_${Date.now()}`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: content,
          annotations: [],
        },
      ],
    });
  }

  return {
    id: typeof parsed.id === 'string' ? parsed.id : `resp_${Date.now()}`,
    object: 'response',
    created_at: created,
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    model,
    output,
    output_text: content,
    usage:
      usage
        ? {
            input_tokens: Number(usage.prompt_tokens ?? 0),
            output_tokens: Number(usage.completion_tokens ?? 0),
            total_tokens: Number(usage.total_tokens ?? 0),
          }
        : undefined,
  };
}

interface ChatStreamChoiceDeltaToolCall {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ChatStreamChunk {
  id?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string;
      tool_calls?: ChatStreamChoiceDeltaToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ResponsesToolCallStreamState {
  outputIndex: number;
  itemId: string;
  callId: string;
  name: string;
  argumentsText: string;
  added: boolean;
  done: boolean;
}

async function pipeTranslatedChatSseAsResponses(
  upstreamSseBody: ReadableStream<Uint8Array>,
  res: http.ServerResponse,
  requestBody: Record<string, unknown>,
  context?: {
    upstreamUrl?: string;
    fallbackMode?: boolean;
  },
): Promise<void> {
  const reader = upstreamSseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let sequence = 1;
  let responseId = `resp_${Date.now()}`;
  let model = String(requestBody.model ?? '');
  let createdAt = Math.floor(Date.now() / 1000);
  let usage: ChatStreamChunk['usage'];

  let started = false;
  let assistantMessageStarted = false;
  let assistantMessageDone = false;
  const assistantMessageId = `msg_${Date.now()}`;
  const assistantOutputIndex = 0;
  let assistantText = '';
  let terminalSeen = false;
  let doneSeen = false;
  let sseBlockCount = 0;
  let chatChunkCount = 0;
  let textDeltaCount = 0;
  let toolArgumentDeltaCount = 0;
  let terminalReason = 'upstream_eof';

  const toolStates = new Map<number, ResponsesToolCallStreamState>();

  const emit = (type: string, payload: Record<string, unknown>) => {
    const eventPayload = { type, ...payload, sequence_number: sequence++ };
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
  };

  const ensureStarted = () => {
    if (started) return;
    started = true;
    const inProgressResponse = {
      id: responseId,
      object: 'response',
      created_at: createdAt,
      status: 'in_progress',
      error: null,
      incomplete_details: null,
      instructions: null,
      model,
      output: [],
      output_text: '',
      usage: null,
    };
    emit('response.created', { response: inProgressResponse });
    emit('response.in_progress', { response: inProgressResponse });
  };

  const ensureAssistantMessageStarted = () => {
    if (assistantMessageStarted) return;
    ensureStarted();
    assistantMessageStarted = true;
    emit('response.output_item.added', {
      output_index: assistantOutputIndex,
      item: {
        id: assistantMessageId,
        type: 'message',
        status: 'in_progress',
        role: 'assistant',
        content: [],
      },
    });
    emit('response.content_part.added', {
      item_id: assistantMessageId,
      output_index: assistantOutputIndex,
      content_index: 0,
      part: {
        type: 'output_text',
        text: '',
        annotations: [],
      },
    });
  };

  const emitAssistantTextDelta = (delta: string) => {
    if (!delta) return;
    ensureAssistantMessageStarted();
    assistantText += delta;
    textDeltaCount += 1;
    emit('response.output_text.delta', {
      item_id: assistantMessageId,
      output_index: assistantOutputIndex,
      content_index: 0,
      delta,
    });
  };

  const getToolState = (index: number): ResponsesToolCallStreamState => {
    const existing = toolStates.get(index);
    if (existing) return existing;
    const state: ResponsesToolCallStreamState = {
      outputIndex: index + 1,
      itemId: `fc_${Date.now()}_${index}`,
      callId: `call_${Date.now()}_${index}`,
      name: '',
      argumentsText: '',
      added: false,
      done: false,
    };
    toolStates.set(index, state);
    return state;
  };

  const emitToolStateAddedIfNeeded = (state: ResponsesToolCallStreamState) => {
    if (state.added) return;
    ensureStarted();
    state.added = true;
    emit('response.output_item.added', {
      output_index: state.outputIndex,
      item: {
        id: state.itemId,
        type: 'function_call',
        status: 'in_progress',
        call_id: state.callId,
        name: state.name,
        arguments: state.argumentsText,
      },
    });
  };

  const emitToolCallDeltas = (toolCalls: ChatStreamChoiceDeltaToolCall[]) => {
    for (const toolCall of toolCalls) {
      const idx = typeof toolCall.index === 'number' ? toolCall.index : 0;
      const state = getToolState(idx);
      if (typeof toolCall.id === 'string' && toolCall.id) {
        state.callId = toolCall.id;
      }
      if (typeof toolCall.function?.name === 'string' && toolCall.function.name) {
        state.name = toolCall.function.name;
      }
      emitToolStateAddedIfNeeded(state);
      if (typeof toolCall.function?.arguments === 'string' && toolCall.function.arguments) {
        state.argumentsText += toolCall.function.arguments;
        toolArgumentDeltaCount += 1;
        emit('response.function_call_arguments.delta', {
          item_id: state.itemId,
          output_index: state.outputIndex,
          delta: toolCall.function.arguments,
        });
      }
    }
  };

  const finalizeAssistantMessage = () => {
    if (!assistantMessageStarted || assistantMessageDone) return;
    assistantMessageDone = true;
    emit('response.output_text.done', {
      item_id: assistantMessageId,
      output_index: assistantOutputIndex,
      content_index: 0,
      text: assistantText,
    });
    emit('response.content_part.done', {
      item_id: assistantMessageId,
      output_index: assistantOutputIndex,
      content_index: 0,
      part: {
        type: 'output_text',
        text: assistantText,
        annotations: [],
      },
    });
    emit('response.output_item.done', {
      output_index: assistantOutputIndex,
      item: {
        id: assistantMessageId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: assistantText,
            annotations: [],
          },
        ],
      },
    });
  };

  const finalizeToolCalls = () => {
    for (const state of [...toolStates.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      if (!state.added || state.done) continue;
      state.done = true;
      emit('response.function_call_arguments.done', {
        item_id: state.itemId,
        output_index: state.outputIndex,
        arguments: state.argumentsText || '{}',
      });
      emit('response.output_item.done', {
        output_index: state.outputIndex,
        item: {
          id: state.itemId,
          type: 'function_call',
          status: 'completed',
          call_id: state.callId,
          name: state.name,
          arguments: state.argumentsText || '{}',
        },
      });
    }
  };

  const buildCompletedOutput = (): Array<Record<string, unknown>> => {
    const output: Array<Record<string, unknown>> = [];
    if (assistantMessageStarted) {
      output.push({
        id: assistantMessageId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: assistantText,
            annotations: [],
          },
        ],
      });
    }
    for (const state of [...toolStates.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      output.push({
        id: state.itemId,
        type: 'function_call',
        status: 'completed',
        call_id: state.callId,
        name: state.name,
        arguments: state.argumentsText || '{}',
      });
    }
    return output;
  };

  const finalizeResponse = () => {
    ensureStarted();
    finalizeAssistantMessage();
    finalizeToolCalls();
    emit('response.completed', {
      response: {
        id: responseId,
        object: 'response',
        created_at: createdAt,
        status: 'completed',
        error: null,
        incomplete_details: null,
        instructions: null,
        model,
        output: buildCompletedOutput(),
        output_text: assistantText,
        usage:
          usage
            ? {
                input_tokens: Number(usage.prompt_tokens ?? 0),
                output_tokens: Number(usage.completion_tokens ?? 0),
                total_tokens: Number(usage.total_tokens ?? 0),
              }
            : undefined,
      },
    });
  };

  const finalizeResponseWithError = (message: string) => {
    ensureStarted();
    finalizeAssistantMessage();
    finalizeToolCalls();
    emit('response.completed', {
      response: {
        id: responseId,
        object: 'response',
        created_at: createdAt,
        status: 'completed',
        error: {
          code: 'UPSTREAM_STREAM_ERROR',
          message,
        },
        incomplete_details: null,
        instructions: null,
        model,
        output: buildCompletedOutput(),
        output_text: assistantText,
        usage:
          usage
            ? {
                input_tokens: Number(usage.prompt_tokens ?? 0),
                output_tokens: Number(usage.completion_tokens ?? 0),
                total_tokens: Number(usage.total_tokens ?? 0),
              }
            : undefined,
      },
    });
  };

  const processSseBlock = (block: string) => {
    sseBlockCount += 1;
    const dataLines = block
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());
    if (dataLines.length === 0) return;
    const rawData = dataLines.join('\n');
    if (!rawData || rawData === '[DONE]') {
      terminalSeen = true;
      doneSeen = rawData === '[DONE]';
      terminalReason = doneSeen ? 'done_sentinel' : 'empty_data';
      return;
    }
    if (rawData.startsWith('{') && rawData.includes('"error"')) {
      const maybeError = JSON.parse(rawData) as { error?: { message?: string } };
      terminalSeen = true;
      terminalReason = 'upstream_error_payload';
      finalizeResponseWithError(maybeError.error?.message ?? rawData);
      return;
    }
    const chunk = JSON.parse(rawData) as ChatStreamChunk;
    chatChunkCount += 1;
    if (typeof chunk.id === 'string' && chunk.id) responseId = chunk.id;
    if (typeof chunk.model === 'string' && chunk.model) model = chunk.model;
    if (typeof chunk.created === 'number') createdAt = chunk.created;
    if (chunk.usage) usage = chunk.usage;

    const firstChoice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (typeof firstChoice?.delta?.content === 'string') {
      emitAssistantTextDelta(firstChoice.delta.content);
    }
    if (Array.isArray(firstChoice?.delta?.tool_calls) && firstChoice.delta.tool_calls.length > 0) {
      emitToolCallDeltas(firstChoice.delta.tool_calls);
    }
    if (typeof firstChoice?.finish_reason === 'string' && firstChoice.finish_reason) {
      terminalSeen = true;
      terminalReason = `finish_reason:${firstChoice.finish_reason}`;
    }
  };

  try {
    debugEndpointProxy('stream_translate_start', {
      upstream_url: context?.upstreamUrl ?? null,
      model: typeof requestBody.model === 'string' ? requestBody.model : null,
      fallback_mode: context?.fallbackMode === true,
    });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let splitIndex = findSseBlockSeparator(buffer);
      while (splitIndex >= 0) {
        const block = buffer.slice(0, splitIndex);
        const sepLen = buffer.startsWith('\r\n\r\n', splitIndex) ? 4 : 2;
        buffer = buffer.slice(splitIndex + sepLen);
        if (block.trim()) processSseBlock(block);
        splitIndex = findSseBlockSeparator(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processSseBlock(buffer);
    if (!terminalSeen) {
      // Upstream sometimes closes without explicit [DONE].
      terminalSeen = true;
      terminalReason = 'upstream_eof_no_terminal';
    }
    if (!res.writableEnded) {
      finalizeResponse();
    }
    debugEndpointProxy('stream_translate_done', {
      model,
      sse_block_count: sseBlockCount,
      chat_chunk_count: chatChunkCount,
      text_delta_count: textDeltaCount,
      tool_argument_delta_count: toolArgumentDeltaCount,
      assistant_text_chars: assistantText.length,
      tool_call_count: toolStates.size,
      terminal_seen: terminalSeen,
      done_seen: doneSeen,
      terminal_reason: terminalReason,
    });
    res.end();
  } catch (error) {
    debugEndpointProxy('stream_translate_error', {
      message: error instanceof Error ? error.message : String(error),
      sse_block_count: sseBlockCount,
      chat_chunk_count: chatChunkCount,
      terminal_reason: terminalReason,
    });
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function findSseBlockSeparator(buffer: string): number {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}

function buildResponsesSsePayload(response: Record<string, unknown>): string {
  const events: Array<Record<string, unknown>> = [];
  let sequenceNumber = 1;
  const responseId = typeof response.id === 'string' ? response.id : `resp_${Date.now()}`;

  const emit = (type: string, payload: Record<string, unknown>) => {
    events.push({ type, ...payload, sequence_number: sequenceNumber++ });
  };

  const inProgressResponse = { ...response, status: 'in_progress', output: [], usage: null };
  emit('response.created', { response: inProgressResponse });
  emit('response.in_progress', { response: inProgressResponse });

  const output = Array.isArray(response.output) ? response.output : [];
  output.forEach((rawItem, outputIndex) => {
    const item = asObject(rawItem);
    if (!item) return;
    const itemId = typeof item.id === 'string' ? item.id : `item_${outputIndex}`;
    const itemType = typeof item.type === 'string' ? item.type : '';

    if (itemType === 'message') {
      const text = extractOutputTextFromResponsesMessageItem(item);
      emit('response.output_item.added', {
        output_index: outputIndex,
        item: { ...item, status: 'in_progress', content: [] },
      });
      emit('response.content_part.added', {
        item_id: itemId,
        output_index: outputIndex,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      });
      if (text) {
        emit('response.output_text.delta', {
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          delta: text,
        });
      }
      emit('response.output_text.done', {
        item_id: itemId,
        output_index: outputIndex,
        content_index: 0,
        text,
      });
      emit('response.content_part.done', {
        item_id: itemId,
        output_index: outputIndex,
        content_index: 0,
        part: { type: 'output_text', text, annotations: [] },
      });
      emit('response.output_item.done', {
        output_index: outputIndex,
        item,
      });
      return;
    }

    if (itemType === 'function_call') {
      emit('response.output_item.added', {
        output_index: outputIndex,
        item: { ...item, status: 'in_progress' },
      });
      emit('response.function_call_arguments.done', {
        item_id: itemId,
        output_index: outputIndex,
        arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
      });
      emit('response.output_item.done', {
        output_index: outputIndex,
        item,
      });
      return;
    }

    emit('response.output_item.added', {
      output_index: outputIndex,
      item,
    });
    emit('response.output_item.done', {
      output_index: outputIndex,
      item,
    });
  });

  emit('response.completed', { response: { ...response, id: responseId, status: 'completed' } });

  return `${events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n`)
    .join('\n')}\n`;
}

function extractOutputTextFromResponsesMessageItem(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .map((rawPart) => asObject(rawPart))
    .map((part) => (part && part.type === 'output_text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('');
}
