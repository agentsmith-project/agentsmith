import { describe, expect, it } from 'vitest';
import { resolveAgentPresenceForApi } from './agent-route-handler.js';

describe('resolveAgentPresenceForApi', () => {
  it('returns online for external agents with an active socket', () => {
    expect(
      resolveAgentPresenceForApi({
        mode: 'external',
        storedPresence: 'online',
        socketOnline: true,
      }),
    ).toBe('online');
  });

  it('forces external agents offline when the current API process has no socket', () => {
    expect(
      resolveAgentPresenceForApi({
        mode: 'external',
        storedPresence: 'online',
        socketOnline: false,
      }),
    ).toBe('offline');
  });

  it('keeps internal agents managed regardless of socket state', () => {
    expect(
      resolveAgentPresenceForApi({
        mode: 'internal',
        storedPresence: 'managed',
        socketOnline: false,
      }),
    ).toBe('managed');
  });
});
