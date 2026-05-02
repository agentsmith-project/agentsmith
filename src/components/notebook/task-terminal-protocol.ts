export { TASK_TERMINAL_RECONNECT_VIEW } from '@/lib/types/task';

export type TaskTerminalOutputEncoding = 'utf8' | 'base64';

export function readTerminalProtocolSessionId(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) return null;
  const record = message as Record<string, unknown>;
  const terminalSessionId = record.terminal_session_id;
  if (typeof terminalSessionId === 'string' && terminalSessionId.length > 0) {
    return terminalSessionId;
  }
  const legacySessionId = record.session_id;
  return typeof legacySessionId === 'string' && legacySessionId.length > 0
    ? legacySessionId
    : null;
}

export function readTerminalProtocolNumber(
  message: unknown,
  key: string,
): number | null {
  if (typeof message !== 'object' || message === null) return null;
  const value = (message as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function readBase64TerminalBytes(value: string): Uint8Array | null {
  let binary: string | null = null;
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    binary = window.atob(value);
  } else if (typeof globalThis.atob === 'function') {
    binary = globalThis.atob(value);
  }
  if (binary === null) return null;
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeBase64TerminalBytes(value: string, decoder?: TextDecoder | null): string {
  const bytes = readBase64TerminalBytes(value);
  if (!bytes) return value;
  const activeDecoder = decoder ?? (typeof TextDecoder !== 'undefined' ? new TextDecoder() : null);
  if (!activeDecoder) {
    return String.fromCharCode(...bytes);
  }
  return activeDecoder.decode(bytes, decoder ? { stream: true } : undefined);
}

export function decodeTerminalOutputPayload(
  message: unknown,
  decoder?: TextDecoder | null,
): string | null {
  if (typeof message !== 'object' || message === null) return null;
  const record = message as Record<string, unknown>;
  const chunk = record.chunk;
  if (typeof chunk === 'string') return chunk;

  const data = record.data;
  if (typeof data !== 'string') return null;
  const encoding = record.encoding;
  if (encoding === 'base64') {
    return decodeBase64TerminalBytes(data, decoder);
  }
  return data;
}

export function readTerminalOutputPayloadIdentity(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) return null;
  const record = message as Record<string, unknown>;
  const chunk = record.chunk;
  if (typeof chunk === 'string') return `chunk:${chunk}`;

  const data = record.data;
  if (typeof data !== 'string') return null;
  const encoding = record.encoding === 'base64' ? 'base64' : 'utf8';
  return `${encoding}:${data}`;
}

export function readTerminalStateValue(message: unknown): string | null {
  if (typeof message !== 'object' || message === null) return null;
  const record = message as Record<string, unknown>;
  const state = record.state;
  if (typeof state === 'string' && state.length > 0) return state;
  const status = record.status;
  return typeof status === 'string' && status.length > 0 ? status : null;
}

export function readTerminalInputEnabled(message: unknown): boolean | null {
  if (typeof message !== 'object' || message === null) return null;
  const value = (message as Record<string, unknown>).input_enabled;
  return typeof value === 'boolean' ? value : null;
}

export function terminalEventBelongsToSession(
  message: unknown,
  sessionId: string,
): boolean {
  const messageSessionId = readTerminalProtocolSessionId(message);
  return messageSessionId === null || messageSessionId === sessionId;
}

export function isEditableFocusOwner(element: Element | null): boolean {
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') return true;
  if (
    typeof HTMLElement !== 'undefined' &&
    element instanceof HTMLElement &&
    element.isContentEditable
  ) {
    return true;
  }
  if (element.closest('[contenteditable="true"]')) return true;
  if (element.closest('[role="combobox"]')) return true;
  return false;
}
