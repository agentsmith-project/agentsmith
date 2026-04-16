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

  it('keeps shared external presence online even when the current API process has no local socket', () => {
    expect(
      resolveAgentPresenceForApi({
        mode: 'external',
        storedPresence: 'online',
        socketOnline: false,
      }),
    ).toBe('online');
  });

  it('uses a local socket as online evidence while shared presence is catching up', () => {
    expect(
      resolveAgentPresenceForApi({
        mode: 'external',
        storedPresence: 'offline',
        socketOnline: true,
      }),
    ).toBe('online');
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
        'localhost:5001/mbos/agentsmith-notebook-codex-runner:test-release',
        'kind-registry:5000/mbos/agentsmith-notebook-codex-runner:test-release',
      ),
    ).toBe('kind-registry:5000/mbos/agentsmith-notebook-codex-runner:test-release');
  });

  it('leaves already-k8s-reachable images untouched', () => {
    expect(
      normalizeInternalAgentImageForRuntime(
        'kind-registry:5000/mbos/agentsmith-notebook-codex-runner:test-release',
        'kind-registry:5000/mbos/agentsmith-notebook-codex-runner:test-release',
      ),
    ).toBe('kind-registry:5000/mbos/agentsmith-notebook-codex-runner:test-release');
  });

  it('upgrades older runtime tags to the current internal runner image', () => {
    expect(
      normalizeInternalAgentImageForRuntime(
        'imotion-cn-beijing.cr.volces.com/mbos/agentsmith-notebook-codex-runner:20260327T223209Z',
        'imotion-cn-beijing.cr.volces.com/mbos/agentsmith-notebook-codex-runner:20260331T234338Z',
      ),
    ).toBe('imotion-cn-beijing.cr.volces.com/mbos/agentsmith-notebook-codex-runner:20260331T234338Z');
  });

  it('does not rewrite unrelated registries', () => {
    expect(
      normalizeInternalAgentImageForRuntime(
        'ghcr.io/acme/runner:test-release',
        'kind-registry:5000/mbos/agentsmith-notebook-codex-runner:test-release',
      ),
    ).toBe('ghcr.io/acme/runner:test-release');
  });
});
