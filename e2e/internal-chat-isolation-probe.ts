export type InternalChatIsolationProbeId = 'session-one' | 'session-two';

export type InternalChatIsolationProbe = {
  id: InternalChatIsolationProbeId;
  prompt: string;
  expectedAnswer: number;
};

export type InternalChatIsolationMessage = {
  role?: string;
  content?: string;
};

const INTERNAL_CHAT_ISOLATION_PROBE_OPERANDS: Record<InternalChatIsolationProbeId, { left: number; right: number }> = {
  'session-one': { left: 17, right: 26 },
  'session-two': { left: 31, right: 18 },
};

export function createInternalChatIsolationProbe(id: InternalChatIsolationProbeId): InternalChatIsolationProbe {
  const operands = INTERNAL_CHAT_ISOLATION_PROBE_OPERANDS[id];
  return {
    id,
    prompt: `Harmless session-isolation check: what is ${operands.left} + ${operands.right}? Reply with only the final number.`,
    expectedAnswer: operands.left + operands.right,
  };
}

export function matchesInternalChatIsolationReply(
  content: string | null | undefined,
  probe: InternalChatIsolationProbe,
): boolean {
  if (typeof content !== 'string') {
    return false;
  }
  const numbers = content.match(/-?\d+/g) ?? [];
  if (numbers.length !== 1) {
    return false;
  }
  return Number(numbers[0]) === probe.expectedAnswer;
}

export function sessionHasInternalChatIsolationReply(
  messages: InternalChatIsolationMessage[],
  probe: InternalChatIsolationProbe,
): boolean {
  return messages.some((message) => message.role === 'assistant' && matchesInternalChatIsolationReply(message.content, probe));
}
