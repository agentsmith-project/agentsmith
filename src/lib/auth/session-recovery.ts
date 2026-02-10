export interface UnauthorizedEvent {
  type: 'unauthorized';
  statusCode: 401;
  path: string;
}

type SessionRecoveryListener = (event: UnauthorizedEvent) => void;

const listeners = new Set<SessionRecoveryListener>();

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
