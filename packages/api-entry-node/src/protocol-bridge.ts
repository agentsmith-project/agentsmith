import {
  translateChatCompletionResponseToResponses,
  translateResponsesRequestToChat,
} from './responses-chat-compat.js';

export type ProxyWireProtocol = 'openai_completion' | 'openai_responses' | 'anthropic' | 'unknown';

interface UsageLike {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface ChatMessageLike {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => {
      const part = asObject(item);
      if (!part) return '';
      if ((part.type === 'text' || part.type === 'output_text' || part.type === 'input_text') && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function mapOpenAiToolToAnthropicTool(raw: unknown): Record<string, unknown> | null {
  const tool = asObject(raw);
  if (!tool) return null;
  if (tool.type !== 'function') return null;
  const fn = asObject(tool.function);
  if (!fn || typeof fn.name !== 'string' || !fn.name.trim()) return null;
  return {
    name: fn.name,
    description: typeof fn.description === 'string' ? fn.description : undefined,
    input_schema: asObject(fn.parameters) ?? { type: 'object', properties: {} },
  };
}

function mapOpenAiToolChoiceToAnthropic(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    if (value === 'auto') return { type: 'auto' };
    if (value === 'none') return { type: 'none' };
    if (value === 'required') return { type: 'any' };
    return undefined;
  }
  const obj = asObject(value);
  if (!obj) return undefined;
  if (obj.type === 'function') {
    const fn = asObject(obj.function);
    if (fn && typeof fn.name === 'string' && fn.name.trim()) {
      return { type: 'tool', name: fn.name };
    }
  }
  return undefined;
}

function mapAnthropicToolChoiceToOpenAi(value: unknown): unknown {
  const obj = asObject(value);
  if (!obj || typeof obj.type !== 'string') return undefined;
  if (obj.type === 'auto') return 'auto';
  if (obj.type === 'none') return 'none';
  if (obj.type === 'any') return 'required';
  if (obj.type === 'tool' && typeof obj.name === 'string' && obj.name.trim()) {
    return { type: 'function', function: { name: obj.name } };
  }
  return undefined;
}

export function detectProxyWireProtocol(proxyPath: string): ProxyWireProtocol {
  const normalized = proxyPath.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
  if (normalized === 'responses') return 'openai_responses';
  if (normalized === 'chat/completions') return 'openai_completion';
  if (normalized === 'messages' || normalized.startsWith('messages/')) return 'anthropic';
  return 'unknown';
}

function rewriteUpstreamUrl(upstreamUrl: string, targetPath: string): string {
  const trimmed = upstreamUrl.replace(/\/+$/, '');
  if (targetPath.toLowerCase() === 'messages') {
    const lowered = trimmed.toLowerCase();
    if (lowered.endsWith('/messages')) return trimmed;
    if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/messages`;
    return `${trimmed}/v1/messages`;
  }
  const replaced = trimmed.replace(/\/(?:chat\/completions|responses|messages)$/i, `/${targetPath}`);
  if (replaced !== trimmed) return replaced;
  return trimmed.endsWith(`/${targetPath}`) ? trimmed : `${trimmed}/${targetPath}`;
}

function chatContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      const part = asObject(item);
      if (!part) return '';
      if (part.type === 'text' && typeof part.text === 'string') return part.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function openAiChatRequestToAnthropic(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const anthropicMessages: Array<Record<string, unknown>> = [];
  const systemParts: string[] = [];

  for (const raw of messages) {
    const message = asObject(raw) as ChatMessageLike | null;
    if (!message || typeof message.role !== 'string') continue;
    if (message.role === 'system') {
      const text = textFromUnknown(message.content);
      if (text) systemParts.push(text);
      continue;
    }

    if (message.role === 'tool') {
      const toolResultContent =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? null);
      if (message.tool_call_id && toolResultContent) {
        anthropicMessages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: toolResultContent }],
        });
      }
      continue;
    }

    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const blocks: Array<Record<string, unknown>> = [];
    const text = textFromUnknown(message.content);
    if (text) {
      blocks.push({ type: 'text', text });
    }
    if (role === 'assistant') {
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      for (const rawToolCall of toolCalls) {
        const toolCall = asObject(rawToolCall);
        if (!toolCall) continue;
        const fn = asObject(toolCall.function);
        if (!fn || typeof fn.name !== 'string') continue;
        let input: unknown = {};
        if (typeof fn.arguments === 'string' && fn.arguments.trim()) {
          try {
            input = JSON.parse(fn.arguments);
          } catch {
            input = { raw: fn.arguments };
          }
        }
        blocks.push({
          type: 'tool_use',
          id: typeof toolCall.id === 'string' ? toolCall.id : `tool_${Date.now()}`,
          name: fn.name,
          input,
        });
      }
    }

    anthropicMessages.push({
      role,
      content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }],
    });
  }

  const translated: Record<string, unknown> = {
    model: body.model,
    messages: anthropicMessages,
    max_tokens:
      typeof body.max_tokens === 'number'
        ? body.max_tokens
        : (typeof body.max_output_tokens === 'number' ? body.max_output_tokens : 1024),
  };

  if (systemParts.length > 0) translated.system = systemParts.join('\n\n');
  if (typeof body.temperature === 'number') translated.temperature = body.temperature;
  if (typeof body.top_p === 'number') translated.top_p = body.top_p;
  if (typeof body.stream === 'boolean') translated.stream = body.stream;

  const anthropicTools = Array.isArray(body.tools)
    ? body.tools.map((tool) => mapOpenAiToolToAnthropicTool(tool)).filter((tool): tool is Record<string, unknown> => Boolean(tool))
    : [];
  if (anthropicTools.length > 0) translated.tools = anthropicTools;
  const anthropicToolChoice = mapOpenAiToolChoiceToAnthropic(body.tool_choice);
  if (anthropicToolChoice !== undefined) translated.tool_choice = anthropicToolChoice;

  return translated;
}

export function anthropicRequestToOpenAiChat(body: Record<string, unknown>): Record<string, unknown> {
  const openAiMessages: Array<Record<string, unknown>> = [];
  const systemText = typeof body.system === 'string' ? body.system.trim() : '';
  if (systemText) {
    openAiMessages.push({ role: 'system', content: systemText });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const raw of messages) {
    const message = asObject(raw);
    if (!message || typeof message.role !== 'string') continue;
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content = Array.isArray(message.content) ? message.content : [];
    const textParts: string[] = [];
    const toolCalls: Array<Record<string, unknown>> = [];

    for (const rawPart of content) {
      const part = asObject(rawPart);
      if (!part || typeof part.type !== 'string') continue;
      if (part.type === 'text' && typeof part.text === 'string') {
        textParts.push(part.text);
        continue;
      }
      if (part.type === 'tool_use' && role === 'assistant') {
        const callId = typeof part.id === 'string' && part.id ? part.id : `call_${Date.now()}`;
        const toolName = typeof part.name === 'string' ? part.name : 'tool';
        toolCalls.push({
          id: callId,
          type: 'function',
          function: {
            name: toolName,
            arguments: JSON.stringify(part.input ?? {}),
          },
        });
        continue;
      }
      if (part.type === 'tool_result') {
        const toolUseId = typeof part.tool_use_id === 'string' ? part.tool_use_id : undefined;
        if (!toolUseId) continue;
        openAiMessages.push({
          role: 'tool',
          tool_call_id: toolUseId,
          content:
            typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? null),
        });
      }
    }

    if (role === 'assistant') {
      openAiMessages.push({
        role,
        content: textParts.join('\n'),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else {
      openAiMessages.push({ role, content: textParts.join('\n') });
    }
  }

  const translated: Record<string, unknown> = {
    model: body.model,
    messages: openAiMessages,
  };
  if (typeof body.temperature === 'number') translated.temperature = body.temperature;
  if (typeof body.top_p === 'number') translated.top_p = body.top_p;
  if (typeof body.stream === 'boolean') translated.stream = body.stream;
  if (typeof body.max_tokens === 'number') translated.max_tokens = body.max_tokens;

  const openAiTools = Array.isArray(body.tools)
    ? body.tools
        .map((rawTool) => {
          const tool = asObject(rawTool);
          if (!tool || typeof tool.name !== 'string') return null;
          return {
            type: 'function',
            function: {
              name: tool.name,
              description: typeof tool.description === 'string' ? tool.description : undefined,
              parameters: asObject(tool.input_schema) ?? { type: 'object', properties: {} },
            },
          };
        })
        .filter((tool): tool is NonNullable<typeof tool> => tool !== null)
    : [];
  if (openAiTools.length > 0) translated.tools = openAiTools;
  const openAiToolChoice = mapAnthropicToolChoiceToOpenAi(body.tool_choice);
  if (openAiToolChoice !== undefined) translated.tool_choice = openAiToolChoice;

  return translated;
}

export function openAiChatRequestToResponses(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const input: Array<Record<string, unknown>> = [];
  const systemParts: string[] = [];

  for (const raw of messages) {
    const message = asObject(raw) as ChatMessageLike | null;
    if (!message || typeof message.role !== 'string') continue;
    const text = textFromUnknown(message.content);
    if (message.role === 'system') {
      if (text) systemParts.push(text);
      continue;
    }
    if (message.role === 'tool') {
      if (message.tool_call_id) {
        input.push({
          type: 'function_call_output',
          call_id: message.tool_call_id,
          output: text,
        });
      }
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const rawToolCall of message.tool_calls) {
        const toolCall = asObject(rawToolCall);
        if (!toolCall) continue;
        const fn = asObject(toolCall.function);
        if (!fn || typeof fn.name !== 'string') continue;
        input.push({
          type: 'function_call',
          call_id: typeof toolCall.id === 'string' ? toolCall.id : `call_${Date.now()}`,
          name: fn.name,
          arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        });
      }
    }

    input.push({
      role: message.role,
      content: [{ type: 'input_text', text }],
    });
  }

  const translated: Record<string, unknown> = {
    model: body.model,
    input,
  };
  if (systemParts.length > 0) translated.instructions = systemParts.join('\n\n');
  if (typeof body.temperature === 'number') translated.temperature = body.temperature;
  if (typeof body.top_p === 'number') translated.top_p = body.top_p;
  if (typeof body.stream === 'boolean') translated.stream = body.stream;
  if (typeof body.max_tokens === 'number') translated.max_output_tokens = body.max_tokens;
  if (body.tools !== undefined) translated.tools = body.tools;
  if (body.tool_choice !== undefined) translated.tool_choice = body.tool_choice;
  if (typeof body.parallel_tool_calls === 'boolean') translated.parallel_tool_calls = body.parallel_tool_calls;
  if (typeof body.user === 'string') translated.user = body.user;
  return translated;
}

function openAiUsageFromAnthropic(usage: Record<string, unknown> | null): UsageLike | undefined {
  if (!usage) return undefined;
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
  };
}

export function anthropicResponseToOpenAiChat(
  payload: Record<string, unknown>,
  requestBody: Record<string, unknown>,
): Record<string, unknown> {
  const content = Array.isArray(payload.content) ? payload.content : [];
  const textParts: string[] = [];
  const toolCalls: Array<Record<string, unknown>> = [];
  for (const raw of content) {
    const part = asObject(raw);
    if (!part || typeof part.type !== 'string') continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      textParts.push(part.text);
      continue;
    }
    if (part.type === 'tool_use' && typeof part.name === 'string') {
      toolCalls.push({
        id: typeof part.id === 'string' ? part.id : `call_${Date.now()}`,
        type: 'function',
        function: {
          name: part.name,
          arguments: JSON.stringify(part.input ?? {}),
        },
      });
    }
  }

  const stopReason = typeof payload.stop_reason === 'string' ? payload.stop_reason : null;
  const finishReason = stopReason === 'tool_use' ? 'tool_calls' : 'stop';
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: textParts.join(''),
  };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }
  const usage = openAiUsageFromAnthropic(asObject(payload.usage));

  return {
    id: typeof payload.id === 'string' ? payload.id : `chatcmpl_${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof payload.model === 'string' ? payload.model : String(requestBody.model ?? ''),
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

export function openAiChatResponseToAnthropic(
  payload: Record<string, unknown>,
  requestBody: Record<string, unknown>,
): Record<string, unknown> {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = asObject(choices[0]);
  const message = asObject(first?.message);
  const text = typeof message?.content === 'string' ? message.content : chatContentText(message?.content);
  const content: Array<Record<string, unknown>> = [];
  if (text) {
    content.push({ type: 'text', text });
  }
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  for (const rawToolCall of toolCalls) {
    const toolCall = asObject(rawToolCall);
    if (!toolCall) continue;
    const fn = asObject(toolCall.function);
    if (!fn || typeof fn.name !== 'string') continue;
    let input: unknown = {};
    if (typeof fn.arguments === 'string') {
      try {
        input = JSON.parse(fn.arguments);
      } catch {
        input = { raw: fn.arguments };
      }
    }
    content.push({
      type: 'tool_use',
      id: typeof toolCall.id === 'string' ? toolCall.id : `tool_${Date.now()}`,
      name: fn.name,
      input,
    });
  }

  const finishReason = typeof first?.finish_reason === 'string' ? first.finish_reason : 'stop';
  const stopReason = finishReason === 'tool_calls' ? 'tool_use' : 'end_turn';
  const usageObj = asObject(payload.usage);
  const usage = usageObj
    ? {
        input_tokens: Number(usageObj.prompt_tokens ?? 0),
        output_tokens: Number(usageObj.completion_tokens ?? 0),
      }
    : undefined;

  return {
    id: typeof payload.id === 'string' ? payload.id : `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: typeof payload.model === 'string' ? payload.model : String(requestBody.model ?? ''),
    content,
    stop_reason: stopReason,
    ...(usage ? { usage } : {}),
  };
}

function shouldUseResponsesFallback(sourceProtocol: ProxyWireProtocol, endpointProtocol?: string): boolean {
  return sourceProtocol === 'openai_responses' && endpointProtocol !== 'anthropic_compatible';
}

function targetProtocolFromSource(sourceProtocol: ProxyWireProtocol, endpointProtocol?: string): ProxyWireProtocol {
  if (sourceProtocol === 'unknown') return 'unknown';
  if (endpointProtocol === 'anthropic_compatible') return 'anthropic';
  if (sourceProtocol === 'anthropic') return 'openai_completion';
  if (sourceProtocol === 'openai_responses' && shouldUseResponsesFallback(sourceProtocol, endpointProtocol)) {
    return 'openai_completion';
  }
  return sourceProtocol;
}

function targetPathFromProtocol(protocol: ProxyWireProtocol): string | null {
  if (protocol === 'openai_completion') return 'chat/completions';
  if (protocol === 'openai_responses') return 'responses';
  if (protocol === 'anthropic') return 'messages';
  return null;
}

function toOpenAiChatRequest(sourceProtocol: ProxyWireProtocol, body: Record<string, unknown>): Record<string, unknown> {
  if (sourceProtocol === 'openai_completion') return body;
  if (sourceProtocol === 'openai_responses') return translateResponsesRequestToChat(body);
  if (sourceProtocol === 'anthropic') return anthropicRequestToOpenAiChat(body);
  return body;
}

function fromOpenAiChatRequest(targetProtocol: ProxyWireProtocol, body: Record<string, unknown>): Record<string, unknown> {
  if (targetProtocol === 'openai_completion') return body;
  if (targetProtocol === 'openai_responses') return openAiChatRequestToResponses(body);
  if (targetProtocol === 'anthropic') return openAiChatRequestToAnthropic(body);
  return body;
}

function toOpenAiChatResponse(
  targetProtocol: ProxyWireProtocol,
  payload: Record<string, unknown>,
  requestBody: Record<string, unknown>,
): Record<string, unknown> {
  if (targetProtocol === 'openai_completion') return payload;
  if (targetProtocol === 'anthropic') return anthropicResponseToOpenAiChat(payload, requestBody);
  return payload;
}

function fromOpenAiChatResponse(
  sourceProtocol: ProxyWireProtocol,
  payload: Record<string, unknown>,
  requestBody: Record<string, unknown>,
): Record<string, unknown> {
  if (sourceProtocol === 'openai_completion') return payload;
  if (sourceProtocol === 'openai_responses') {
    return translateChatCompletionResponseToResponses(JSON.stringify(payload), requestBody);
  }
  if (sourceProtocol === 'anthropic') {
    return openAiChatResponseToAnthropic(payload, requestBody);
  }
  return payload;
}

export interface ProxyBridgePlan {
  sourceProtocol: ProxyWireProtocol;
  targetProtocol: ProxyWireProtocol;
  upstreamUrl: string;
  upstreamBody: Record<string, unknown>;
  sourceRequestBody: Record<string, unknown>;
  isStreamingRequest: boolean;
  canTranslateStreamingResponse: boolean;
}

export function buildProxyBridgePlan(params: {
  endpointProtocol?: string;
  proxyPath: string;
  upstreamUrl: string;
  body: Record<string, unknown>;
}): ProxyBridgePlan {
  const sourceProtocol = detectProxyWireProtocol(params.proxyPath);
  const targetProtocol = targetProtocolFromSource(sourceProtocol, params.endpointProtocol);
  const chatRequest = toOpenAiChatRequest(sourceProtocol, params.body);
  const upstreamBody = fromOpenAiChatRequest(targetProtocol, chatRequest);
  const targetPath = targetPathFromProtocol(targetProtocol);
  const upstreamUrl = sourceProtocol === targetProtocol
    ? params.upstreamUrl
    : (targetPath ? rewriteUpstreamUrl(params.upstreamUrl, targetPath) : params.upstreamUrl);
  const isStreamingRequest = params.body.stream === true;

  return {
    sourceProtocol,
    targetProtocol,
    upstreamUrl,
    upstreamBody,
    sourceRequestBody: sourceProtocol === 'openai_completion' ? chatRequest : params.body,
    isStreamingRequest,
    canTranslateStreamingResponse: sourceProtocol === 'openai_responses' && targetProtocol === 'openai_completion',
  };
}

export function translateProxyResponsePayload(
  rawPayload: string,
  plan: ProxyBridgePlan,
): string {
  if (plan.sourceProtocol === plan.targetProtocol) {
    return rawPayload;
  }

  const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
  const chatResponse = toOpenAiChatResponse(plan.targetProtocol, parsed, plan.upstreamBody);
  const translated = fromOpenAiChatResponse(plan.sourceProtocol, chatResponse, plan.sourceRequestBody);
  return JSON.stringify(translated);
}
