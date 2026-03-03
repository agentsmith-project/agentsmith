export function parseOpenAIStreamChunk(
  chunk: string,
): Array<{ delta: string; done: boolean; finishReason?: string | null; usageTokens?: number }> {
  const events: Array<{ delta: string; done: boolean; finishReason?: string | null; usageTokens?: number }> = [];
  const blocks = chunk.split('\n\n').map((item) => item.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice('data:'.length).trim();
      if (!data) continue;
      if (data === '[DONE]') {
        events.push({ delta: '', done: true, finishReason: null });
        continue;
      }
      try {
        const payload = JSON.parse(data) as {
          type?: unknown;
          delta?: { type?: unknown; text?: unknown; stop_reason?: unknown };
          usage?: { output_tokens?: unknown; input_tokens?: unknown; total_tokens?: unknown };
          choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }>;
        };
        const usageTokensRaw = payload.usage?.total_tokens;
        const usageTokens = typeof usageTokensRaw === 'number' && Number.isFinite(usageTokensRaw)
          ? usageTokensRaw
          : (
            typeof payload.usage?.output_tokens === 'number' && Number.isFinite(payload.usage.output_tokens)
              ? payload.usage.output_tokens
              : undefined
          );
        const delta = payload.choices?.[0]?.delta?.content;
        const finishReasonRaw = payload.choices?.[0]?.finish_reason;
        const finishReason = typeof finishReasonRaw === 'string' ? finishReasonRaw : null;
        if (typeof delta === 'string' && delta.length > 0) {
          events.push({ delta, done: false, finishReason: null, usageTokens });
        }
        if (finishReason) {
          events.push({ delta: '', done: true, finishReason, usageTokens });
        } else if (usageTokens !== undefined) {
          events.push({ delta: '', done: false, finishReason: null, usageTokens });
        }

        // Anthropic SSE payload compatibility:
        // - content_block_delta: emits text incrementally
        // - message_delta/message_stop: marks stream completion
        if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta') {
          if (typeof payload.delta.text === 'string' && payload.delta.text.length > 0) {
            events.push({ delta: payload.delta.text, done: false, finishReason: null, usageTokens });
          }
        }
        if (payload.type === 'message_delta') {
          const stopReasonRaw = payload.delta?.stop_reason;
          const mappedFinishReason =
            typeof stopReasonRaw === 'string'
              ? (stopReasonRaw === 'tool_use' ? 'tool_calls' : 'stop')
              : null;
          if (mappedFinishReason) {
            events.push({ delta: '', done: true, finishReason: mappedFinishReason, usageTokens });
          }
        }
        if (payload.type === 'message_stop') {
          events.push({ delta: '', done: true, finishReason: 'stop', usageTokens });
        }
      } catch {
        // ignore invalid upstream chunks
      }
    }
  }
  return events;
}

export function safeAssistantContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  const anthropicContent = (payload as { content?: Array<{ type?: unknown; text?: unknown }> }).content;
  if (Array.isArray(anthropicContent)) {
    return anthropicContent
      .map((item) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('');
  }
  return '';
}

export function safeAssistantFinishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const choices = (payload as { choices?: Array<{ finish_reason?: unknown }> }).choices;
  const finishReason = choices?.[0]?.finish_reason;
  if (typeof finishReason === 'string') return finishReason;
  const anthropicStopReason = (payload as { stop_reason?: unknown }).stop_reason;
  if (typeof anthropicStopReason === 'string') {
    return anthropicStopReason === 'tool_use' ? 'tool_calls' : 'stop';
  }
  return null;
}

export function safeAssistantUsageTokens(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const usage = (payload as { usage?: { total_tokens?: unknown } }).usage;
  const totalTokens = usage?.total_tokens;
  if (typeof totalTokens === 'number' && Number.isFinite(totalTokens)) return totalTokens;
  const anthropicUsage = (payload as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage;
  const inputTokens = typeof anthropicUsage?.input_tokens === 'number' && Number.isFinite(anthropicUsage.input_tokens)
    ? anthropicUsage.input_tokens
    : 0;
  const outputTokens = typeof anthropicUsage?.output_tokens === 'number' && Number.isFinite(anthropicUsage.output_tokens)
    ? anthropicUsage.output_tokens
    : 0;
  if (inputTokens > 0 || outputTokens > 0) {
    return inputTokens + outputTokens;
  }
  return undefined;
}
