import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isComposeManagedExternalAgent,
  resolveAgentRunnerRuntime,
} from './agent-runner-profile.js';

describe('agent-runner-profile', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults external agents to docker_manual runtime', () => {
    expect(resolveAgentRunnerRuntime({
      mode: 'external',
      config: {},
    })).toBe('docker_manual');
  });

  it('treats configless external agents as dev_direct when execution base is loopback', () => {
    vi.stubEnv('EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL', 'http://localhost:21000');
    expect(resolveAgentRunnerRuntime({
      mode: 'external',
      config: null,
    })).toBe('dev_direct');
  });

  it('keeps configless external agents as docker_manual when execution base is non-loopback', () => {
    vi.stubEnv('EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL', 'http://host.docker.internal:20000');
    expect(resolveAgentRunnerRuntime({
      mode: 'external',
      config: null,
    })).toBe('docker_manual');
  });

  it('resolves explicit external runtimes from config', () => {
    expect(resolveAgentRunnerRuntime({
      mode: 'external',
      config: { runner_runtime: 'dev_direct' },
    })).toBe('dev_direct');

    expect(resolveAgentRunnerRuntime({
      mode: 'external',
      config: { runner_runtime: 'compose_managed' },
    })).toBe('compose_managed');
  });

  it('forces internal agents to k8s_internal runtime', () => {
    expect(resolveAgentRunnerRuntime({
      mode: 'internal',
      config: { runner_runtime: 'docker_manual' },
    })).toBe('k8s_internal');
  });

  it('identifies compose-managed external agents only from runtime truth', () => {
    expect(isComposeManagedExternalAgent({
      mode: 'external',
      config: { runner_runtime: 'compose_managed' },
    })).toBe(true);

    expect(isComposeManagedExternalAgent({
      mode: 'external',
      config: { runner_runtime: 'docker_manual' },
    })).toBe(false);
  });
});
