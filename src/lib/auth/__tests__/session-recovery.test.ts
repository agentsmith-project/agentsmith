import { describe, expect, it, vi } from 'vitest';
import {
  addSessionRecoveryListener,
  notifyUnauthorized,
  setSessionRefreshHandler,
  tryRefreshSession,
} from '@/lib/auth/session-recovery';

describe('session recovery event bus', () => {
  it('notifies listeners on unauthorized events', () => {
    const listener = vi.fn();
    const unsubscribe = addSessionRecoveryListener(listener);

    notifyUnauthorized('/workspaces');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: 'unauthorized',
      statusCode: 401,
      path: '/workspaces',
    });
    unsubscribe();
  });

  it('stops notifying removed listeners', () => {
    const listener = vi.fn();
    const unsubscribe = addSessionRecoveryListener(listener);
    unsubscribe();

    notifyUnauthorized('/projects');

    expect(listener).not.toHaveBeenCalled();
  });

  it('runs refresh handler when registered', async () => {
    const handler = vi.fn().mockResolvedValue(true);
    setSessionRefreshHandler(handler);

    await expect(tryRefreshSession()).resolves.toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    setSessionRefreshHandler(null);
  });

  it('returns false when refresh handler is not registered', async () => {
    setSessionRefreshHandler(null);
    await expect(tryRefreshSession()).resolves.toBe(false);
  });
});
