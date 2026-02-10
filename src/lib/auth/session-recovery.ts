export interface UnauthorizedEvent {
  type: 'unauthorized';
  statusCode: 401;
  path: string;
}

type SessionRecoveryListener = (event: UnauthorizedEvent) => void;
type SessionRefreshHandler = () => Promise<boolean>;

const listeners = new Set<SessionRecoveryListener>();
let refreshHandler: SessionRefreshHandler | null = null;

export function addSessionRecoveryListener(listener: SessionRecoveryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyUnauthorized(path: string): void {
  const event: UnauthorizedEvent = {
    type: 'unauthorized',
    statusCode: 401,
    path,
  };
  for (const listener of listeners) {
    listener(event);
  }
}

export function setSessionRefreshHandler(handler: SessionRefreshHandler | null): void {
  refreshHandler = handler;
}

export async function tryRefreshSession(): Promise<boolean> {
  if (!refreshHandler) return false;
  return refreshHandler();
}
