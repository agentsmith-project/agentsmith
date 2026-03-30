import { describe, expect, it } from 'vitest';
import { normalizeInternalAgentImageForRuntime, resolveAgentPresenceForApi } from './agent-route-handler.js';

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

describe('normalizeInternalAgentImageForRuntime', () => {
  it('rewrites localhost registry images to the runtime k8s registry host', () => {
    expect(
      normalizeInternalAgentImageForRuntime(
        'localhost:5001/mbos/agentsmith-codex-runner:test-release',
        'kind-registry:5000/mbos/agentsmith-codex-runner:test-release',
      ),
    ).toBe('kind-registry:5000/mbos/agentsmith-codex-runner:test-release');
  });

  it('leaves already-k8s-reachable images untouched', () => {
    expect(
      normalizeInternalAgentImageForRuntime(
        'kind-registry:5000/mbos/agentsmith-codex-runner:test-release',
        'kind-registry:5000/mbos/agentsmith-codex-runner:test-release',
      ),
    ).toBe('kind-registry:5000/mbos/agentsmith-codex-runner:test-release');
  });

  it('does not rewrite unrelated registries', () => {
    expect(
      normalizeInternalAgentImageForRuntime(
        'ghcr.io/acme/runner:test-release',
        'kind-registry:5000/mbos/agentsmith-codex-runner:test-release',
      ),
    ).toBe('ghcr.io/acme/runner:test-release');
  });
});
