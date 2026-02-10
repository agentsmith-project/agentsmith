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
          usage?: { total_tokens?: unknown };
          choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }>;
        };
        const usageTokensRaw = payload.usage?.total_tokens;
        const usageTokens = typeof usageTokensRaw === 'number' && Number.isFinite(usageTokensRaw)
          ? usageTokensRaw
          : undefined;
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
  return typeof content === 'string' ? content : '';
}

export function safeAssistantFinishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const choices = (payload as { choices?: Array<{ finish_reason?: unknown }> }).choices;
  const finishReason = choices?.[0]?.finish_reason;
  return typeof finishReason === 'string' ? finishReason : null;
}

export function safeAssistantUsageTokens(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const usage = (payload as { usage?: { total_tokens?: unknown } }).usage;
  const totalTokens = usage?.total_tokens;
  return typeof totalTokens === 'number' && Number.isFinite(totalTokens) ? totalTokens : undefined;
}
