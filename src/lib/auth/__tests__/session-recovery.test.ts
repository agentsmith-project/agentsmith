import { describe, expect, it, vi } from 'vitest';
import { addSessionRecoveryListener, notifyUnauthorized } from '@/lib/auth/session-recovery';

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
});
