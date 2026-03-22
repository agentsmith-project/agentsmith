import type { AgentRecord } from './resource-models.js';

export type AgentRunnerRuntime =
  | 'dev_direct'
  | 'docker_manual'
  | 'compose_managed'
  | 'k8s_internal';

type AgentConfigLike = AgentRecord['config'] | Record<string, unknown> | null | undefined;

function readRunnerRuntime(config: AgentConfigLike): AgentRunnerRuntime | null {
  const raw = typeof config?.runner_runtime === 'string'
    ? config.runner_runtime.trim()
    : '';
  switch (raw) {
    case 'dev_direct':
    case 'docker_manual':
    case 'compose_managed':
    case 'k8s_internal':
      return raw;
    default:
      return null;
  }
}

export function resolveAgentRunnerRuntime(
  agent: Pick<AgentRecord, 'mode' | 'config'> | null | undefined,
): AgentRunnerRuntime {
  if (agent?.mode === 'internal') {
    return 'k8s_internal';
  }
  return readRunnerRuntime(agent?.config) ?? 'docker_manual';
}

export function isComposeManagedExternalAgent(
  agent: Pick<AgentRecord, 'mode' | 'config'> | null | undefined,
): boolean {
  return agent?.mode === 'external' && resolveAgentRunnerRuntime(agent) === 'compose_managed';
}

export function isExternalRunnerRuntime(
  agent: Pick<AgentRecord, 'mode' | 'config'> | null | undefined,
  runtime: Extract<AgentRunnerRuntime, 'dev_direct' | 'docker_manual' | 'compose_managed'>,
): boolean {
  return agent?.mode === 'external' && resolveAgentRunnerRuntime(agent) === runtime;
}
