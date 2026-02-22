function asObjectCompat(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function textFromResponseInputContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const item = asObjectCompat(part);
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

function normalizeChatRole(role: string | undefined): 'system' | 'user' | 'assistant' | undefined {
  if (!role) return undefined;
  if (role === 'developer') return 'system';
  if (role === 'system' || role === 'user' || role === 'assistant') return role;
  if (role === 'tool' || role === 'function') return 'assistant';
  return 'user';
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
    const item = asObjectCompat(raw);
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

function translateResponsesToolsToChat(tools: unknown): unknown {
  if (!Array.isArray(tools)) return tools;
  const translated = tools.map((raw) => {
    const item = asObjectCompat(raw);
    if (!item) return raw;
    const type = typeof item.type === 'string' ? item.type : undefined;
    if (type === 'function') {
      const fn = asObjectCompat(item.function);
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
    return null;
  }).filter((item) => item !== null);
  return translated.length > 0 ? translated : undefined;
}

function translateResponsesToolChoiceToChat(toolChoice: unknown, translatedTools?: unknown): unknown {
  const availableFunctionNames = new Set(
    Array.isArray(translatedTools)
      ? translatedTools
          .map((item) => asObjectCompat(item))
          .map((item) => asObjectCompat(item?.function))
          .map((fn) => (typeof fn?.name === 'string' ? fn.name : null))
          .filter((name): name is string => Boolean(name))
      : [],
  );
  if (typeof toolChoice === 'string') return toolChoice;
  const obj = asObjectCompat(toolChoice);
  if (!obj) return toolChoice;
  const type = typeof obj.type === 'string' ? obj.type : '';
  if (type !== 'function') return availableFunctionNames.size > 0 ? 'auto' : undefined;

  const fn = asObjectCompat(obj.function);
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

export function translateResponsesRequestToChat(body: Record<string, unknown>): Record<string, unknown> {
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

export function translateChatCompletionResponseToResponses(
  rawPayload: string,
  upstreamBody: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const first = asObjectCompat(choices[0]);
  const message = asObjectCompat(first?.message);
  const content = typeof message?.content === 'string' ? message.content : '';
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const created = typeof parsed.created === 'number' ? parsed.created : Math.floor(Date.now() / 1000);
  const model = typeof parsed.model === 'string' ? parsed.model : String(upstreamBody.model ?? '');
  const usage = asObjectCompat(parsed.usage);

  const output: Array<Record<string, unknown>> = [];

  for (const rawToolCall of toolCalls) {
    const toolCall = asObjectCompat(rawToolCall);
    if (!toolCall) continue;
    const fn = asObjectCompat(toolCall.function);
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

function extractOutputTextFromResponsesMessageItem(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .map((rawPart) => asObjectCompat(rawPart))
    .map((part) => (part && part.type === 'output_text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('');
}

export function buildResponsesSsePayload(response: Record<string, unknown>): string {
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
    const item = asObjectCompat(rawItem);
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

