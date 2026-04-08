export type FeishuOAuthFlowIntent = 'admin_verify' | 'user_connect';

type StoredFeishuOAuthFlow = {
  intent: FeishuOAuthFlowIntent;
  redirectPath: string;
  storedAt: number;
};

const STORAGE_PREFIX = 'agentsmith:feishu-oauth-flow:';
const STORAGE_TTL_MS = 30 * 60 * 1000;

function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

export function persistFeishuOAuthFlow(args: {
  workspaceId: string;
  intent: FeishuOAuthFlowIntent;
  redirectPath: string;
}): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  const payload: StoredFeishuOAuthFlow = {
    intent: args.intent,
    redirectPath: args.redirectPath,
    storedAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(storageKey(args.workspaceId), JSON.stringify(payload));
  } catch {
    // Ignore storage failures and fall back to generic callback behavior.
  }
}

export function readFeishuOAuthFlow(workspaceId: string): StoredFeishuOAuthFlow | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredFeishuOAuthFlow;
    if (
      typeof parsed?.intent !== 'string'
      || typeof parsed?.redirectPath !== 'string'
      || typeof parsed?.storedAt !== 'number'
    ) {
      return null;
    }
    if (Date.now() - parsed.storedAt > STORAGE_TTL_MS) {
      window.sessionStorage.removeItem(storageKey(workspaceId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearFeishuOAuthFlow(workspaceId: string): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(storageKey(workspaceId));
  } catch {
    // Ignore storage failures.
  }
}
