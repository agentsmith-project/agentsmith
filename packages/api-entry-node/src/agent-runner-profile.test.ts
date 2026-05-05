import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isComposeManagedExternalAgent,
  resolveAgentRunnerRuntime,
  usesAgentPresenceScopedNotebookRunner,
} from './agent-runner-profile.js';

describe('agent-runner-profile', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults developer runners to docker_manual runtime', () => {
    expect(resolveAgentRunnerRuntime({
      runner_provider: 'developer',
    })).toBe('docker_manual');
  });

  it('treats developer runners as dev_direct when execution base is loopback', () => {
    vi.stubEnv('AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL', 'http://localhost:21000');
    expect(resolveAgentRunnerRuntime({
      runner_provider: 'developer',
    })).toBe('dev_direct');
  });

  it('keeps developer runners as docker_manual when execution base is non-loopback', () => {
    vi.stubEnv('AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL', 'http://host.docker.internal:20000');
    expect(resolveAgentRunnerRuntime({
      runner_provider: 'developer',
    })).toBe('docker_manual');
  });

  it('does not read legacy runner_runtime config as runtime truth', () => {
    expect(resolveAgentRunnerRuntime({
      runner_provider: 'developer',
      config: { runner_runtime: 'compose_managed' },
    } as never)).toBe('docker_manual');
  });

  it('forces managed runners to k8s_internal runtime', () => {
    expect(resolveAgentRunnerRuntime({
      runner_provider: 'managed',
    })).toBe('k8s_internal');
  });

  it('does not identify compose-managed runners from legacy config', () => {
    expect(isComposeManagedExternalAgent({
      runner_provider: 'developer',
      config: { runner_runtime: 'compose_managed' },
    } as never)).toBe(false);
  });

  it('uses agent-presence notebook dispatch for developer runners', () => {
    expect(usesAgentPresenceScopedNotebookRunner({
      runner_provider: 'developer',
    })).toBe(true);

    expect(usesAgentPresenceScopedNotebookRunner({
      runner_provider: 'managed',
    })).toBe(false);
  });

  it('does not infer developer runner semantics from legacy mode', () => {
    vi.stubEnv('AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL', 'http://127.0.0.1:21000');

    expect(usesAgentPresenceScopedNotebookRunner({
      mode: 'external',
      config: null,
    } as never)).toBe(false);
  });
});
