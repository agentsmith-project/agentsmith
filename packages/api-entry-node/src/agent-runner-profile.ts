import type { AgentRecord } from './resource-models.js';

export type AgentRunnerRuntime =
  | 'dev_direct'
  | 'docker_manual'
  | 'compose_managed'
  | 'k8s_internal';

type AgentConfigLike = AgentRecord['config'] | Record<string, unknown> | null | undefined;
type AgentRunnerProfileInput = { mode: AgentRecord['mode']; config?: AgentConfigLike } | null | undefined;

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

function isLoopbackLikeHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function resolveImplicitExternalRuntime(): Extract<AgentRunnerRuntime, 'dev_direct' | 'docker_manual'> {
  const rawBase = process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL?.trim();
  if (!rawBase) return 'docker_manual';
  try {
    const parsed = new URL(rawBase);
    return isLoopbackLikeHost(parsed.hostname) ? 'dev_direct' : 'docker_manual';
  } catch {
    return 'docker_manual';
  }
}

export function resolveAgentRunnerRuntime(
  agent: AgentRunnerProfileInput,
): AgentRunnerRuntime {
  if (agent?.mode === 'internal') {
    return 'k8s_internal';
  }
  return readRunnerRuntime(agent?.config) ?? resolveImplicitExternalRuntime();
}

export function isComposeManagedExternalAgent(
  agent: AgentRunnerProfileInput,
): boolean {
  return agent?.mode === 'external' && resolveAgentRunnerRuntime(agent) === 'compose_managed';
}

export function usesAgentPresenceScopedNotebookRunner(
  agent: AgentRunnerProfileInput,
): boolean {
  if (agent?.mode !== 'external') return false;
  const runtime = resolveAgentRunnerRuntime(agent);
  return runtime === 'compose_managed' || runtime === 'dev_direct';
}

export function isExternalRunnerRuntime(
  agent: AgentRunnerProfileInput,
  runtime: Extract<AgentRunnerRuntime, 'dev_direct' | 'docker_manual' | 'compose_managed'>,
): boolean {
  return agent?.mode === 'external' && resolveAgentRunnerRuntime(agent) === runtime;
}
