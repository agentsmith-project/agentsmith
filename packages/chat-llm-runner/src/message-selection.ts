import type { AgentServerStartPayload } from '@mbos/agent-runner';

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const typedPart = part as { type?: string; text?: unknown };
        if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
          return typedPart.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function selectLatestUserText(messages: AgentServerStartPayload['messages']): string {
  if (!messages || messages.length === 0) return '';
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  return latestUser ? stringifyContent(latestUser.content).trim() : '';
}
