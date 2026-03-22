import { describe, expect, it } from 'vitest';

import {
  isComposeManagedExternalAgent,
  resolveAgentRunnerRuntime,
} from './agent-runner-profile.js';

describe('agent-runner-profile', () => {
  it('defaults external agents to docker_manual runtime', () => {
    expect(resolveAgentRunnerRuntime({
      mode: 'external',
      config: {},
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
