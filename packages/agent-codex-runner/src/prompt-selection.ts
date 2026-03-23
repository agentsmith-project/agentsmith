type RunnerMessage = {
  role?: string;
  content?: unknown;
};

function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part !== 'object' || part === null) return JSON.stringify(part);
      const record = part as Record<string, unknown>;
      if (record.type === 'text' && typeof record.text === 'string') return record.text;
      if (record.type === 'image_url') return '[image]';
      return JSON.stringify(record);
    }).join('\n').trim();
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

export function selectLatestInstruction(messages: RunnerMessage[] | undefined): string {
  if (!messages || messages.length === 0) return '';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : '';
    if (role !== 'user') continue;
    const content = stringifyMessageContent(message.content);
    if (content.trim().length > 0) return content;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = stringifyMessageContent(messages[index]?.content);
    if (content.trim().length > 0) return content;
  }
  return '';
}
